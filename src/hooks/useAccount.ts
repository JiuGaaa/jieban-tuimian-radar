import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { accountServiceConfigured, getAuthRedirectUrl, supabase } from '../lib/supabase'

export type AuthMode = 'signin' | 'signup' | 'recovery'

export interface AuthActionResult {
  ok: boolean
  message: string
  needsEmailConfirmation?: boolean
}

function authErrorMessage(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) return '邮箱或密码不正确'
  if (normalized.includes('email not confirmed')) return '请先打开验证邮件完成邮箱确认'
  if (normalized.includes('user already registered')) return '这个邮箱已经注册，请直接登录'
  if (normalized.includes('password should be')) return '密码至少需要 8 位'
  if (normalized.includes('rate limit')) return '操作过于频繁，请稍后再试'
  if (normalized.includes('network') || normalized.includes('fetch')) return '网络连接失败，请检查网络后重试'
  return message || '账号服务暂时不可用，请稍后再试'
}

export function useAccount() {
  const [user, setUser] = useState<User | null>(null)
  const [initializing, setInitializing] = useState(accountServiceConfigured)
  const [recoveryRequested, setRecoveryRequested] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(data.session?.user ?? null)
      setInitializing(false)
    })
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      setInitializing(false)
      if (event === 'PASSWORD_RECOVERY') setRecoveryRequested(true)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    if (!supabase) return { ok: false, message: '账号服务尚未配置' }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    return error ? { ok: false, message: authErrorMessage(error.message) } : { ok: true, message: '登录成功，正在同步档案' }
  }, [])

  const signUp = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    if (!supabase) return { ok: false, message: '账号服务尚未配置' }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: getAuthRedirectUrl() }
    })
    if (error) return { ok: false, message: authErrorMessage(error.message) }
    const needsEmailConfirmation = !data.session
    return {
      ok: true,
      needsEmailConfirmation,
      message: needsEmailConfirmation ? '验证邮件已发送，确认邮箱后即可登录' : '账号已创建，正在同步档案'
    }
  }, [])

  const sendPasswordReset = useCallback(async (email: string): Promise<AuthActionResult> => {
    if (!supabase) return { ok: false, message: '账号服务尚未配置' }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: getAuthRedirectUrl() })
    return error ? { ok: false, message: authErrorMessage(error.message) } : { ok: true, message: '重置邮件已发送，请打开邮件继续' }
  }, [])

  const updatePassword = useCallback(async (password: string): Promise<AuthActionResult> => {
    if (!supabase) return { ok: false, message: '账号服务尚未配置' }
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return { ok: false, message: authErrorMessage(error.message) }
    setRecoveryRequested(false)
    return { ok: true, message: '密码已更新' }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }, [])

  return {
    configured: accountServiceConfigured,
    user,
    initializing,
    recoveryRequested,
    signIn,
    signUp,
    sendPasswordReset,
    updatePassword,
    signOut
  }
}
