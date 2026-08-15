import { describe, expect, it } from 'vitest'
import type { Notice, TaskItem } from '../types'
import { buildClaimTasks, mergeClaimTasks } from './claimTasks'

const notice: Notice = {
  id: 'demo-policy',
  university: '示例大学',
  institute: '研究生院',
  title: '接收推荐免试研究生通知',
  summary: '请查看官方原文',
  phase: '本校推免',
  status: 'new',
  sourceName: '示例大学研究生招生网',
  sourceUrl: 'https://example.edu.cn/policy.htm',
  publishedAt: '2026-08-15T00:00:00+08:00',
  checkedAt: '2026-08-15T00:00:00+08:00',
  targetYear: '2027',
  officialLevel: 'B',
  verificationStatus: 'official-online',
  sourceDomain: 'example.edu.cn',
  discoveredBy: 'official-index',
  tags: ['推免'],
  requirements: [],
  materials: []
}

describe('claim task generation', () => {
  it('always creates an actionable task when the official page has no structured materials', () => {
    const tasks = buildClaimTasks(notice)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ noticeId: notice.id, group: '准备', completed: false })
  })

  it('adds structured material and deadline tasks when available', () => {
    const tasks = buildClaimTasks({
      ...notice,
      deadline: '2026-09-01T23:59:00+08:00',
      materials: ['成绩单', '排名证明']
    })
    expect(tasks.map((task) => task.group)).toEqual(['准备', '材料', '材料', '报名'])
    expect(tasks.every((task) => task.noticeId === notice.id)).toBe(true)
  })

  it('backfills missing tasks without duplicating or resetting existing work', () => {
    const completedTask: TaskItem = { ...buildClaimTasks(notice)[0], completed: true }
    const current = [completedTask]
    expect(mergeClaimTasks(current, buildClaimTasks(notice))).toBe(current)

    const expanded = buildClaimTasks({ ...notice, materials: ['成绩单'] })
    const merged = mergeClaimTasks(current, expanded)
    expect(merged).toHaveLength(2)
    expect(merged[0].completed).toBe(true)
  })
})
