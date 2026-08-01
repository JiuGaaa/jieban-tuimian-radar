import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Notice } from '../types'

export type NotificationState = 'granted' | 'denied' | 'unsupported' | 'prompt'

export async function getNotificationState(): Promise<NotificationState> {
  if (Capacitor.isNativePlatform()) {
    const permission = await LocalNotifications.checkPermissions()
    return permission.display === 'granted' ? 'granted' : permission.display === 'denied' ? 'denied' : 'prompt'
  }

  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission === 'default' ? 'prompt' : Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationState> {
  if (Capacitor.isNativePlatform()) {
    const permission = await LocalNotifications.requestPermissions()
    return permission.display === 'granted' ? 'granted' : 'denied'
  }

  if (!('Notification' in window)) return 'unsupported'
  const permission = await Notification.requestPermission()
  return permission === 'default' ? 'prompt' : permission
}

export async function sendTestNotification(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 2801,
          title: '揭榜 · 通知测试',
          body: '政策雷达已就位。检测到新的官方通知后会从这里提醒你。',
          schedule: { at: new Date(Date.now() + 1500) },
          extra: { route: '/notices' }
        }
      ]
    })
    return
  }

  if (Notification.permission === 'granted') {
    new Notification('揭榜 · 通知测试', {
      body: '政策雷达已就位。检测到新的官方通知后会从这里提醒你。',
      icon: '/icon.svg',
      badge: '/icon.svg'
    })
  }
}

export async function notifyNewNotices(notices: Notice[]): Promise<void> {
  if (!notices.length) return
  const newest = notices[0]
  const body = notices.length === 1
    ? `${newest.university}发布了“${newest.title}”，请及时揭榜。`
    : `发现${notices.length}条新的官方通知，最新来自${newest.university}，请及时揭榜。`

  if (Capacitor.isNativePlatform()) {
    const permission = await LocalNotifications.checkPermissions()
    if (permission.display !== 'granted') return
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.floor(Date.now() / 1000) % 2_000_000_000,
        title: '揭榜 · 新政策到达',
        body,
        schedule: { at: new Date(Date.now() + 1200) },
        extra: { route: '/notices', noticeId: newest.id }
      }]
    })
    return
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('揭榜 · 新政策到达', { body, icon: '/icon.svg', badge: '/icon.svg' })
  }
}
