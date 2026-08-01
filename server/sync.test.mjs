import { describe, expect, it } from 'vitest'
import { canonicalizeUrl, extractCandidates, inferTargetYear } from './sync.mjs'

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
      { title: '2028年接收推荐免试研究生通知', url: 'https://yz.example.edu.cn/2026/0801/policy/page.htm' }
    ])
  })

  it('normalizes mobile article URLs before deduplication', () => {
    expect(canonicalizeUrl('https://yz.neu.edu.cn/2026/0720/c5932a458191/pagem.htm#top'))
      .toBe('https://yz.neu.edu.cn/2026/0720/c5932a458191/page.htm')
  })

  it('never rewrites a 2027 notice as a 2028 notice', () => {
    expect(inferTargetYear('面向2027届优秀本科毕业生')).toBe('2027')
    expect(inferTargetYear('2028年接收推荐免试研究生')).toBe('2028')
    expect(inferTargetYear('当年度安排以正式通知为准')).toBe('长期有效')
  })
})
