import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFeed, refreshFeed, syncIntervalMs } from './sync.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')
const port = Number(process.env.PORT || 8787)
const versionInfo = JSON.parse(readFileSync(path.join(rootDir, 'data', 'version.json'), 'utf8'))

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  })
  response.end(JSON.stringify(body))
}

function sendStatic(response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  let filePath = path.resolve(distDir, requested)
  if (!filePath.startsWith(distDir) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html')
  }
  if (!existsSync(filePath)) {
    sendJson(response, 503, { error: '前端尚未构建，请先运行 npm run build' })
    return
  }
  const contentType = contentTypes[path.extname(filePath)] || 'application/octet-stream'
  response.writeHead(200, { 'content-type': contentType })
  createReadStream(filePath).pipe(response)
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type'
    })
    response.end()
    return
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, service: 'jieban-official-sync', ...getFeed().meta })
    return
  }
  if (url.pathname === '/api/version') {
    sendJson(response, 200, versionInfo)
    return
  }
  if (url.pathname === '/api/notices') {
    try {
      const current = getFeed()
      const stale = !current.meta.lastSyncedAt || Date.now() - new Date(current.meta.lastSyncedAt).getTime() > syncIntervalMs
      const shouldRefresh = url.searchParams.get('refresh') === '1' || stale
      sendJson(response, 200, shouldRefresh ? await refreshFeed() : current)
    } catch (error) {
      sendJson(response, 200, {
        ...getFeed(),
        warning: `本轮同步失败，已返回最后一次已核验数据：${String(error?.message || error)}`
      })
    }
    return
  }
  sendStatic(response, decodeURIComponent(url.pathname))
})

server.listen(port, '0.0.0.0', () => {
  console.log(`[sync-api] http://0.0.0.0:${port}`)
  void refreshFeed().then((result) => {
    console.log(`[sync-api] synced ${result.notices.length} notices from ${result.meta.successfulSourceCount}/${result.meta.sourceCount} sources`)
  }).catch((error) => {
    console.error('[sync-api] initial sync failed', error)
  })
})

setInterval(() => {
  void refreshFeed().catch((error) => console.error('[sync-api] scheduled sync failed', error))
}, syncIntervalMs).unref()
