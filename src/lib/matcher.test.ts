import { describe, expect, it } from 'vitest'
import { emptyProfile } from '../data/notices'
import { calculateJmuSampleMatch } from './matcher'

describe('calculateJmuSampleMatch', () => {
  it('qualifies a complete standard-path profile', () => {
    const result = calculateJmuSampleMatch({
      ...emptyProfile,
      school: '集美大学',
      major: '轮机工程',
      rank: 18,
      cohortSize: 100,
      gpa: 3.6,
      cet4: 510
    })

    expect(result.qualified).toBe(true)
    expect(result.pathway).toBe('普通路径')
    expect(result.matchScore).toBeGreaterThan(60)
  })

  it('rejects a profile outside the standard rank threshold', () => {
    const result = calculateJmuSampleMatch({
      ...emptyProfile,
      school: '集美大学',
      major: '轮机工程',
      rank: 35,
      cohortSize: 100,
      gpa: 3.2,
      cet4: 500
    })

    expect(result.qualified).toBe(false)
    expect(result.checks[0].passed).toBe(false)
  })

  it('uses the relaxed rank and CET-4 thresholds for the special pathway', () => {
    const result = calculateJmuSampleMatch({
      ...emptyProfile,
      school: '集美大学',
      major: '轮机工程',
      rank: 40,
      cohortSize: 100,
      gpa: 3.3,
      cet4: 430,
      specialTalent: true,
      researchCount: 1
    })

    expect(result.qualified).toBe(true)
    expect(result.pathway).toBe('特殊学术专长路径')
  })
})
