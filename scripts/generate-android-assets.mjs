import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const root = process.cwd()
const iconSvg = await readFile(path.join(root, 'public', 'icon.svg'), 'utf8')
const iconUrl = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--disable-gpu', '--no-first-run'] })

const densities = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432]
]

async function renderIcon(outputPath, size, round = false) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  const page = await browser.newPage()
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}img{display:block;width:100%;height:100%;${round ? 'border-radius:50%;' : ''}}</style><img src="${iconUrl}">`)
  await page.screenshot({ path: outputPath, omitBackground: true })
  await page.close()
}

for (const [density, launcherSize, foregroundSize] of densities) {
  const dir = path.join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`)
  await renderIcon(path.join(dir, 'ic_launcher.png'), launcherSize)
  await renderIcon(path.join(dir, 'ic_launcher_round.png'), launcherSize, true)
  await renderIcon(path.join(dir, 'ic_launcher_foreground.png'), foregroundSize)
}

const splashTargets = [
  ['drawable', 480, 320],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280]
]

for (const [folder, width, height] of splashTargets) {
  const outputPath = path.join(root, 'android', 'app', 'src', 'main', 'res', folder, 'splash.png')
  await mkdir(path.dirname(outputPath), { recursive: true })
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  const markSize = Math.max(86, Math.min(width, height) * 0.24)
  await page.setContent(`
    <style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
      body{display:grid;place-content:center;justify-items:center;background:#10243e;color:white;font-family:'Microsoft YaHei',sans-serif}
      img{width:${markSize}px;height:${markSize}px;filter:drop-shadow(0 12px 24px rgba(0,0,0,.2))}
      strong{margin-top:${Math.round(markSize * 0.18)}px;font-family:STZhongsong,serif;font-size:${Math.round(markSize * 0.3)}px;letter-spacing:.18em}
      span{margin-top:${Math.round(markSize * 0.08)}px;color:#b9c8d7;font-size:${Math.round(markSize * 0.105)}px;letter-spacing:.16em}
    </style>
    <img src="${iconUrl}"><strong>揭榜</strong><span>28 推免雷达</span>
  `)
  await page.screenshot({ path: outputPath })
  await page.close()
}

await browser.close()
console.log('Android launcher icons and splash screens generated.')
