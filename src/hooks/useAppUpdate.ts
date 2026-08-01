import { useCallback, useEffect, useState } from 'react'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import bundledVersion from '../../data/version.json'
import { buildApiUrl } from '../lib/api'

export interface AppVersionInfo {
  versionCode: number
  versionName: string
  minimumSupportedVersionCode: number
  publishedAt: string
  releaseNotes: string[]
  downloadUrl: string
  sha256: string
  sizeBytes: number
}

export type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'error'

export const currentVersionCode = Number(import.meta.env.VITE_APP_VERSION_CODE || bundledVersion.versionCode)
export const currentVersionName = String(import.meta.env.VITE_APP_VERSION_NAME || bundledVersion.versionName)

function validateVersion(value: unknown): AppVersionInfo | null {
  if (!value || typeof value !== 'object') return null
  const version = value as Partial<AppVersionInfo>
  if (
    !Number.isInteger(version.versionCode) ||
    typeof version.versionName !== 'string' ||
    typeof version.downloadUrl !== 'string' ||
    !version.downloadUrl.startsWith('https://') ||
    !Array.isArray(version.releaseNotes)
  ) return null
  return version as AppVersionInfo
}

export function useAppUpdate() {
  const [state, setState] = useState<UpdateState>('idle')
  const [latest, setLatest] = useState<AppVersionInfo | null>(null)
  const [message, setMessage] = useState('尚未检查更新')

  const check = useCallback(async (manual = false) => {
    const target = buildApiUrl('version', true)
    if (!target) {
      setState('error')
      setMessage('当前版本未配置公网更新服务')
      return null
    }
    setState('checking')
    setMessage('正在检查新版本')
    try {
      const response = await fetch(target, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const version = validateVersion(await response.json())
      if (!version) throw new Error('版本信息格式不正确')
      setLatest(version)
      if (version.versionCode > currentVersionCode) {
        setState('available')
        setMessage(`发现新版本 v${version.versionName}`)
      } else {
        setState('current')
        setMessage(manual ? '已经是最新版本' : `当前为最新版本 v${currentVersionName}`)
      }
      return version
    } catch (error) {
      setState('error')
      setMessage(`检查失败：${String(error instanceof Error ? error.message : error)}`)
      return null
    }
  }, [])

  const download = useCallback(async () => {
    if (!latest?.downloadUrl) return
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: latest.downloadUrl })
    } else {
      window.open(latest.downloadUrl, '_blank', 'noopener,noreferrer')
    }
  }, [latest])

  useEffect(() => {
    void check(false)
  }, [check])

  return { state, latest, message, check, download }
}
