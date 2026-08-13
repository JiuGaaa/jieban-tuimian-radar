import type { Notice, NoticePhase } from '../types'
import { compareNoticePriority } from './universityPriority'

export type NoticePhaseFilter = '全部' | NoticePhase

export function normalizeNoticeSearch(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, ' ')
    .trim()
}

export function noticeSearchText(notice: Notice) {
  return normalizeNoticeSearch([
    notice.university,
    notice.institute,
    notice.title,
    notice.summary,
    notice.phase,
    notice.targetYear,
    ...notice.tags
  ].join(' '))
}

export function noticeMatchesFilter(notice: Notice, phase: NoticePhaseFilter, search: string) {
  const matchesPhase = phase === '全部' || notice.phase === phase
  const query = normalizeNoticeSearch(search)
  return matchesPhase && (!query || noticeSearchText(notice).includes(query))
}

export function filterNotices(notices: Notice[], phase: NoticePhaseFilter, search: string) {
  return notices.filter((notice) => noticeMatchesFilter(notice, phase, search)).sort(compareNoticePriority)
}

export function noticeResultKey(notices: Notice[], phase: NoticePhaseFilter, search: string) {
  return `${phase}:${normalizeNoticeSearch(search)}:${notices.map((notice) => notice.id).join('|')}`
}
