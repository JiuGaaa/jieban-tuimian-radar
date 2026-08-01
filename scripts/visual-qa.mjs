import puppeteer from 'puppeteer-core'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: '.toolchains/qa-chrome-profile',
  args: ['--no-first-run', '--disable-gpu', '--disable-gpu-sandbox', '--no-sandbox', '--disable-dev-shm-usage']
})
console.log('[qa] browser launched')

const page = await browser.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
const response = await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 15_000 })
console.log(`[qa] navigation ${response?.status() || 'unknown'}`)
await page.waitForSelector('.app-shell')
console.log('[qa] app mounted')
await page.waitForSelector('.notice-main', { timeout: 15_000 })
console.log('[qa] notice feed rendered')

const metrics = await page.evaluate(() => ({
  viewportWidth: window.innerWidth,
  viewportHeight: window.innerHeight,
  documentWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.scrollWidth
}))

await page.screenshot({ path: 'qa-mobile-home.png', fullPage: false })
await page.evaluate(() => {
  const navButtons = document.querySelectorAll('.bottom-nav button')
  navButtons[3]?.click()
})
await new Promise((resolve) => setTimeout(resolve, 150))
await page.screenshot({ path: 'qa-mobile-profile.png', fullPage: false })
await page.$eval('.update-status', (element) => element.scrollIntoView({ block: 'center' }))
await new Promise((resolve) => setTimeout(resolve, 100))
await page.$eval('.device-card', async (element) => {
  await element.animate([], { duration: 1 }).finished
})
await (await page.$('.device-card'))?.screenshot({ path: 'qa-mobile-update.png' })
const updateText = await page.$eval('.update-status', (element) => element.textContent || '')

await page.evaluate(() => {
  const navButtons = document.querySelectorAll('.bottom-nav button')
  navButtons[0]?.click()
})
await page.waitForSelector('.notice-main')
await page.evaluate(() => {
  const noticeButtons = document.querySelectorAll('.notice-main')
  noticeButtons[0]?.click()
})
await page.waitForSelector('.notice-dialog')

const dialogMetrics = await page.evaluate(() => ({
  requirementCount: document.querySelectorAll('.notice-dialog .requirement-list > div').length,
  materialCount: document.querySelectorAll('.notice-dialog .material-list li').length
}))

await page.click('.notice-dialog .primary-button')
await page.waitForSelector('.task-row')
const claimFlow = await page.evaluate(() => ({
  taskCount: document.querySelectorAll('.task-row').length,
  tasksTabActive: document.querySelector('.bottom-nav button:nth-child(3)')?.classList.contains('active') ?? false
}))

console.log(JSON.stringify({ metrics, updateText, dialogMetrics, claimFlow, errors }, null, 2))
await browser.close()

if (
  metrics.documentWidth > metrics.viewportWidth ||
  metrics.bodyWidth > metrics.viewportWidth ||
  !updateText.includes('v1.0.0') ||
  dialogMetrics.requirementCount === 0 ||
  dialogMetrics.materialCount === 0 ||
  claimFlow.taskCount < 8 ||
  !claimFlow.tasksTabActive ||
  errors.length
) {
  process.exitCode = 1
}
