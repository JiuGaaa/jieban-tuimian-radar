import { describe, expect, it } from 'vitest'
import { buildIndexedNotice, canonicalizeUrl, extractCandidates, extractDateValue, inferTargetYear, inferUniversity } from './sync.mjs'

const source = {
  id: 'test-university',
  allowedHosts: ['yz.example.edu.cn'],
  maxItems: 10
}

describe('official source crawler', () => {
  it('keeps relevant official links and rejects unrelated or off-domain links', () => {
    const html = `
      <a href="/2026/0801/policy/page.htm">2028年接收推荐免试研究生通知</a>
      <a href="/news/campus.htm">校园开放日</a>
      <a href="https://example.com/fake.htm">2028年推免通知</a>
    `
    expect(extractCandidates(html, source, 'https://yz.example.edu.cn/list.htm')).toEqual([
      {
        title: '2028年接收推荐免试研究生通知',
        url: 'https://yz.example.edu.cn/2026/0801/policy/page.htm',
        indexedByUrl: 'https://yz.example.edu.cn/list.htm',
        publishedAt: '2026-08-01T00:00:00+08:00'
      }
    ])
  })

  it('extracts dates beside links and includes experience camps', () => {
    const html = `
      <ul><li><a href="/camp/2027.htm">华南理工大学2027MBA青年领袖体验营</a><span>2026-08-07</span></li></ul>
    `
    expect(extractCandidates(html, {
      id: 'aggregator',
      allowedHosts: ['yz.chsi.com.cn'],
      maxItems: 10
    }, 'https://yz.chsi.com.cn/kyzx/yxzc/')[0]).toMatchObject({
      title: '华南理工大学2027MBA青年领袖体验营',
      publishedAt: '2026-08-07T00:00:00+08:00'
    })
  })

  it('recognizes day-first official directory dates and removes date markup from titles', () => {
    const markdown = '[21 2026.07 ### 北京邮电大学2027年接收优秀应届本科毕业生免试攻读研究生工作办法](https://yz.example.edu.cn/info/1011/1460.htm)'
    expect(extractCandidates(markdown, source, 'https://yz.example.edu.cn/', 'markdown')[0]).toEqual({
      title: '北京邮电大学2027年接收优秀应届本科毕业生免试攻读研究生工作办法',
      url: 'https://yz.example.edu.cn/info/1011/1460.htm',
      indexedByUrl: 'https://yz.example.edu.cn/',
      publishedAt: '2026-07-21T00:00:00+08:00'
    })
  })

  it('prefers an explicitly labelled publication date over a later verification date', () => {
    expect(extractDateValue('最近核验：2026-08-26 发布时间：2026-07-21')).toBe('2026-07-21T00:00:00+08:00')
  })

  it('never substitutes the verification time when the publication date is unknown', () => {
    const notice = buildIndexedNotice({
      title: '某大学2027年接收推荐免试研究生通知',
      url: 'https://yz.example.edu.cn/info/1001/1.htm',
      indexedByUrl: 'https://yz.example.edu.cn/'
    }, {
      name: '某大学研究生招生网',
      university: '某大学',
      institute: '研究生院',
      aggregator: false,
      officialLevel: 'B'
    }, '2026-08-26T02:00:00.000Z')

    expect(notice.checkedAt).toBe('2026-08-26T02:00:00.000Z')
    expect(notice).not.toHaveProperty('publishedAt')
  })

  it('normalizes mobile article URLs before deduplication', () => {
    expect(canonicalizeUrl('https://yz.neu.edu.cn/2026/0720/c5932a458191/pagem.htm#top'))
      .toBe('https://yz.neu.edu.cn/2026/0720/c5932a458191/page.htm')
  })

  it('never rewrites a 2027 notice as a 2028 notice', () => {
    expect(inferTargetYear('面向2027届优秀本科毕业生')).toBe('2027')
    expect(inferTargetYear('招收2027级推荐免试研究生')).toBe('2027')
    expect(inferTargetYear('华南理工大学2027MBA青年领袖体验营')).toBe('2027')
    expect(inferTargetYear('2028年接收推荐免试研究生')).toBe('2028')
    expect(inferTargetYear('当年度安排以正式通知为准')).toBe('长期有效')
  })

  it('infers and canonicalizes universities from aggregator titles', () => {
    expect(inferUniversity('清华大学经管学院2027年硕士推免最新通知', '研招网')).toBe('清华大学')
    expect(inferUniversity('国防科技大学2027年接收推免生通知', '研招网')).toBe('国防科学技术大学')
    expect(inferUniversity('某某研究院2027年推免通知', '研招网')).toBe('某某研究院')
  })
})
