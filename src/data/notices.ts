import verifiedNotices from '../../data/verified-notices.json'
import type { Notice, TaskItem, UserProfile } from '../types'

export const verifiedSeedNotices = verifiedNotices as Notice[]

export const initialTasks: TaskItem[] = [
  {
    id: 'starter-profile',
    title: '完善个人档案，解锁资格判断',
    group: '准备',
    completed: false,
    source: '系统引导'
  },
  {
    id: 'starter-targets',
    title: '确定首批关注院校清单',
    group: '准备',
    completed: false,
    source: '系统引导'
  },
  {
    id: 'starter-notification',
    title: '开启政策通知并完成测试',
    group: '提醒',
    completed: false,
    source: '系统引导'
  }
]

export const emptyProfile: UserProfile = {
  school: '',
  major: '',
  cohortSize: '',
  rank: '',
  gpa: '',
  gpaScale: 4,
  cet4: '',
  cet6: '',
  hasMakeup: false,
  hasDisciplinaryIssue: false,
  specialTalent: false,
  researchCount: 0,
  competitionLevel: '无',
  targetRegions: ''
}
