import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const accountServiceConfigured = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase = accountServiceConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'yituerjiu:auth'
      }
    })
  : null

export function getAuthRedirectUrl() {
  const configured = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim()
  if (configured) return configured
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}
