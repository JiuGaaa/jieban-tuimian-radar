import type { TaskItem, UserAppSnapshot, UserProfile } from '../types'

function hasValue(value: UserProfile[keyof UserProfile]) {
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  return false
}

export function profileInformationScore(profile: UserProfile) {
  const weightedFields: Array<keyof UserProfile> = [
    'school',
    'major',
    'cohortSize',
    'rank',
    'gpa',
    'cet4',
    'cet6',
    'targetRegions'
  ]
  const filled = weightedFields.reduce((score, key) => score + (hasValue(profile[key]) ? 1 : 0), 0)
  return filled + Math.min(profile.researchCount, 2) * 0.25 + (profile.competitionLevel === '无' ? 0 : 0.25)
}

function mergeTasks(localTasks: TaskItem[], cloudTasks: TaskItem[]) {
  const tasks = new Map<string, TaskItem>()
  for (const task of cloudTasks) tasks.set(task.id, task)
  for (const task of localTasks) {
    const cloudTask = tasks.get(task.id)
    tasks.set(task.id, cloudTask ? { ...cloudTask, ...task, completed: cloudTask.completed || task.completed } : task)
  }
  return [...tasks.values()]
}

export function mergeAppSnapshots(local: UserAppSnapshot, cloud: UserAppSnapshot): UserAppSnapshot {
  const localProfileScore = profileInformationScore(local.profile)
  const cloudProfileScore = profileInformationScore(cloud.profile)
  return {
    profile: localProfileScore > cloudProfileScore ? local.profile : cloud.profile,
    savedNoticeIds: [...new Set([...cloud.savedNoticeIds, ...local.savedNoticeIds])],
    claimedNoticeIds: [...new Set([...cloud.claimedNoticeIds, ...local.claimedNoticeIds])],
    tasks: mergeTasks(local.tasks, cloud.tasks)
  }
}

export function isUserAppSnapshot(value: unknown): value is UserAppSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<UserAppSnapshot>
  return Boolean(
    snapshot.profile &&
    typeof snapshot.profile === 'object' &&
    Array.isArray(snapshot.savedNoticeIds) &&
    Array.isArray(snapshot.claimedNoticeIds) &&
    Array.isArray(snapshot.tasks)
  )
}
