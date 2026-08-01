import { createHash, randomBytes } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolchainsDir = path.join(rootDir, '.toolchains')
const javaHome = path.join(toolchainsDir, 'jdk-21')
const androidSdk = path.join(toolchainsDir, 'android-sdk')
const gradleHome = path.join(toolchainsDir, 'gradle-home')
const androidUserHome = path.join(toolchainsDir, 'android-user-home')
const signingDir = path.join(toolchainsDir, 'signing')
const signingKey = path.join(signingDir, 'jieban-release.jks')
const signingProperties = path.join(signingDir, 'signing.properties')
const versionPath = path.join(rootDir, 'data', 'version.json')
const version = JSON.parse(await readFile(versionPath, 'utf8'))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

if (!existsSync(path.join(javaHome, 'bin', 'java.exe'))) {
  throw new Error(`缺少 Capacitor 8 所需的便携 JDK 21：${javaHome}`)
}
if (!existsSync(path.join(androidSdk, 'platforms', 'android-36'))) {
  throw new Error(`缺少 Android 36 SDK：${androidSdk}`)
}

await Promise.all([
  mkdir(gradleHome, { recursive: true }),
  mkdir(androidUserHome, { recursive: true }),
  mkdir(signingDir, { recursive: true })
])

if (!existsSync(signingKey) || !existsSync(signingProperties)) {
  const password = randomBytes(30).toString('base64url')
  const keytoolResult = spawnSync(path.join(javaHome, 'bin', 'keytool.exe'), [
    '-genkeypair',
    '-v',
    '-keystore', signingKey,
    '-storetype', 'JKS',
    '-storepass', password,
    '-keypass', password,
    '-alias', 'jieban-release',
    '-keyalg', 'RSA',
    '-keysize', '3072',
    '-validity', '10000',
    '-dname', 'CN=Jieban Tuimian Radar, O=Jieban, C=CN'
  ], { stdio: 'ignore' })
  if (keytoolResult.error) throw keytoolResult.error
  if (keytoolResult.status !== 0) throw new Error('无法创建应用专用签名密钥')
  await writeFile(signingProperties, [
    'storeFile=../../.toolchains/signing/jieban-release.jks',
    `storePassword=${password}`,
    'keyAlias=jieban-release',
    `keyPassword=${password}`,
    ''
  ].join('\n'), 'utf8')
  console.log(`已创建应用专用签名密钥：${signingKey}`)
}

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('无法定位 npm CLI')
run(process.execPath, [npmCli, 'run', 'android:sync'], { cwd: rootDir })

const buildEnvironment = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  ANDROID_USER_HOME: androidUserHome,
  GRADLE_USER_HOME: gradleHome
}
const wrapperJar = path.join(rootDir, 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar')
const gradleCommand = path.join(javaHome, 'bin', 'java.exe')
const gradleArgs = [
  '-Dorg.gradle.vfs.watch=false',
  '-classpath',
  wrapperJar,
  'org.gradle.wrapper.GradleWrapperMain',
  'assembleRelease',
  '--no-daemon',
  '--no-parallel',
  '--max-workers=1'
]
let built = false
for (let attempt = 1; attempt <= 3 && !built; attempt += 1) {
  const result = spawnSync(gradleCommand, gradleArgs, {
    cwd: path.join(rootDir, 'android'),
    env: buildEnvironment,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  built = result.status === 0
  if (!built && attempt < 3) console.warn(`Gradle Windows 缓存操作失败，正在进行第 ${attempt + 1}/3 次安全重试…`)
}
if (!built) process.exit(1)

const sourceApk = path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const releaseDir = path.join(rootDir, 'releases')
const releaseName = `jieban-v${version.versionName}.apk`
const releaseApk = path.join(releaseDir, releaseName)
await mkdir(releaseDir, { recursive: true })
await copyFile(sourceApk, releaseApk)

const apkBytes = await readFile(releaseApk)
const apkStat = await stat(releaseApk)
const updatedVersion = {
  ...version,
  publishedAt: new Date().toISOString(),
  downloadUrl: `https://github.com/JiuGaaa/jieban-tuimian-radar/releases/download/v${version.versionName}/${releaseName}`,
  sha256: createHash('sha256').update(apkBytes).digest('hex'),
  sizeBytes: apkStat.size
}
const serialized = `${JSON.stringify(updatedVersion, null, 2)}\n`
await Promise.all([
  writeFile(versionPath, serialized, 'utf8'),
  writeFile(path.join(rootDir, 'public', 'api', 'version.json'), serialized, 'utf8')
])

console.log(JSON.stringify({ apk: releaseApk, sha256: updatedVersion.sha256, sizeBytes: updatedVersion.sizeBytes }, null, 2))
