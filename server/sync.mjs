import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as cheerio from 'cheerio'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const seedNotices = JSON.parse(await readFile(path.join(rootDir, 'data', 'verified-notices.json'), 'utf8'))
const rawSourceDefinitions = JSON.parse(await readFile(path.join(rootDir, 'data', 'sources.json'), 'utf8'))
const universityPriorityData = JSON.parse(await readFile(path.join(rootDir, 'data', 'university-priority.json'), 'utf8'))

const nationalSources = new Set(universityPriorityData.national)
const schools985 = new Set(universityPriorityData['985'])
const schools211 = new Set(universityPriorityData['211Non985'])
const universityAliases = universityPriorityData.aliases
const knownUniversityNames = [
  ...new Set([
    ...universityPriorityData['985'],
    ...universityPriorityData['211Non985'],
    ...Object.keys(universityAliases)
  ])
].sort((a, b) => b.length - a.length)
const tierWeight = { '国家级': 0, '985': 1, '211': 2, '其他': 3 }
const targetYearWeight = { '2028': 0, '2027': 1, '长期有效': 2 }

const SYNC_INTERVAL_MS = 20 * 60 * 1000
const FETCH_TIMEOUT_MS = 14_000
const SOURCE_CONCURRENCY = 7
const PAGE_CONCURRENCY = 3
const KEYWORDS = /推免|推荐免试|免试攻读|优秀大学生(?:暑期|夏令营)?|大学生暑期夏令营|预报名|预推免|直博|体验营|研修营|研究生(?:招生)?开放日|学术开放日/
const EXCLUDE_KEYWORDS = /拟录取.*公示|录取名单公示|调档政审|组织关系转接|寄送体检单|本校硕博连读|转博生工作|研究生.*暑期学校/
const SECTION_KEYWORDS = /^(?:硕士招生|博士招生|研究生招生|招生信息|招生动态|招生公告|通知公告|招生简章|推免招生|夏令营|预推免|招生工作)$/

function normalizeSource(source, fallbackUrl = source.indexUrl) {
  const hostname = new URL(fallbackUrl).hostname
  const allowedHosts = source.allowedHosts || [hostname, ...(source.baseDomain ? [`*.${source.baseDomain}`] : [])]
  return {
    institute: '研究生院',
    officialLevel: 'B',
    maxItems: source.aggregator ? 100 : 4,
    maxSections: source.tier ? 3 : 0,
    discoverSections: Boolean(source.tier),
    fallbackToIndex: true,
    ...source,
    allowedHosts
  }
}

const sourceDefinitions = rawSourceDefinitions.map((source) => normalizeSource(source))

