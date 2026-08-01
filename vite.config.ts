import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const basePath = (env.VITE_BASE_PATH || '/').replace(/\/?$/, '/')

  return {
  base: basePath,
  server: {
    watch: {
      ignored: ['**/.toolchains/**']
    },
    proxy: {
      '/api': 'http://127.0.0.1:8787'
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'maskable-icon.svg'],
      manifest: {
        id: basePath,
        name: '揭榜 · 28推免雷达',
        short_name: '揭榜',
        description: '第一手推免政策雷达、资格判断与申请作战台',
        theme_color: '#10243e',
        background_color: '#f3f5f7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: basePath,
        lang: 'zh-CN',
        categories: ['education', 'productivity'],
        icons: [
          {
            src: `${basePath}icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: `${basePath}maskable-icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: `${basePath}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/(?:notices|version)(?:\.json)?(?:\?|$)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'official-notice-feed',
              networkTimeoutSeconds: 12,
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 }
            }
          },
          {
            urlPattern: /^https:\/\/(www\.moe\.gov\.cn|yz\.chsi\.com\.cn)\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'official-sources',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      }
    })
  ]
  }
})
