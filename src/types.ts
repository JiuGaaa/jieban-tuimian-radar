export type TabId = 'home' | 'notices' | 'tasks' | 'profile'

export type NoticePhase = '国家政策' | '本校推免' | '夏令营' | '预推免' | '系统提醒'

export type NoticeStatus = 'new' | 'updated' | 'reference'

export type SyncState = 'syncing' | 'online' | 'cached' | 'error'

export interface RequirementLine {
  label: string
  value: string
  tone?: 'positive' | 'warning' | 'neutral'
}

export interface Notice {
  id: string
  university: string
  institute: string
  title: string
  summary: string
  phase: NoticePhase
  status: NoticeStatus
  sourceName: string
  sourceUrl?: string
  publishedAt?: string
  checkedAt: string
  deadline?: string
  targetYear: '2027' | '2028' | '长期有效'
  officialLevel: 'A' | 'B' | '本地样本'
  verificationStatus: 'official-online' | 'official-indexed' | 'official-local'
  sourceDomain: string
  discoveredBy: 'manual-verification' | 'official-index' | 'official-aggregator'
  indexedByUrl?: string
  tags: string[]
  requirements: RequirementLine[]
  materials: string[]
  isPriority?: boolean
}

export interface SourceSyncStatus {
  id: string
  name: string
  url: string
  ok: boolean
  checkedAt: string
  itemCount: number
  transport?: 'direct' | 'reader' | 'mixed'
  error?: string
}

export interface FeedMeta {
  lastSyncedAt: string | null
  nextSyncAt: string | null
  sourceCount: number
  successfulSourceCount: number
  failedSourceCount?: number
  monitoredUniversityCount?: number
  discoveredUniversityCount?: number
  durationMs?: number
  mode: 'live' | 'seed' | 'cached'
  sources: SourceSyncStatus[]
}

export interface NoticeFeed {
  notices: Notice[]
  meta: FeedMeta
}

export interface UserProfile {
  school: string
  major: string
  cohortSize: number | ''
  rank: number | ''
  gpa: number | ''
  gpaScale: 4 | 5
  cet4: number | ''
  cet6: number | ''
  hasMakeup: boolean
  hasDisciplinaryIssue: boolean
  specialTalent: boolean
  researchCount: number
  competitionLevel: '无' | '校级' | '省级' | '国家级'
  targetRegions: string
}

export interface MatchCheck {
  label: string
  passed: boolean | null
  detail: string
}

export interface MatchResult {
  qualified: boolean | null
  pathway: '普通路径' | '特殊学术专长路径' | '信息不足'
  matchScore: number
  completeness: number
  checks: MatchCheck[]
  summary: string
}

export interface TaskItem {
  id: string
  noticeId?: string
  title: string
  group: '准备' | '材料' | '报名' | '提醒'
  dueAt?: string
  completed: boolean
  source: string
}

export interface UserAppSnapshot {
  profile: UserProfile
  savedNoticeIds: string[]
  claimedNoticeIds: string[]
  tasks: TaskItem[]
}

export type CloudSyncState = 'disabled' | 'signed-out' | 'loading' | 'syncing' | 'synced' | 'error'
