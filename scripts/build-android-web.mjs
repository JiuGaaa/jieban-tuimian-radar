import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(await readFile(path.join(rootDir, 'config', 'android-build.json'), 'utf8'))
const version = JSON.parse(await readFile(path.join(rootDir, 'data', 'version.json'), 'utf8'))
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('无法定位 npm CLI')

const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_API_BASE_URL: config.apiBaseUrl,
    VITE_STATIC_API: config.staticApi ? '1' : '0',
    VITE_BASE_PATH: '/',
    VITE_APP_VERSION_CODE: String(version.versionCode),
    VITE_APP_VERSION_NAME: String(version.versionName)
  }
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
