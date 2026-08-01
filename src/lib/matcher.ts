import type { MatchCheck, MatchResult, UserProfile } from '../types'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function calculateJmuSampleMatch(profile: UserProfile): MatchResult {
  const rank = typeof profile.rank === 'number' ? profile.rank : null
  const cohortSize = typeof profile.cohortSize === 'number' && profile.cohortSize > 0 ? profile.cohortSize : null
  const rankRate = rank !== null && cohortSize !== null ? rank / cohortSize : null
  const hasEnglish = typeof profile.cet4 === 'number' || typeof profile.cet6 === 'number'
  const cet4 = typeof profile.cet4 === 'number' ? profile.cet4 : 0
  const cet6 = typeof profile.cet6 === 'number' ? profile.cet6 : 0
  const standardEnglish = cet4 >= 480 || cet6 >= 400
  const specialEnglish = cet4 >= 425 || cet6 >= 400
  const standardRank = rankRate !== null ? rankRate <= 0.3 : null
  const specialRank = rankRate !== null ? rankRate <= 0.5 : null

  const pathway = profile.specialTalent ? '特殊学术专长路径' : '普通路径'
  const rankPass = profile.specialTalent ? specialRank : standardRank
  const englishPass = profile.specialTalent ? specialEnglish : standardEnglish

  const checks: MatchCheck[] = [
    {
      label: profile.specialTalent ? '专业排名前50%' : '专业排名前30%',
      passed: rankPass,
      detail: rankRate === null ? '请填写专业排名与年级人数' : `当前约为前 ${(rankRate * 100).toFixed(1)}%`
    },
    {
      label: profile.specialTalent ? 'CET-4 ≥ 425 或 CET-6 ≥ 400' : 'CET-4 ≥ 480 或 CET-6 ≥ 400',
      passed: hasEnglish ? englishPass : null,
      detail: hasEnglish ? `CET-4 ${cet4 || '未填'} · CET-6 ${cet6 || '未填'}` : '请至少填写一项英语成绩'
    },
    {
      label: '前六学期无补考或重新学习',
      passed: !profile.hasMakeup,
      detail: profile.hasMakeup ? '当前选择为“有记录”' : '当前选择为“无记录”'
    },
    {
      label: '纪律处分条件',
      passed: !profile.hasDisciplinaryIssue,
      detail: profile.hasDisciplinaryIssue ? '需按当年度正式文件人工复核' : '未填写影响资格的处分记录'
    }
  ]

  if (profile.specialTalent) {
    checks.push({
      label: '特殊学术专长证明',
      passed: profile.researchCount > 0 || profile.competitionLevel === '国家级',
      detail: '论文、发明专利、A类竞赛及教授推荐仍需学院审核'
    })
  }

  const requiredFields = [profile.school, profile.major, profile.cohortSize, profile.rank, profile.gpa, hasEnglish ? 'yes' : '']
  const completeness = Math.round((requiredFields.filter((item) => item !== '').length / requiredFields.length) * 100)

  let score = 0
  if (rankRate !== null) {
    score += rankRate <= 0.1 ? 35 : rankRate <= 0.2 ? 31 : rankRate <= 0.3 ? 26 : rankRate <= 0.5 ? 16 : 6
  }
  if (hasEnglish) {
    score += cet6 >= 520 || cet4 >= 550 ? 20 : standardEnglish ? 17 : specialEnglish ? 12 : 4
  }
  if (typeof profile.gpa === 'number') {
    score += clamp((profile.gpa / profile.gpaScale) * 20, 0, 20)
  }
  score += clamp(profile.researchCount * 4, 0, 12)
  score += profile.competitionLevel === '国家级' ? 8 : profile.competitionLevel === '省级' ? 5 : profile.competitionLevel === '校级' ? 2 : 0
  score += profile.hasMakeup ? 0 : 3
  score += profile.hasDisciplinaryIssue ? 0 : 2

  const knownChecks = checks.filter((check) => check.passed !== null)
  const qualified = completeness < 67 ? null : knownChecks.every((check) => check.passed === true)
  const matchScore = completeness < 50 ? 0 : Math.round(clamp(score, 0, 100))

  return {
    qualified,
    pathway,
    matchScore,
    completeness,
    checks,
    summary:
      qualified === null
        ? '信息还不完整，补齐档案后再判断。'
        : qualified
          ? '按2027届本地样本的硬门槛，你当前满足基础条件。28届仍须以新文件为准。'
          : '当前至少有一项硬门槛未满足，请查看下方原因并等待28届正式规则。'
  }
}
