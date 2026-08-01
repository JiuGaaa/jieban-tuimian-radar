import priorityData from '../../data/university-priority.json'
import type { Notice } from '../types'

export type UniversityTier = '国家级' | '985' | '211' | '其他'

const nationalSources = new Set(priorityData.national)
const schools985 = new Set(priorityData['985'])
const schools211 = new Set(priorityData['211Non985'])
const aliases = priorityData.aliases as Record<string, string>

function canonicalUniversity(name: string) {
  const compact = name.replace(/[()（）·\s]/g, '')
  return aliases[name] || aliases[compact] || name
}

export function getUniversityTier(university: string): UniversityTier {
  const canonical = canonicalUniversity(university)
  if (nationalSources.has(canonical)) return '国家级'
  if (schools985.has(canonical)) return '985'
  if (schools211.has(canonical)) return '211'
  return '其他'
}

const tierWeight: Record<UniversityTier, number> = {
  国家级: 0,
  '985': 1,
  '211': 2,
  其他: 3
}

const targetYearWeight: Record<Notice['targetYear'], number> = {
  '2028': 0,
  '2027': 1,
  长期有效: 2
}

export function compareNoticePriority(a: Notice, b: Notice) {
  const tierDifference = tierWeight[getUniversityTier(a.university)] - tierWeight[getUniversityTier(b.university)]
  if (tierDifference) return tierDifference
  const targetYearDifference = targetYearWeight[a.targetYear] - targetYearWeight[b.targetYear]
  if (targetYearDifference) return targetYearDifference
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
}
