import { describe, expect, it } from 'vitest'
import priorityData from '../../data/university-priority.json'
import { getUniversityTier } from './universityPriority'

describe('university priority', () => {
  it('keeps the official project counts explicit', () => {
    expect(priorityData['985']).toHaveLength(39)
    expect(priorityData['985'].length + priorityData['211Non985'].length).toBe(112)
  })

  it('classifies national, 985, 211 and other sources', () => {
    expect(getUniversityTier('教育部')).toBe('国家级')
    expect(getUniversityTier('浙江大学')).toBe('985')
    expect(getUniversityTier('哈尔滨工程大学')).toBe('211')
    expect(getUniversityTier('普通高校')).toBe('其他')
  })

  it('supports current names for renamed military universities', () => {
    expect(getUniversityTier('国防科技大学')).toBe('985')
    expect(getUniversityTier('海军军医大学')).toBe('211')
    expect(getUniversityTier('空军军医大学')).toBe('211')
  })
})
