import { describe, expect, it } from 'vitest'
import type { Notice } from '../types'
import { filterNotices, normalizeNoticeSearch, noticeMatchesFilter, noticeResultKey } from './noticeFilter'

const baseNotice: Notice = {
  id: 'thu-2027',
  university: '清华大学',
  institute: '研究生院',
  title: '清华大学2027年接收推荐免试研究生办法',
  summary: '请打开官方原文核对报名要求',
  phase: '本校推免',
  status: 'new',
  sourceName: '清华大学研究生招生网',
  sourceUrl: 'https://yz.tsinghua.edu.cn/info/1024/3251.htm',
  publishedAt: '2026-08-01T00:00:00+08:00',
  checkedAt: '2026-08-13T00:00:00Z',
  targetYear: '2027',
  officialLevel: 'A',
  verificationStatus: 'official-online',
  sourceDomain: 'yz.tsinghua.edu.cn',
  discoveredBy: 'official-index',
  tags: ['推荐免试'],
  requirements: [],
  materials: []
}

const summerNotice: Notice = {
  ...baseNotice,
  id: 'zju-summer',
  university: '浙江大学',
  institute: '计算机学院',
  title: '2027年优秀大学生夏令营通知',
  phase: '夏令营'
}

describe('notice filters', () => {
  it('normalizes full-width characters, case and whitespace', () => {
    expect(normalizeNoticeSearch('  ＡI   2027  ')).toBe('ai 2027')
  })

  it('filters the rendered collection by phase', () => {
    expect(filterNotices([baseNotice, summerNotice], '夏令营', '')).toEqual([summerNotice])
  })

  it('searches university, institute, title, source and tags', () => {
    expect(noticeMatchesFilter(baseNotice, '全部', '清华')).toBe(true)
    expect(noticeMatchesFilter(summerNotice, '全部', '计算机学院')).toBe(true)
    expect(noticeMatchesFilter(baseNotice, '全部', '推荐免试')).toBe(true)
    expect(filterNotices([baseNotice, summerNotice], '全部', '不存在的院校')).toEqual([])
  })

  it('combines search and phase and changes the render key', () => {
    expect(filterNotices([baseNotice, summerNotice], '夏令营', '清华')).toEqual([])
    expect(noticeResultKey([baseNotice], '全部', '')).not.toBe(noticeResultKey([summerNotice], '夏令营', '2027'))
  })
})
