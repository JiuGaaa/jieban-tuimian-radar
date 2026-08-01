import { Capacitor } from '@capacitor/core'

const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')
const staticApi = import.meta.env.VITE_STATIC_API === '1'

export function buildApiUrl(resource: 'notices' | 'version', cacheBust = false) {
  const suffix = staticApi ? '.json' : ''
  const query = cacheBust ? `?t=${Date.now()}` : ''

  if (configuredBase) return `${configuredBase}/api/${resource}${suffix}${query}`
  if (Capacitor.isNativePlatform()) return null
  return `/api/${resource}${query}`
}

