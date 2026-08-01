import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as cheerio from 'cheerio'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const seedNotices = JSON.parse(await readFile(path.join(rootDir, 'data', 'verified-notices.json'), 'utf8'))
const sourceDefinitions = JSON.parse(await readFile(path.join(rootDir, 'data', 'sources.json'), 'utf8'))
const universityPriorityData = JSON.parse(await readFile(path.join(rootDir, 'data', 'university-priority.json'), 'utf8'))

const nationalSources = new Set(universityPriorityData.national)
const schools985 = new Set(universityPriorityData['985'])
const schools211 = new Set(universityPriorityData['211Non985'])
const universityAliases = universityPriorityData.aliases
const tierWeight = { '国家级': 0, '985': 1, '211': 2, '其他': 3 }
const targetYearWeight = { '2028': 0, '2027': 1, '长期有效': 2 }

const SYNC_INTERVAL_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 12_000
const KEYWORDS = /推免|推荐免试|优秀大学生(?:暑期|夏令营)|大学生暑期夏令营|预报名|直博/

let activeSync = null
let feed = {
  notices: seedNotices,
  meta: {
    lastSyncedAt: null,
    nextSyncAt: null,
    sourceCount: sourceDefinitions.length + seedNotices.length,
    successfulSourceCount: 0,
    mode: 'seed',
    sources: []
  }
}

function normalizeText(value = '') {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function canonicalUniversity(name) {
  const compact = name.replace(/[()（）·\s]/g, '')
  return universityAliases[name] || universityAliases[compact] || name
}

export function getUniversityTier(university) {
  const canonical = canonicalUniversity(university)
  if (nationalSources.has(canonical)) return '国家级'
  if (schools985.has(canonical)) return '985'
  if (schools211.has(canonical)) return '211'
  return '其他'
}

export function compareNoticesByPriority(a, b) {
  const tierDifference = tierWeight[getUniversityTier(a.university)] - tierWeight[getUniversityTier(b.university)]
  if (tierDifference) return tierDifference
  const targetYearDifference = targetYearWeight[a.targetYear] - targetYearWeight[b.targetYear]
  if (targetYearDifference) return targetYearDifference
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
}

function hostMatches(host, patterns) {
  return patterns.some((pattern) => {
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1))
    return host === pattern
  })
}

function isOfficialCandidate(url, source) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const patterns = source.id === 'chsi-policy'
    ? [...source.allowedHosts, '*.edu.cn', '*.gov.cn']
    : source.allowedHosts
  return hostMatches(url.hostname, patterns)
}

export function canonicalizeUrl(value) {
  const url = new URL(value)
  url.hash = ''
  url.pathname = url.pathname.replace(/\/pagem\.htm$/i, '/page.htm')
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|from$|spm$)/i.test(key)) url.searchParams.delete(key)
  }
  return url.href
}

async function fetchHtml(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'JiebanTuimianRadar/0.2 (+official-policy-monitor; contact-local-user)',
        accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error(`非HTML响应：${contentType || 'unknown'}`)
    }
    const buffer = await response.arrayBuffer()
    const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.replace(/["']/g, '') || 'utf-8'
    let html
    try {
      html = new TextDecoder(charset).decode(buffer)
    } catch {
      html = new TextDecoder('utf-8').decode(buffer)
    }
    return { html, finalUrl: response.url || url }
  } finally {
    clearTimeout(timeout)
  }
}

