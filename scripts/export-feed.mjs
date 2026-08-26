import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalizeUrl, compareNoticesByPriority, refreshFeed } from '../server/sync.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = path.join(rootDir, 'public', 'api')
const EXCLUDE_KEYWORDS = /拟录取.*公示|录取名单公示|调档政审|组织关系转接|寄送体检单|本校硕博连读|转博生工作|研究生.*暑期学校/

function isVerifiedNotice(notice) {
  if (!notice || !['official-online', 'official-indexed'].includes(notice.verificationStatus) || !notice.sourceUrl || !notice.sourceDomain) return false
  if (EXCLUDE_KEYWORDS.test(String(notice.title || ''))) return false
  const publishedAt = new Date(String(notice.publishedAt || 0)).getTime()
  if (notice.targetYear === '长期有效' && (!Number.isFinite(publishedAt) || Date.now() - publishedAt > 540 * 24 * 60 * 60_000)) return false
  try {
    return new URL(notice.sourceUrl).hostname === notice.sourceDomain
  } catch {
    return false
  }
}

function sanitizeSyntheticPublishedAt(notice) {
  const publishedAt = new Date(String(notice?.publishedAt || 0)).getTime()
  const checkedAt = new Date(String(notice?.checkedAt || 0)).getTime()
  if (notice?.verificationStatus !== 'official-indexed' || !Number.isFinite(publishedAt) || !Number.isFinite(checkedAt) || Math.abs(publishedAt - checkedAt) > 5 * 60_000) return notice
  const sanitized = { ...notice, status: 'updated', isPriority: false }
  delete sanitized.publishedAt
  return sanitized
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
  const sanitizedNotice = sanitizeSyntheticPublishedAt(notice)
  if (isVerifiedNotice(sanitizedNotice)) merged.set(canonicalizeUrl(sanitizedNotice.sourceUrl), sanitizedNotice)
}
for (const notice of freshFeed.notices) {
  const sanitizedNotice = sanitizeSyntheticPublishedAt(notice)
  if (isVerifiedNotice(sanitizedNotice)) merged.set(canonicalizeUrl(sanitizedNotice.sourceUrl), sanitizedNotice)
}

const exportedFeed = {
  ...freshFeed,
  notices: [...merged.values()].sort(compareNoticesByPriority)
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
