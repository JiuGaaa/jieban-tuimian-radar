import { createClient } from 'npm:@supabase/supabase-js@2.111.0'
import * as cheerio from 'npm:cheerio@1.2.0'

type Source = {
  id: string
  name: string
  university: string
  institute?: string
  indexUrl: string
  baseDomain?: string
  allowedHosts?: string[]
  officialLevel?: 'A' | 'B'
  maxItems?: number
  maxSections?: number
  aggregator?: boolean
  inferUniversity?: boolean
}

type Candidate = {
  title: string
  url: string
  indexedByUrl: string
  publishedAt?: string
}

type Document = {
  content: string
  finalUrl: string
  format: 'html' | 'markdown'
  transport: 'direct' | 'reader'
}

const SOURCE_URL = 'https://raw.githubusercontent.com/JiuGaaa/jieban-tuimian-radar/main/data/sources.json'
const PRIORITY_URL = 'https://raw.githubusercontent.com/JiuGaaa/jieban-tuimian-radar/main/data/university-priority.json'
const FALLBACK_SOURCES: Source[] = [
  {
    id: 'chsi-tuimian-guides',
    name: '研招网推免招生简章',
    university: '研招网',
    institute: '推免招生简章',
    indexUrl: 'https://yz.chsi.com.cn/kyzx/zsjz/tmjz/',
    allowedHosts: ['yz.chsi.com.cn', '*.edu.cn', '*.gov.cn', 'mp.weixin.qq.com'],
    officialLevel: 'A',
    maxItems: 100,
    aggregator: true,
    inferUniversity: true
  },
  {
    id: 'chsi-policy',
    name: '研招网院校政策',
    university: '研招网',
    institute: '院校政策',
    indexUrl: 'https://yz.chsi.com.cn/kyzx/yxzc/',
    allowedHosts: ['yz.chsi.com.cn', '*.edu.cn', '*.gov.cn', 'mp.weixin.qq.com'],
    officialLevel: 'A',
    maxItems: 100,
    aggregator: true,
    inferUniversity: true
  }
]

const KEYWORDS = /推免|推荐免试|免试攻读|优秀大学生(?:暑期|夏令营)?|大学生暑期夏令营|预报名|预推免|直博|体验营|研修营|研究生(?:招生)?开放日|学术开放日/
const EXCLUDE_KEYWORDS = /拟录取.*公示|录取名单公示|调档政审|组织关系转接|寄送体检单|本校硕博连读|转博生工作|研究生.*暑期学校/
const SECTION_KEYWORDS = /^(?:硕士招生|博士招生|研究生招生|招生信息|招生动态|招生公告|通知公告|招生简章|推免招生|夏令营|预推免|招生工作)$/
const FETCH_TIMEOUT_MS = 14_000

function normalizeText(value = '') {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeSource(source: Source): Required<Pick<Source, 'id' | 'name' | 'university' | 'institute' | 'indexUrl' | 'officialLevel' | 'maxItems' | 'maxSections' | 'aggregator' | 'inferUniversity'>> & Source & { allowedHosts: string[] } {
  const hostname = new URL(source.indexUrl).hostname
  return {
    institute: '研究生院',
    officialLevel: 'B',
    maxItems: source.aggregator ? 100 : 4,
    maxSections: source.baseDomain ? 3 : 0,
    aggregator: false,
    inferUniversity: false,
    ...source,
    allowedHosts: source.allowedHosts || [hostname, ...(source.baseDomain ? [`*.${source.baseDomain}`] : [])]
  }
}

function hostMatches(host: string, patterns: string[]) {
  return patterns.some((pattern) => pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern)
}

function canonicalizeUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  url.pathname = url.pathname.replace(/\/pagem\.htm$/i, '/page.htm')
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|from$|spm$)/i.test(key)) url.searchParams.delete(key)
  }
  return url.href
}

function isOfficialUrl(url: URL, source: ReturnType<typeof normalizeSource>) {
  return ['http:', 'https:'].includes(url.protocol) && hostMatches(url.hostname, source.allowedHosts)
}

async function fetchDirect(url: string): Promise<Document> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; JiebanTuimianRadar/0.3)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9'
      }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error(`非HTML响应：${contentType}`)
    return { content: await response.text(), finalUrl: response.url || url, format: 'html', transport: 'direct' }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchDocument(url: string): Promise<Document> {
  try {
    return await fetchDirect(url)
  } catch (directError) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS + 6_000)
    try {
      const response = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers: { accept: 'text/plain' } })
      if (!response.ok) throw directError
      return { content: await response.text(), finalUrl: url, format: 'markdown', transport: 'reader' }
    } finally {
      clearTimeout(timer)
    }
  }
}

