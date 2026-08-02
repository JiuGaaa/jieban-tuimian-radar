import { useCallback, useEffect, useRef, useState } from 'react'
import { isUserAppSnapshot, mergeAppSnapshots } from '../lib/accountData'
import { supabase } from '../lib/supabase'
import type { CloudSyncState, UserAppSnapshot } from '../types'

interface UseCloudSyncOptions {
  configured: boolean
  userId: string | null
  snapshot: UserAppSnapshot
  applySnapshot: (snapshot: UserAppSnapshot) => void
}

interface CloudRow {
  snapshot: unknown
  updated_at: string
}

export function useCloudSync({ configured, userId, snapshot, applySnapshot }: UseCloudSyncOptions) {
  const [state, setState] = useState<CloudSyncState>(configured ? 'signed-out' : 'disabled')
  const [message, setMessage] = useState(configured ? '登录后自动同步' : '账号服务尚未连接')
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const readyUserRef = useRef<string | null>(null)
  const snapshotRef = useRef(snapshot)
  const applySnapshotRef = useRef(applySnapshot)

  snapshotRef.current = snapshot
  applySnapshotRef.current = applySnapshot

  const save = useCallback(async (targetUserId: string, nextSnapshot: UserAppSnapshot) => {
    if (!supabase) throw new Error('账号服务尚未配置')
    const updatedAt = new Date().toISOString()
    const { error } = await supabase.from('user_app_data').upsert(
      { user_id: targetUserId, snapshot: nextSnapshot, updated_at: updatedAt },
      { onConflict: 'user_id' }
    )
    if (error) throw error
    setLastSyncedAt(updatedAt)
  }, [])

  const loadAndMerge = useCallback(async (targetUserId: string) => {
    if (!supabase) throw new Error('账号服务尚未配置')
    const { data, error } = await supabase
      .from('user_app_data')
      .select('snapshot, updated_at')
      .eq('user_id', targetUserId)
      .maybeSingle<CloudRow>()
    if (error) throw error
    const local = snapshotRef.current
    const merged = data && isUserAppSnapshot(data.snapshot) ? mergeAppSnapshots(local, data.snapshot) : local
    applySnapshotRef.current(merged)
    await save(targetUserId, merged)
    return data?.updated_at ?? null
  }, [save])

  useEffect(() => {
    readyUserRef.current = null
    if (!configured) {
      setState('disabled')
      setMessage('账号服务尚未连接')
      return
    }
    if (!userId) {
      setState('signed-out')
      setMessage('登录后自动同步')
      return
    }

    let active = true
    setState('loading')
    setMessage('正在合并本机与云端档案')
    void loadAndMerge(userId)
      .then(() => {
        if (!active) return
        readyUserRef.current = userId
        setState('synced')
        setMessage('档案、收藏和作战台已同步')
      })
      .catch((error: Error) => {
        if (!active) return
        setState('error')
        setMessage(error.message || '云端同步失败')
      })
    return () => {
      active = false
    }
  }, [configured, loadAndMerge, userId])

  useEffect(() => {
    if (!userId || readyUserRef.current !== userId) return
    setState('syncing')
    setMessage('正在保存最新修改')
    const timer = window.setTimeout(() => {
      void save(userId, snapshotRef.current)
        .then(() => {
          setState('synced')
          setMessage('所有修改已保存到云端')
        })
        .catch((error: Error) => {
          setState('error')
          setMessage(error.message || '云端同步失败')
        })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [save, snapshot, userId])

  const syncNow = useCallback(async () => {
    if (!userId) return false
    setState('syncing')
    setMessage('正在核对云端档案')
    try {
      await loadAndMerge(userId)
      readyUserRef.current = userId
      setState('synced')
      setMessage('本机与云端已是最新状态')
      return true
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : '云端同步失败')
      return false
    }
  }, [loadAndMerge, userId])

  return { state, message, lastSyncedAt, syncNow }
}
