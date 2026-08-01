import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cn.jieban.tuimian',
  appName: '揭榜',
  webDir: 'dist',
  backgroundColor: '#f3f5f7',
  android: {
    allowMixedContent: false,
    backgroundColor: '#f3f5f7'
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#d65f36'
    }
  }
}

export default config