async function mapConcurrent<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const output: Array<PromiseSettledResult<R>> = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      try {
        output[index] = { status: 'fulfilled', value: await mapper(items[index]) }
      } catch (reason) {
        output[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return output
}

function extractDate(text: string, url = '') {
  const match = /(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/.exec(text)
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00+08:00`
  const pathDate = /\/(20\d{2})\/(\d{2})(\d{2})\//.exec(url)
  return pathDate ? `${pathDate[1]}-${pathDate[2]}-${pathDate[3]}T00:00:00+08:00` : undefined
}

function markdownLinks(content: string) {
  const links: Array<{ title: string; href: string; index: number }> = []
  const pattern = /\[([^\]]{1,180})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g
  let match
  while ((match = pattern.exec(content))) links.push({ title: normalizeText(match[1]), href: match[2], index: match.index })
  return links
}

function documentLinks(document: Document) {
  if (document.format === 'markdown') return markdownLinks(document.content)
  const $ = cheerio.load(document.content)
  const links: Array<{ title: string; href: string; context: string }> = []
  $('a[href]').each((_, element) => {
    const node = $(element)
    const container = node.closest('li, tr, article, .news, .list, .item, .news-item, .list-item')
    links.push({
      title: normalizeText(node.attr('title') || node.text()),
      href: node.attr('href') || '',
      context: normalizeText((container.length ? container.first() : node.parent()).text())
    })
  })
  return links
}

function extractCandidates(document: Document, source: ReturnType<typeof normalizeSource>) {
  const candidates = new Map<string, Candidate>()
  for (const link of documentLinks(document)) {
    if (link.title.length < 8 || link.title.length > 160 || !KEYWORDS.test(link.title) || EXCLUDE_KEYWORDS.test(link.title)) continue
    try {
      const url = new URL(link.href, document.finalUrl)
      if (!isOfficialUrl(url, source)) continue
      const canonicalUrl = canonicalizeUrl(url.href)
      const markdownContext = 'index' in link ? normalizeText(document.content.slice(Math.max(0, link.index - 80), link.index + link.title.length + 140)) : ''
      const publishedAt = extractDate('context' in link ? link.context : markdownContext, canonicalUrl)
      candidates.set(canonicalUrl, { title: link.title, url: canonicalUrl, indexedByUrl: document.finalUrl, ...(publishedAt ? { publishedAt } : {}) })
    } catch {
      // Ignore malformed links.
    }
  }
  return [...candidates.values()]
}

function sectionUrls(document: Document, source: ReturnType<typeof normalizeSource>) {
  const urls = new Set<string>()
  for (const link of documentLinks(document)) {
    if (link.title.length > 20 || !SECTION_KEYWORDS.test(link.title.replace(/\s/g, ''))) continue
    try {
      const url = new URL(link.href, document.finalUrl)
      if (isOfficialUrl(url, source)) urls.add(canonicalizeUrl(url.href))
    } catch {
      // Ignore malformed links.
    }
  }
  return [...urls].filter((url) => url !== canonicalizeUrl(document.finalUrl)).slice(0, source.maxSections)
}

function inferTargetYear(text: string) {
  if (/2028(?:届|级|MBA|年)/i.test(text)) return '2028'
  if (/2027(?:届|级|MBA|年)/i.test(text)) return '2027'
  return '长期有效'
}

function phase(title: string) {
  if (/夏令营|体验营|研修营|开放日/.test(title)) return '夏令营'
  if (/预推免|预报名/.test(title)) return '预推免'
  return '本校推免'
}

async function stableId(url: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return `live-${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 16)}`
}

function inferUniversity(title: string, source: ReturnType<typeof normalizeSource>, knownNames: string[], aliases: Record<string, string>) {
  if (!source.inferUniversity) return source.university
  for (const name of knownNames) {
    if (title.includes(name)) return aliases[name] || name
  }
  return /^([^：:，,。；;]{2,30}?(?:大学|学院|研究院))(?:[：:\s]|20\d{2}|关于)/.exec(title)?.[1] || source.university
}

async function crawlSource(sourceInput: Source, checkedAt: string, knownNames: string[], aliases: Record<string, string>) {
  const source = normalizeSource(sourceInput)
  const root = await fetchDocument(source.indexUrl)
  const sections = await mapConcurrent(sectionUrls(root, source), 3, fetchDocument)
  const documents = [root, ...sections.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])]
  const candidates = new Map<string, Candidate>()
  for (const document of documents) {
    for (const candidate of extractCandidates(document, source)) candidates.set(candidate.url, candidate)
  }
  const current = [...candidates.values()].filter((candidate) => {
    if (inferTargetYear(candidate.title) !== '长期有效') return true
    return candidate.publishedAt ? Date.now() - new Date(candidate.publishedAt).getTime() <= 270 * 86_400_000 : false
  }).sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()).slice(0, source.maxItems)
  const notices = await Promise.all(current.map(async (candidate) => {
    const publishedAt = candidate.publishedAt || checkedAt
    const daysOld = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 86_400_000)
    const university = inferUniversity(candidate.title, source, knownNames, aliases)
    return {
      id: await stableId(candidate.url),
      university,
      institute: source.aggregator ? '研究生招生' : source.institute,
      title: candidate.title,
      summary: `${source.name}已收录该通知，请打开官方原文核对条件、材料和截止时间。`,
      phase: phase(candidate.title),
      status: daysOld <= 7 ? 'new' : 'updated',
      sourceName: source.name,
      sourceUrl: candidate.url,
      publishedAt,
      checkedAt,
      targetYear: inferTargetYear(candidate.title),
      officialLevel: source.officialLevel,
      verificationStatus: 'official-indexed',
      sourceDomain: new URL(candidate.url).hostname,
      discoveredBy: source.aggregator ? 'official-aggregator' : 'official-index',
      indexedByUrl: candidate.indexedByUrl,
      tags: [source.aggregator ? '研招网自动发现' : '官网目录自动发现', phase(candidate.title)],
      requirements: [
        { label: '来源核验', value: source.aggregator ? '已由研招网官方索引收录' : `已由${university}官网目录收录` },
        { label: '全文状态', value: '请打开原文核对完整细则', tone: 'warning' }
      ],
      materials: [],
      isPriority: daysOld <= 21
    }
  }))
  return { notices, transport: new Set(documents.map((document) => document.transport)).size > 1 ? 'mixed' : root.transport }
}

function noticeIdentity(notice: Record<string, unknown>) {
  return `${notice.university}|${String(notice.title).replace(/[\s：:，,。；;（）()“”"']/g, '').toLowerCase()}`
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: existingRow } = await supabase.from('official_notice_feed').select('feed, updated_at').eq('id', 'current').maybeSingle()
  const force = request.headers.get('x-force-sync') === '1'
  if (!force && existingRow?.updated_at && Date.now() - new Date(existingRow.updated_at).getTime() < 5 * 60_000) {
    return Response.json({ ok: true, skipped: true, updatedAt: existingRow.updated_at })
  }

  const startedAt = Date.now()
  const checkedAt = new Date().toISOString()
  let sources = FALLBACK_SOURCES
  let priority = { '985': [] as string[], '211Non985': [] as string[], aliases: {} as Record<string, string> }
  try {
    const [sourceResponse, priorityResponse] = await Promise.all([fetch(SOURCE_URL, { cache: 'no-store' }), fetch(PRIORITY_URL, { cache: 'no-store' })])
    if (sourceResponse.ok) sources = await sourceResponse.json()
    if (priorityResponse.ok) priority = await priorityResponse.json()
  } catch {
    // The two official CHSI fallbacks still keep the feed updating.
  }
  const knownNames = [...new Set([...priority['985'], ...priority['211Non985'], ...Object.keys(priority.aliases)])].sort((a, b) => b.length - a.length)
  const crawlResults = await mapConcurrent(sources, 7, (source) => crawlSource(source, checkedAt, knownNames, priority.aliases))
  const discovered = crawlResults.flatMap((result) => result.status === 'fulfilled' ? result.value.notices : [])
  const merged = new Map<string, Record<string, unknown>>()
  for (const notice of existingRow?.feed?.notices || []) {
    const title = String(notice.title || '')
    const publishedAt = new Date(String(notice.publishedAt || 0)).getTime()
    const isLongTerm = notice.targetYear === '长期有效'
    if (EXCLUDE_KEYWORDS.test(title)) continue
    if (isLongTerm && (!Number.isFinite(publishedAt) || Date.now() - publishedAt > 540 * 24 * 60 * 60_000)) continue
    merged.set(noticeIdentity(notice), notice)
  }
  for (const notice of discovered) merged.set(noticeIdentity(notice), notice)
  const statuses = crawlResults.map((result, index) => ({
    id: sources[index].id,
    name: sources[index].name,
    url: sources[index].indexUrl,
    ok: result.status === 'fulfilled',
    checkedAt,
    itemCount: result.status === 'fulfilled' ? result.value.notices.length : 0,
    ...(result.status === 'fulfilled' ? { transport: result.value.transport } : { error: String(result.reason) })
  }))
  const notices = [...merged.values()].sort((a, b) => new Date(String(b.publishedAt)).getTime() - new Date(String(a.publishedAt)).getTime())
  const successfulSourceCount = statuses.filter((source) => source.ok).length
  const feed = {
    notices,
    meta: {
      lastSyncedAt: checkedAt,
      nextSyncAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      sourceCount: statuses.length,
      successfulSourceCount,
      failedSourceCount: statuses.length - successfulSourceCount,
      monitoredUniversityCount: new Set(sources.filter((source) => !source.aggregator).map((source) => source.university)).size,
      discoveredUniversityCount: new Set(notices.map((notice) => notice.university)).size,
      durationMs: Date.now() - startedAt,
      mode: successfulSourceCount ? 'live' : 'cached',
      sources: statuses
    }
  }
  const { error } = await supabase.from('official_notice_feed').upsert({ id: 'current', feed, updated_at: checkedAt })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, noticeCount: notices.length, successfulSources: `${successfulSourceCount}/${statuses.length}`, updatedAt: checkedAt })
})
