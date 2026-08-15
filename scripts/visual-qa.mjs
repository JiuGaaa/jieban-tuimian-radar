import puppeteer from 'puppeteer-core'
import { readFile } from 'node:fs/promises'

const version = JSON.parse(await readFile(new URL('../data/version.json', import.meta.url), 'utf8'))

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  timeout: 90_000,
  protocolTimeout: 120_000,
  userDataDir: '.toolchains/qa-chrome-profile',
  args: ['--no-first-run', '--disable-gpu', '--disable-gpu-sandbox', '--no-sandbox', '--disable-dev-shm-usage', '--disable-features=ServiceWorker']
})
console.log('[qa] browser launched')

const context = await browser.createBrowserContext()
const page = await context.newPage()
const errors = []
await page.setCacheEnabled(false)
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text())
})
page.on('response', (response) => {
  if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`)
})

await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
const response = await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 15_000 })
console.log(`[qa] navigation ${response?.status() || 'unknown'}`)
await page.waitForSelector('.app-shell')
console.log('[qa] app mounted')
await page.waitForSelector('.notice-main', { timeout: 15_000 })
console.log('[qa] notice feed rendered')
await page.waitForFunction(() => Number(document.querySelector('.metric-strip > div:first-child strong')?.textContent || '0') >= 59, { timeout: 20_000 })
const monitoredUniversityCount = Number(await page.$eval('.metric-strip > div:first-child strong', (element) => element.textContent || '0'))

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
await page.waitForSelector('.account-card')
const accountCard = await page.evaluate(() => ({
  status: document.querySelector('.account-state')?.textContent || '',
  loginEnabled: !(document.querySelector('.account-actions .primary-button'))?.disabled,
  registerEnabled: !(document.querySelector('.account-actions .secondary-button'))?.disabled
}))
await page.click('.account-actions .secondary-button')
await page.waitForSelector('.auth-dialog')
await new Promise((resolve) => setTimeout(resolve, 260))
await page.screenshot({ path: 'qa-mobile-auth.png', fullPage: false })
const authDialog = await page.evaluate(() => ({
  title: document.querySelector('#auth-dialog-title')?.textContent || '',
  emailInput: Boolean(document.querySelector('.auth-dialog input[type="email"]')),
  passwordInputs: document.querySelectorAll('.auth-dialog input[type="password"]').length
}))
await page.click('.auth-dialog .icon-button')
await page.waitForSelector('.auth-dialog', { hidden: true })
await page.$eval('.update-status', (element) => element.scrollIntoView({ block: 'center' }))
await new Promise((resolve) => setTimeout(resolve, 100))
await page.$eval('.device-card', async (element) => {
  await element.animate([], { duration: 1 }).finished
})
await (await page.$('.device-card'))?.screenshot({ path: 'qa-mobile-update.png' })
const updateText = await page.$eval('.update-status', (element) => element.textContent || '')

await page.evaluate(() => {
  const navButtons = document.querySelectorAll('.bottom-nav button')
  navButtons[1]?.click()
})
await page.waitForSelector('.notice-main')

const allResultCount = await page.$$eval('.notice-card', (elements) => elements.length)
await page.$$eval('.chip-row button', (buttons) => {
  const summerButton = [...buttons].find((button) => button.textContent === '夏令营')
  summerButton?.click()
})
await page.waitForFunction(() => document.querySelector('.notice-stack')?.getAttribute('data-phase') === '夏令营')
const summerFilter = await page.evaluate(() => ({
  captionCount: Number(document.querySelector('.result-caption span')?.textContent?.match(/\d+/)?.[0] || 0),
  cardCount: document.querySelectorAll('.notice-card').length,
  phases: [...document.querySelectorAll('.notice-card')].map((card) => card.getAttribute('data-phase'))
}))
await page.type('.search-box input', '2027')
await page.waitForFunction(() => document.querySelector('.notice-stack')?.getAttribute('data-query') === '2027')
const combinedFilter = await page.evaluate(() => ({
  captionCount: Number(document.querySelector('.result-caption span')?.textContent?.match(/\d+/)?.[0] || 0),
  cardCount: document.querySelectorAll('.notice-card').length,
  allMatch: [...document.querySelectorAll('.notice-card')].every((card) => (
    card.getAttribute('data-phase') === '夏令营' && card.getAttribute('data-search-text')?.includes('2027')
  ))
}))
await page.focus('.search-box input')
await page.keyboard.down('Control')
await page.keyboard.press('A')
await page.keyboard.up('Control')
await page.keyboard.press('Backspace')
await page.$$eval('.chip-row button', (buttons) => {
  const allButton = [...buttons].find((button) => button.textContent === '全部')
  allButton?.click()
})
await page.waitForFunction(() => (
  document.querySelector('.notice-stack')?.getAttribute('data-phase') === '全部' &&
  document.querySelector('.notice-stack')?.getAttribute('data-query') === ''
))
const restoredResultCount = await page.$$eval('.notice-card', (elements) => elements.length)
await page.evaluate(() => {
  const noticeButton = document.querySelector('.notice-main[data-has-materials="false"]')
  noticeButton?.click()
})
await page.waitForSelector('.notice-dialog')
const noMaterialNoticeId = await page.$eval('.notice-dialog', (element) => element.getAttribute('data-notice-id') || '')
const noMaterialDialogCount = await page.$$eval('.notice-dialog .material-list li', (elements) => elements.length)
await page.click('.notice-dialog .primary-button')
await page.waitForSelector(`.task-row[data-notice-id="${noMaterialNoticeId}"]`)
const noMaterialClaimFlow = await page.evaluate((noticeId) => ({
  tasksTabActive: document.querySelector('.bottom-nav button:nth-child(3)')?.classList.contains('active') ?? false,
  generatedTaskCount: document.querySelectorAll(`.task-row[data-notice-id="${noticeId}"]`).length,
  generatedTitles: [...document.querySelectorAll(`.task-row[data-notice-id="${noticeId}"] .task-copy strong`)].map((element) => element.textContent || '')
}), noMaterialNoticeId)

await page.evaluate(() => {
  const navButtons = document.querySelectorAll('.bottom-nav button')
  navButtons[1]?.click()
})
await page.waitForSelector('.notice-main[data-has-materials="true"]')
await page.evaluate(() => {
  const noticeButton = document.querySelector('.notice-main[data-has-materials="true"]')
  noticeButton?.click()
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

const blockingErrors = errors.filter((error) => !/^HTTP 502 http:\/\/127\.0\.0\.1:\d+\/api\/version/.test(error))
const filterQa = { allResultCount, summerFilter, combinedFilter, restoredResultCount }
console.log(JSON.stringify({ metrics, monitoredUniversityCount, accountCard, authDialog, updateText, filterQa, noMaterialDialogCount, noMaterialClaimFlow, dialogMetrics, claimFlow, errors, blockingErrors }, null, 2))
await browser.close()

if (
  metrics.documentWidth > metrics.viewportWidth ||
  metrics.bodyWidth > metrics.viewportWidth ||
  monitoredUniversityCount < 59 ||
  !accountCard.loginEnabled ||
  !accountCard.registerEnabled ||
  !authDialog.title.includes('创建云端账号') ||
  !authDialog.emailInput ||
  authDialog.passwordInputs !== 2 ||
  !updateText.includes(`v${version.versionName}`) ||
  summerFilter.cardCount === 0 ||
  summerFilter.captionCount !== summerFilter.cardCount ||
  summerFilter.phases.some((item) => item !== '夏令营') ||
  combinedFilter.captionCount !== combinedFilter.cardCount ||
  !combinedFilter.allMatch ||
  restoredResultCount !== allResultCount ||
  noMaterialDialogCount !== 0 ||
  !noMaterialClaimFlow.tasksTabActive ||
  noMaterialClaimFlow.generatedTaskCount < 1 ||
  !noMaterialClaimFlow.generatedTitles.some((title) => title.includes('核对官方原文')) ||
  dialogMetrics.requirementCount === 0 ||
  dialogMetrics.materialCount === 0 ||
  claimFlow.taskCount < 8 ||
  !claimFlow.tasksTabActive ||
  blockingErrors.length
) {
  process.exitCode = 1
}
