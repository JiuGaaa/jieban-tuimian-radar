import { describe, expect, it } from 'vitest'
import { emptyProfile } from '../data/notices'
import type { UserAppSnapshot } from '../types'
import { isUserAppSnapshot, mergeAppSnapshots } from './accountData'

function snapshot(overrides: Partial<UserAppSnapshot> = {}): UserAppSnapshot {
  return {
    profile: emptyProfile,
    savedNoticeIds: [],
    claimedNoticeIds: [],
    tasks: [],
    ...overrides
  }
}

describe('account data merge', () => {
  it('keeps the more complete profile and unions notice ids', () => {
    const local = snapshot({
      profile: { ...emptyProfile, school: '集美大学', major: '轮机工程', rank: 2, cohortSize: 40 },
      savedNoticeIds: ['local']
    })
    const cloud = snapshot({
      profile: { ...emptyProfile, school: '旧学校' },
      savedNoticeIds: ['cloud']
    })

    const merged = mergeAppSnapshots(local, cloud)
    expect(merged.profile.school).toBe('集美大学')
    expect(merged.savedNoticeIds).toEqual(['cloud', 'local'])
  })

  it('never turns a completed task back into an open task', () => {
    const local = snapshot({
      tasks: [{ id: 'task-1', title: '本机任务', group: '准备', completed: false, source: '本机' }]
    })
    const cloud = snapshot({
      tasks: [{ id: 'task-1', title: '云端任务', group: '准备', completed: true, source: '云端' }]
    })

    expect(mergeAppSnapshots(local, cloud).tasks[0].completed).toBe(true)
  })

  it('rejects malformed cloud payloads', () => {
    expect(isUserAppSnapshot({ profile: {}, tasks: [] })).toBe(false)
    expect(isUserAppSnapshot(snapshot())).toBe(true)
  })
})