function parseDate(text, url) {
  const direct = /(?:发布时间|发布日期|更新时间|时间|日期)[：:\s]*(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/i.exec(text)
    || /(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/.exec(text)
  if (direct) {
    const [, year, month, day] = direct
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+08:00`
  }
  const fromUrl = /\/(20\d{2})\/(\d{2})(\d{2})\//.exec(url)
  if (fromUrl) return `${fromUrl[1]}-${fromUrl[2]}-${fromUrl[3]}T00:00:00+08:00`
  return new Date().toISOString()
}

function classifyPhase(title) {
  if (/夏令营|暑期学术/.test(title)) return '夏令营'
  if (/预推免|预报名/.test(title)) return '预推免'
  if (/教育部|国家|管理规定/.test(title)) return '国家政策'
  return '本校推免'
}

export function inferTargetYear(text) {
  if (/2028届|2028年(?:接收|毕业)/.test(text)) return '2028'
  if (/2027届|2027年(?:接收|毕业|推免)/.test(text)) return '2027'
  return '长期有效'
}

function extractSummary($, source) {
  const selectors = ['.wp_articlecontent p', '#vsb_content p', '.v_news_content p', '.article-content p', 'article p']
  for (const selector of selectors) {
    const paragraphs = $(selector).toArray()
    for (const paragraph of paragraphs) {
      const value = normalizeText($(paragraph).text())
      if (value.length >= 36 && value.length <= 260 && !/版权所有|联系方式|地址：/.test(value)) {
        return value.length > 150 ? `${value.slice(0, 147)}…` : value
      }
    }
  }
  return `${source.name}官方页面已发布该通知，具体条件、材料和截止时间请以官方原文为准。`
}

export function extractCandidates(html, source, finalIndexUrl) {
  const $ = cheerio.load(html)
  const seen = new Set()
  const candidates = []
  $('a[href]').each((_, element) => {
    const title = normalizeText($(element).attr('title') || $(element).text())
    if (title.length < 8 || title.length > 140 || !KEYWORDS.test(title)) return
    let url
    try {
      url = new URL($(element).attr('href'), finalIndexUrl)
    } catch {
      return
    }
    url.hash = ''
    const canonicalUrl = canonicalizeUrl(url.href)
    if (!isOfficialCandidate(url, source) || canonicalUrl === finalIndexUrl || seen.has(canonicalUrl)) return
    seen.add(canonicalUrl)
    candidates.push({ title, url: canonicalUrl })
  })
  return candidates.slice(0, source.maxItems)
}

function stableId(url) {
  return `live-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`
}

async function hydrateCandidate(candidate, source, checkedAt) {
  const { html, finalUrl } = await fetchHtml(candidate.url)
  if (!isOfficialCandidate(new URL(finalUrl), source)) throw new Error('页面重定向到非官方域名')
  const $ = cheerio.load(html)
  const pageText = normalizeText($.root().text())
  const heading = normalizeText($('h1').first().text() || $('.arti_title').first().text() || $('.article-title').first().text())
  const title = heading && KEYWORDS.test(heading) ? heading : candidate.title
  const publishedAt = parseDate(pageText, finalUrl)
  const daysOld = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 86_400_000)
  const canonicalUrl = canonicalizeUrl(finalUrl)
  const hostname = new URL(canonicalUrl).hostname
  return {
    id: stableId(canonicalUrl),
    university: source.university,
    institute: source.institute,
    title,
    summary: extractSummary($, source),
    phase: classifyPhase(title),
    status: daysOld <= 7 ? 'new' : 'updated',
    sourceName: source.name,
    sourceUrl: canonicalUrl,
    publishedAt,
    checkedAt,
    targetYear: inferTargetYear(`${title} ${pageText.slice(0, 5000)}`),
    officialLevel: source.officialLevel,
    verificationStatus: 'official-online',
    sourceDomain: hostname,
    discoveredBy: 'official-index',
    tags: ['官网自动发现', classifyPhase(title), hostname],
    requirements: [
      { label: '来源核验', value: `已核验为${source.university}官方域名` },
      { label: '自动提取', value: '未人工复核的细则请以官方原文为准', tone: 'warning' }
    ],
    materials: [],
    isPriority: daysOld <= 14
  }
}

async function crawlSource(source, checkedAt) {
  const { html, finalUrl } = await fetchHtml(source.indexUrl)
  const candidates = extractCandidates(html, source, finalUrl)
  const hydrated = await Promise.allSettled(candidates.map((candidate) => hydrateCandidate(candidate, source, checkedAt)))
  const notices = hydrated
    .flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    .filter((notice) => notice.targetYear !== '长期有效' || Date.now() - new Date(notice.publishedAt).getTime() <= 180 * 86_400_000)
  return { notices, candidateCount: candidates.length }
}

async function verifySeedNotice(notice, checkedAt) {
  if (!notice.sourceUrl) throw new Error('缺少官方原文链接')
  const sourceUrl = new URL(notice.sourceUrl)
  if (sourceUrl.hostname !== notice.sourceDomain) throw new Error('来源域名与白名单记录不一致')
  const { finalUrl } = await fetchHtml(notice.sourceUrl)
  if (new URL(finalUrl).hostname !== notice.sourceDomain) throw new Error('官方页面重定向后的域名不一致')
  return { ...notice, checkedAt }
}

function mergeNotices(verifiedSeeds, discovered) {
  const byUrl = new Map()
  for (const notice of [...discovered, ...verifiedSeeds]) byUrl.set(canonicalizeUrl(notice.sourceUrl), notice)
  return [...byUrl.values()].sort(compareNoticesByPriority)
}

async function performSync() {
  const checkedAt = new Date().toISOString()
  const [seedResults, crawlResults] = await Promise.all([
    Promise.allSettled(seedNotices.map((notice) => verifySeedNotice(notice, checkedAt))),
    Promise.allSettled(sourceDefinitions.map((source) => crawlSource(source, checkedAt)))
  ])

  const verifiedSeeds = seedResults.map((result, index) => result.status === 'fulfilled' ? result.value : seedNotices[index])
  const discovered = crawlResults.flatMap((result) => result.status === 'fulfilled' ? result.value.notices : [])

  const seedStatuses = seedResults.map((result, index) => ({
    id: `seed:${seedNotices[index].id}`,
    name: seedNotices[index].sourceName,
    url: seedNotices[index].sourceUrl,
    ok: result.status === 'fulfilled',
    checkedAt,
    itemCount: 1,
    ...(result.status === 'rejected' ? { error: String(result.reason?.message || result.reason) } : {})
  }))

  const crawlStatuses = crawlResults.map((result, index) => ({
    id: sourceDefinitions[index].id,
    name: sourceDefinitions[index].name,
    url: sourceDefinitions[index].indexUrl,
    ok: result.status === 'fulfilled',
    checkedAt,
    itemCount: result.status === 'fulfilled' ? result.value.notices.length : 0,
    ...(result.status === 'rejected' ? { error: String(result.reason?.message || result.reason) } : {})
  }))

  const statuses = [...crawlStatuses, ...seedStatuses]
  feed = {
    notices: mergeNotices(verifiedSeeds, discovered),
    meta: {
      lastSyncedAt: checkedAt,
      nextSyncAt: new Date(Date.now() + SYNC_INTERVAL_MS).toISOString(),
      sourceCount: statuses.length,
      successfulSourceCount: statuses.filter((source) => source.ok).length,
      mode: statuses.some((source) => source.ok) ? 'live' : 'seed',
      sources: statuses
    }
  }
  return feed
}

export function getFeed() {
  return feed
}

export function refreshFeed() {
  if (!activeSync) {
    activeSync = performSync().finally(() => {
      activeSync = null
    })
  }
  return activeSync
}

export const syncIntervalMs = SYNC_INTERVAL_MS
