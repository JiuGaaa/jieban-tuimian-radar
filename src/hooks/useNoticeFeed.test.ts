import { describe, expect, it } from 'vitest'
import { validateFeed } from './useNoticeFeed'

const baseNotice = {
  id: 'live-test',
  university: '北京邮电大学',
  institute: '研究生院',
  title: '北京邮电大学2027年接收推荐免试研究生工作办法',
  summary: '测试',
  phase: '本校推免',
  status: 'new',
  sourceName: '北京邮电大学研究生招生网',
  sourceUrl: 'https://yzb.bupt.edu.cn/info/1011/1460.htm',
  checkedAt: '2026-08-26T01:39:00.860Z',
  targetYear: '2027',
  officialLevel: 'B',
  verificationStatus: 'official-indexed',
  sourceDomain: 'yzb.bupt.edu.cn',
  discoveredBy: 'official-index',
  tags: [],
  requirements: [],
  materials: []
}

describe('notice feed date validation', () => {
  it('removes legacy verification timestamps that were stored as publication dates', () => {
    const feed = validateFeed({
      notices: [{ ...baseNotice, publishedAt: baseNotice.checkedAt }],
      meta: { sourceCount: 1, successfulSourceCount: 1, mode: 'live', sources: [] }
    })

    expect(feed?.notices[0].publishedAt).toBeUndefined()
    expect(feed?.notices[0].checkedAt).toBe(baseNotice.checkedAt)
  })

  it('keeps a real official publication date separate from verification time', () => {
    const feed = validateFeed({
      notices: [{ ...baseNotice, publishedAt: '2026-07-21T00:00:00+08:00' }],
      meta: { sourceCount: 1, successfulSourceCount: 1, mode: 'live', sources: [] }
    })

    expect(feed?.notices[0].publishedAt).toBe('2026-07-21T00:00:00+08:00')
    expect(feed?.notices[0].checkedAt).toBe(baseNotice.checkedAt)
  })
})
