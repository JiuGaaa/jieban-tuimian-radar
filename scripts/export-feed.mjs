import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalizeUrl, refreshFeed } from '../server/sync.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = path.join(rootDir, 'public', 'api')

function isVerifiedNotice(notice) {
  if (!notice || notice.verificationStatus !== 'official-online' || !notice.sourceUrl || !notice.sourceDomain) return false
  try {
    return new URL(notice.sourceUrl).hostname === notice.sourceDomain
  } catch {
    return false
  }
}

async function readPreviousFeed() {
  if (!process.env.PUBLIC_FEED_URL) return null
  try {
    const response = await fetch(`${process.env.PUBLIC_FEED_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return null
    const feed = await response.json()
    return Array.isArray(feed?.notices) ? feed : null
  } catch {
    return null
  }
}

const [freshFeed, previousFeed] = await Promise.all([refreshFeed(), readPreviousFeed()])
const merged = new Map()
for (const notice of previousFeed?.notices || []) {
  if (isVerifiedNotice(notice)) merged.set(canonicalizeUrl(notice.sourceUrl), notice)
}
for (const notice of freshFeed.notices) {
  if (isVerifiedNotice(notice)) merged.set(canonicalizeUrl(notice.sourceUrl), notice)
}

const exportedFeed = {
  ...freshFeed,
  notices: [...merged.values()].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
}
const version = await readFile(path.join(rootDir, 'data', 'version.json'), 'utf8')

await mkdir(apiDir, { recursive: true })
await Promise.all([
  writeFile(path.join(apiDir, 'notices.json'), `${JSON.stringify(exportedFeed, null, 2)}\n`, 'utf8'),
  writeFile(path.join(apiDir, 'version.json'), version, 'utf8')
])

console.log(JSON.stringify({
  noticeCount: exportedFeed.notices.length,
  successfulSources: `${freshFeed.meta.successfulSourceCount}/${freshFeed.meta.sourceCount}`,
  carriedForward: Math.max(0, exportedFeed.notices.length - freshFeed.notices.length)
}, null, 2))

