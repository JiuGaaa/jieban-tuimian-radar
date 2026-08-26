import { useCallback, useEffect, useState } from 'react'
import { verifiedSeedNotices } from '../data/notices'
import { buildApiUrl } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { FeedMeta, Notice, NoticeFeed, SyncState } from '../types'

const CACHE_KEY = 'jieban:official-feed:v1'
const AUTO_REFRESH_MS = 5 * 60 * 1000

const seedMeta: FeedMeta = {
  lastSyncedAt: null,
  nextSyncAt: null,
  sourceCount: 0,
  successfulSourceCount: 0,
  mode: 'seed',
  sources: []
}

function readCache(): NoticeFeed | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? validateFeed(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function validateFeed(value: unknown): NoticeFeed | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<NoticeFeed>
  if (!Array.isArray(candidate.notices) || !candidate.meta) return null
  const notices = candidate.notices.filter((notice): notice is Notice => {
    if (!notice || !['official-online', 'official-indexed'].includes(notice.verificationStatus) || !notice.sourceUrl || !notice.sourceDomain) return false
    try {
      return new URL(notice.sourceUrl).hostname === notice.sourceDomain
    } catch {
      return false
    }
  }).map((notice) => {
    const publishedAt = new Date(notice.publishedAt || 0).getTime()
    const checkedAt = new Date(notice.checkedAt || 0).getTime()
    if (notice.verificationStatus !== 'official-indexed' || !Number.isFinite(publishedAt) || !Number.isFinite(checkedAt) || Math.abs(publishedAt - checkedAt) > 5 * 60_000) return notice
    const sanitized = { ...notice, status: 'updated' as const, isPriority: false }
    delete sanitized.publishedAt
    return sanitized
  })
  return notices.length ? { notices, meta: candidate.meta } : null
}

export function useNoticeFeed() {
  const [initialFeed] = useState<NoticeFeed | null>(() => readCache())
  const [notices, setNotices] = useState<Notice[]>(initialFeed?.notices || verifiedSeedNotices)
  const [meta, setMeta] = useState<FeedMeta>(initialFeed?.meta || seedMeta)
  const [syncState, setSyncState] = useState<SyncState>(initialFeed ? 'cached' : 'syncing')
  const [syncMessage, setSyncMessage] = useState(initialFeed ? '正在使用上次已核验数据' : '正在连接官方同步服务')

  const refresh = useCallback(async (manual = false) => {
    const target = buildApiUrl('notices', manual)
    setSyncState('syncing')
    setSyncMessage(manual ? '正在重新核验官方来源' : '正在同步官方来源')
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('official_notice_feed')
          .select('feed')
          .eq('id', 'current')
          .maybeSingle<{ feed: unknown }>()
        if (!error && data?.feed) {
          const cloudFeed = validateFeed(data.feed)
          if (cloudFeed) {
            setNotices(cloudFeed.notices)
            setMeta(cloudFeed.meta)
            setSyncState('online')
            setSyncMessage(`云端实时源已核验 ${cloudFeed.meta.successfulSourceCount}/${cloudFeed.meta.sourceCount} 个入口`)
            localStorage.setItem(CACHE_KEY, JSON.stringify(cloudFeed))
            return cloudFeed
          }
        }
      }
      if (!target) throw new Error('原生版尚未配置远程同步地址')
      const response = await fetch(target, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const next = validateFeed(await response.json())
      if (!next) throw new Error('同步服务返回的数据未通过来源校验')
      setNotices(next.notices)
      setMeta(next.meta)
      setSyncState('online')
      setSyncMessage(`已核验 ${next.meta.successfulSourceCount}/${next.meta.sourceCount} 个官方来源`)
      localStorage.setItem(CACHE_KEY, JSON.stringify(next))
      return next
    } catch (error) {
      setSyncState(initialFeed ? 'cached' : 'error')
      setSyncMessage(`联网失败，保留最后一次已核验数据：${String(error instanceof Error ? error.message : error)}`)
      return null
    }
  }, [initialFeed])

  useEffect(() => {
    void refresh(false)
    const interval = window.setInterval(() => void refresh(false), AUTO_REFRESH_MS)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh(false)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh])

  return { notices, meta, syncState, syncMessage, refresh }
}