let activeSync = null
let feed = {
  notices: seedNotices,
  meta: {
    lastSyncedAt: null,
    nextSyncAt: null,
    sourceCount: sourceDefinitions.length,
    successfulSourceCount: 0,
    failedSourceCount: sourceDefinitions.length,
    monitoredUniversityCount: new Set(sourceDefinitions.filter((source) => !source.aggregator).map((source) => source.university)).size,
    discoveredUniversityCount: new Set(seedNotices.map((notice) => notice.university)).size,
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

export function inferUniversity(title, fallback = '其他院校') {
  const normalized = normalizeText(title)
  for (const name of knownUniversityNames) {
    if (normalized.includes(name)) return canonicalUniversity(name)
  }
  const prefix = /^([^：:，,。；;]{2,30}?(?:大学|学院|研究院))(?:[：:\s]|20\d{2}|关于)/.exec(normalized)?.[1]
  return prefix ? canonicalUniversity(prefix) : fallback
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
  const targetYearDifference = (targetYearWeight[a.targetYear] ?? 9) - (targetYearWeight[b.targetYear] ?? 9)
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
  return hostMatches(url.hostname, source.allowedHosts)
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

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = { status: 'fulfilled', value: await mapper(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

async function fetchDirect(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; JiebanTuimianRadar/0.3; +https://github.com/JiuGaaa/jieban-tuimian-radar)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6'
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
    let content
    try {
      content = new TextDecoder(charset).decode(buffer)
    } catch {
      content = new TextDecoder('utf-8').decode(buffer)
    }
    return { content, finalUrl: response.url || url, format: 'html', transport: 'direct' }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchReaderFallback(url, directError) {
  if (process.env.JINA_READER_FALLBACK === '0') throw directError
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS + 6_000)
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { accept: 'text/plain', 'user-agent': 'JiebanTuimianRadar/0.3' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`${directError.message}; Reader HTTP ${response.status}`)
    return { content: await response.text(), finalUrl: url, format: 'markdown', transport: 'reader' }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchDocument(url) {
  try {
    return await fetchDirect(url)
  } catch (error) {
    return fetchReaderFallback(url, error instanceof Error ? error : new Error(String(error)))
  }
}

function extractDateValue(text, url = '') {
  const direct = /(?:发布时间|发布日期|更新时间|时间|日期)[：:\s]*(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/i.exec(text)
    || /(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/.exec(text)
  if (direct) {
    const [, year, month, day] = direct
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+08:00`
  }
  const fromUrl = /\/(20\d{2})\/(\d{2})(\d{2})\//.exec(url)
  if (fromUrl) return `${fromUrl[1]}-${fromUrl[2]}-${fromUrl[3]}T00:00:00+08:00`
  return null
}

function parseDate(text, url, fallback) {
  return extractDateValue(text, url) || fallback || new Date().toISOString()
}

function classifyPhase(title) {
  if (/夏令营|暑期学术|体验营|研修营|暑期学校|开放日/.test(title)) return '夏令营'
  if (/预推免|预报名/.test(title)) return '预推免'
  if (/教育部|国家|管理规定/.test(title)) return '国家政策'
  return '本校推免'
}

export function inferTargetYear(text) {
  if (/2028(?:届|级|MBA|年)/i.test(text)) return '2028'
  if (/2027(?:届|级|MBA|年)/i.test(text)) return '2027'
  return '长期有效'
}

function extractSummaryFromHtml(content, source) {
  const $ = cheerio.load(content)
  const selectors = ['.wp_articlecontent p', '#vsb_content p', '.v_news_content p', '.article-content p', 'article p']
  for (const selector of selectors) {
    for (const paragraph of $(selector).toArray()) {
      const value = normalizeText($(paragraph).text())
      if (value.length >= 36 && value.length <= 320 && !/版权所有|联系方式|地址：/.test(value)) {
        return value.length > 150 ? `${value.slice(0, 147)}…` : value
      }
    }
  }
  return `${source.name}已发布该通知，具体条件、材料和截止时间请以官方原文为准。`
}

function extractSummaryFromMarkdown(content, source) {
  const body = content.replace(/^Title:.*$/im, '').replace(/^URL Source:.*$/im, '').replace(/^Markdown Content:.*$/im, '')
  const paragraph = body.split(/\n\s*\n/).map(normalizeText).find((value) => value.length >= 36 && value.length <= 320 && !/^\[|版权所有|联系方式/.test(value))
  return paragraph ? (paragraph.length > 150 ? `${paragraph.slice(0, 147)}…` : paragraph) : `${source.name}已发布该通知，具体条件、材料和截止时间请以官方原文为准。`
}

function buildCandidate(title, href, context, source, finalIndexUrl, seen, candidates) {
  if (title.length < 8 || title.length > 160 || !KEYWORDS.test(title) || EXCLUDE_KEYWORDS.test(title)) return
  let url
  try {
    url = new URL(href, finalIndexUrl)
  } catch {
    return
  }
  const canonicalUrl = canonicalizeUrl(url.href)
  if (!isOfficialCandidate(url, source) || canonicalUrl === canonicalizeUrl(finalIndexUrl) || seen.has(canonicalUrl)) return
  seen.add(canonicalUrl)
  const publishedAt = extractDateValue(context, canonicalUrl)
  candidates.push({
    title,
    url: canonicalUrl,
    indexedByUrl: finalIndexUrl,
    ...(publishedAt ? { publishedAt } : {})
  })
}

function extractHtmlCandidates(content, source, finalIndexUrl) {
  const $ = cheerio.load(content)
  const seen = new Set()
  const candidates = []
  $('a[href]').each((_, element) => {
    const title = normalizeText($(element).attr('title') || $(element).text())
    const contextNode = $(element).closest('li, tr, article, .news, .list, .item, .news-item, .list-item')
    const context = normalizeText((contextNode.length ? contextNode.first() : $(element).parent()).text())
    buildCandidate(title, $(element).attr('href'), context, source, finalIndexUrl, seen, candidates)
  })
  return candidates
}

function extractMarkdownLinks(content) {
  const links = []
  const pattern = /\[([^\]]{1,180})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g
  let match
  while ((match = pattern.exec(content))) {
    links.push({ title: normalizeText(match[1]), href: match[2], index: match.index })
  }
  return links
}

function extractMarkdownCandidates(content, source, finalIndexUrl) {
  const seen = new Set()
  const candidates = []
  for (const link of extractMarkdownLinks(content)) {
    const context = normalizeText(content.slice(Math.max(0, link.index - 80), link.index + link.title.length + 140))
    buildCandidate(link.title, link.href, context, source, finalIndexUrl, seen, candidates)
  }
  return candidates
}

export function extractCandidates(content, rawSource, finalIndexUrl, format = 'html') {
  const source = normalizeSource(rawSource, finalIndexUrl)
  const candidates = format === 'markdown'
    ? extractMarkdownCandidates(content, source, finalIndexUrl)
    : extractHtmlCandidates(content, source, finalIndexUrl)
  return candidates.slice(0, source.maxItems)
}

function discoverSectionUrls(document, source) {
  if (!source.discoverSections || source.maxSections <= 0) return []
  const links = []
  if (document.format === 'html') {
    const $ = cheerio.load(document.content)
    $('a[href]').each((_, element) => links.push({
      title: normalizeText($(element).attr('title') || $(element).text()),
      href: $(element).attr('href')
    }))
  } else {
    links.push(...extractMarkdownLinks(document.content))
  }
  const seen = new Set()
  const urls = []
  for (const link of links) {
    if (link.title.length > 20 || !SECTION_KEYWORDS.test(link.title.replace(/\s/g, ''))) continue
    try {
      const url = new URL(link.href, document.finalUrl)
      const canonicalUrl = canonicalizeUrl(url.href)
      if (!isOfficialCandidate(url, source) || seen.has(canonicalUrl) || canonicalUrl === canonicalizeUrl(document.finalUrl)) continue
      seen.add(canonicalUrl)
      urls.push(canonicalUrl)
    } catch {
      // Ignore malformed navigation links.
    }
  }
  return urls.slice(0, source.maxSections)
}

function stableId(url) {
  return `live-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`
}

function resolveUniversity(source, title) {
  return source.inferUniversity ? inferUniversity(title, source.university) : source.university
}

function buildIndexedNotice(candidate, source, checkedAt) {
  const publishedAt = candidate.publishedAt || checkedAt
  const daysOld = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 86_400_000)
  const hostname = new URL(candidate.url).hostname
  const university = resolveUniversity(source, candidate.title)
  return {
    id: stableId(candidate.url),
    university,
    institute: source.aggregator ? '研究生招生' : source.institute,
    title: candidate.title,
    summary: `${source.name}已收录该通知；自动同步暂未提取全文，请打开原文核对条件、材料和截止时间。`,
    phase: classifyPhase(candidate.title),
    status: daysOld <= 7 ? 'new' : 'updated',
    sourceName: source.name,
    sourceUrl: candidate.url,
    publishedAt,
    checkedAt,
    targetYear: inferTargetYear(candidate.title),
    officialLevel: source.officialLevel,
    verificationStatus: 'official-indexed',
    sourceDomain: hostname,
    discoveredBy: source.aggregator ? 'official-aggregator' : 'official-index',
    indexedByUrl: candidate.indexedByUrl,
    tags: [source.aggregator ? '研招网自动发现' : '官网目录自动发现', classifyPhase(candidate.title), hostname],
    requirements: [
      { label: '来源核验', value: source.aggregator ? '已由研招网官方索引收录' : `已由${university}官网目录收录` },
      { label: '全文状态', value: '未自动提取细则，请以原文为准', tone: 'warning' }
    ],
    materials: [],
    isPriority: daysOld <= 21
  }
}

async function hydrateCandidate(candidate, source, checkedAt) {
  const document = await fetchDocument(candidate.url)
  const finalUrl = document.finalUrl || candidate.url
  if (!isOfficialCandidate(new URL(finalUrl), source)) throw new Error('页面重定向到非官方域名')
  let pageText
  let heading = ''
  let summary
  if (document.format === 'html') {
    const $ = cheerio.load(document.content)
    pageText = normalizeText($.root().text())
    heading = normalizeText($('h1').first().text() || $('.arti_title').first().text() || $('.article-title').first().text())
    summary = extractSummaryFromHtml(document.content, source)
  } else {
    pageText = normalizeText(document.content)
    heading = normalizeText(/^Title:\s*(.+)$/im.exec(document.content)?.[1] || '')
    summary = extractSummaryFromMarkdown(document.content, source)
  }
  const title = heading && KEYWORDS.test(heading) ? heading : candidate.title
  const publishedAt = parseDate(pageText, finalUrl, candidate.publishedAt)
  const daysOld = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 86_400_000)
  const canonicalUrl = canonicalizeUrl(finalUrl)
  const hostname = new URL(canonicalUrl).hostname
  const university = resolveUniversity(source, `${candidate.title} ${title}`)
  return {
    id: stableId(canonicalUrl),
    university,
    institute: source.aggregator ? '研究生招生' : source.institute,
    title,
    summary,
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
    discoveredBy: source.aggregator ? 'official-aggregator' : 'official-index',
    indexedByUrl: candidate.indexedByUrl,
    tags: ['官网自动发现', classifyPhase(title), hostname, ...(document.transport === 'reader' ? ['只读代理核验'] : [])],
    requirements: [
      { label: '来源核验', value: source.aggregator ? '研招网索引及原文已在线核验' : `已核验为${university}官方域名` },
      { label: '自动提取', value: '未人工复核的细则请以官方原文为准', tone: 'warning' }
    ],
    materials: [],
    isPriority: daysOld <= 21
  }
}

function candidateIsCurrent(candidate) {
  if (inferTargetYear(candidate.title) !== '长期有效') return true
  if (!candidate.publishedAt) return false
  return Date.now() - new Date(candidate.publishedAt).getTime() <= 270 * 86_400_000
}

async function crawlSource(source, checkedAt) {
  const rootDocument = await fetchDocument(source.indexUrl)
  const sectionUrls = discoverSectionUrls(rootDocument, source)
  const sectionResults = await mapWithConcurrency(sectionUrls, PAGE_CONCURRENCY, fetchDocument)
  const documents = [rootDocument, ...sectionResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])]
  const candidateMap = new Map()
  for (const document of documents) {
    for (const candidate of extractCandidates(document.content, source, document.finalUrl, document.format)) {
      candidateMap.set(candidate.url, candidate)
    }
  }
  const candidates = [...candidateMap.values()]
    .filter(candidateIsCurrent)
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
    .slice(0, source.maxItems)
  const hydrated = await mapWithConcurrency(candidates, PAGE_CONCURRENCY, async (candidate) => {
    try {
      return await hydrateCandidate(candidate, source, checkedAt)
    } catch (error) {
      if (source.fallbackToIndex) return buildIndexedNotice(candidate, source, checkedAt)
      throw error
    }
  })
  const notices = hydrated.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const transports = new Set(documents.map((document) => document.transport))
  return {
    notices,
    candidateCount: candidates.length,
    transport: transports.size > 1 ? 'mixed' : [...transports][0] || 'direct'
  }
}

async function verifySeedNotice(notice, checkedAt) {
  if (!notice.sourceUrl) throw new Error('缺少官方原文链接')
  const sourceUrl = new URL(notice.sourceUrl)
  if (sourceUrl.hostname !== notice.sourceDomain) throw new Error('来源域名与白名单记录不一致')
  const document = await fetchDocument(notice.sourceUrl)
  if (new URL(document.finalUrl).hostname !== notice.sourceDomain) throw new Error('官方页面重定向后的域名不一致')
  return { ...notice, checkedAt }
}

function noticeQuality(notice) {
  return (notice.verificationStatus === 'official-online' ? 20 : 10) + notice.materials.length + notice.requirements.length
}

function noticeIdentity(notice) {
  const normalizedTitle = notice.title.replace(/[\s：:，,。；;（）()“”"']/g, '').toLowerCase()
  return `${canonicalUniversity(notice.university)}|${normalizedTitle}`
}

function mergeNotices(verifiedSeeds, discovered) {
  const byIdentity = new Map()
  for (const notice of [...verifiedSeeds, ...discovered]) {
    const identity = noticeIdentity(notice)
    const existing = byIdentity.get(identity)
    if (!existing || noticeQuality(notice) >= noticeQuality(existing)) byIdentity.set(identity, notice)
  }
  return [...byIdentity.values()].sort(compareNoticesByPriority)
}

async function performSync() {
  const startedAt = Date.now()
  const checkedAt = new Date().toISOString()
  const [seedResults, crawlResults] = await Promise.all([
    mapWithConcurrency(seedNotices, SOURCE_CONCURRENCY, (notice) => verifySeedNotice(notice, checkedAt)),
    mapWithConcurrency(sourceDefinitions, SOURCE_CONCURRENCY, (source) => crawlSource(source, checkedAt))
  ])

  const verifiedSeeds = seedResults.map((result, index) => result.status === 'fulfilled' ? result.value : seedNotices[index])
  const discovered = crawlResults.flatMap((result) => result.status === 'fulfilled' ? result.value.notices : [])
  const notices = mergeNotices(verifiedSeeds, discovered)
  const statuses = crawlResults.map((result, index) => ({
    id: sourceDefinitions[index].id,
    name: sourceDefinitions[index].name,
    url: sourceDefinitions[index].indexUrl,
    ok: result.status === 'fulfilled',
    checkedAt,
    itemCount: result.status === 'fulfilled' ? result.value.notices.length : 0,
    ...(result.status === 'fulfilled' ? { transport: result.value.transport } : { error: String(result.reason?.message || result.reason) })
  }))
  const successfulSourceCount = statuses.filter((source) => source.ok).length
  feed = {
    notices,
    meta: {
      lastSyncedAt: checkedAt,
      nextSyncAt: new Date(Date.now() + SYNC_INTERVAL_MS).toISOString(),
      sourceCount: statuses.length,
      successfulSourceCount,
      failedSourceCount: statuses.length - successfulSourceCount,
      monitoredUniversityCount: new Set(sourceDefinitions.filter((source) => !source.aggregator).map((source) => source.university)).size,
      discoveredUniversityCount: new Set(notices.map((notice) => notice.university)).size,
      durationMs: Date.now() - startedAt,
      mode: successfulSourceCount ? 'live' : 'seed',
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
