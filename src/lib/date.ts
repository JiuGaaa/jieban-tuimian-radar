export function formatDate(date?: string) {
  if (!date) return '待官方发布'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date))
}

export function relativeDeadline(date?: string) {
  if (!date) return { label: '持续监测', tone: 'quiet' as const }
  const hours = Math.ceil((new Date(date).getTime() - Date.now()) / 3_600_000)
  if (hours < 0) return { label: '已截止', tone: 'closed' as const }
  if (hours <= 48) return { label: `剩 ${hours} 小时`, tone: 'urgent' as const }
  const days = Math.ceil(hours / 24)
  return { label: `剩 ${days} 天`, tone: days <= 7 ? ('warning' as const) : ('quiet' as const) }
}
