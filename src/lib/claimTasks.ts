import type { Notice, TaskItem } from '../types'

export function buildClaimTasks(notice: Notice): TaskItem[] {
  const source = `${notice.university} · ${notice.institute}`
  const tasks: TaskItem[] = [
    {
      id: `${notice.id}:review-official`,
      noticeId: notice.id,
      title: '核对官方原文并整理申请要求与材料清单',
      group: '准备',
      dueAt: notice.deadline,
      completed: false,
      source
    },
    ...notice.materials.map((material, index): TaskItem => ({
      id: `${notice.id}:material:${index}`,
      noticeId: notice.id,
      title: material,
      group: '材料',
      dueAt: notice.deadline,
      completed: false,
      source
    }))
  ]

  if (notice.deadline) {
    tasks.push({
      id: `${notice.id}:submit-before-deadline`,
      noticeId: notice.id,
      title: '确认报名入口并在截止时间前完成提交',
      group: '报名',
      dueAt: notice.deadline,
      completed: false,
      source
    })
  }

  return tasks
}

export function mergeClaimTasks(current: TaskItem[], generated: TaskItem[]) {
  const existingIds = new Set(current.map((task) => task.id))
  const missing = generated.filter((task) => !existingIds.has(task.id))
  return missing.length ? [...current, ...missing] : current
}
