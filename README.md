# 一推而就 · 28 推免雷达

移动优先的推免政策雷达。当前版本可作为 PWA 运行，并已通过 Capacitor 复用同一套前端生成 Android 原生工程。

## 已实现

- “揭榜 / 政策 / 作战台 / 我的”四个移动端页面；
- 教育部、研招网和高校官方来源分级展示；
- 65 个动态入口、官方域名白名单、20分钟云端增量抓取和5分钟前端自动刷新；
- 手动立即同步、来源健康状态与离线缓存；
- 政策搜索、类型筛选、收藏、详情与官网直达；
- 揭榜后自动生成材料任务，任务进度保存在本机；
- 个人档案、普通/特殊学术专长路径和可解释资格判断；
- 邮箱注册登录、会话保持，以及档案/收藏/任务的跨设备云同步；
- 本机与云端数据安全合并，Supabase 行级权限确保用户只能访问自己的数据；
- PWA manifest、离线缓存、添加到主屏幕；
- 检测到新官方公告后的 Web/Android 本地通知衔接；
- Android 原生工程、品牌图标、通知图标和启动画面；
- App 内版本检查、GitHub Release 下载和可持续覆盖更新；
- Supabase Cron + Edge Function 实时源，以及 GitHub Pages/Actions 小时级静态兜底；
- 规则引擎单元测试与 Android 手机视口视觉 QA。

## 真实性原则

- 产品数据中已移除全部演示通知和虚构监测位；
- 每条线上信息必须具有官方原文 URL，并通过官网域名或研招网官方索引校验；
- 搜索引擎只用于发现候选链接，不作为政策事实来源；
- 自动发现但尚未人工结构化的页面只展示原文与来源，不猜测材料或门槛；
- 官网访问失败时保留上一次已核验缓存，并明确显示“离线缓存/同步异常”。

截至 2026-08-13，28 届正式简章尚未发布。页面中的 2027 届通知均按真实届次显示，只能用于提前准备参考，不能当作 28 届最终规则。

初始官方来源配置位于 `data/sources.json`，人工核验的结构化条目位于 `data/verified-notices.json`。新增院校时必须填写官方栏目 URL 与允许的官方域名。

当前动态来源包括研招网两个全国聚合入口、全部 39 所 985 中央研究生招生入口、20 个重点 211 入口及 4 个院系级入口。同步采用“研招网聚合 → 高校官网 → 只读网页代理 → 历史已核验缓存”多层降级，单个官网故障不会清空整轮数据。

## 本地运行

```powershell
npm install --cache .npm-cache
npm run dev
```

`npm run dev` 会同时启动：

- 手机界面：`http://本机IP:5173`
- 官方同步 API：`http://本机IP:8787`

手机与电脑处于同一局域网时，可使用终端显示的 Network 地址在 Android 浏览器打开。

手动执行一次完整来源核验：

```powershell
npm run sync:now
```

接口健康状态：`http://127.0.0.1:8787/api/health`。

## 账号系统

账号服务使用 Supabase Auth 与 Postgres Row Level Security。未登录时应用仍可完整离线使用；登录后自动同步以下内容：

- 学业档案；
- 收藏和揭榜记录；
- 作战台任务及完成状态。

首次配置步骤：

1. 创建 Supabase 项目；
2. 在 SQL Editor 执行 `supabase/migrations/202608020001_user_app_data.sql`；
   实时政策源还需执行 `supabase/migrations/202608130001_official_notice_feed.sql` 并部署 `supabase/functions/sync-notices`；
3. 在 Authentication → URL Configuration 中把站点地址设为 `https://jiugaaa.github.io/jieban-tuimian-radar/`，并加入同一个 Redirect URL；
4. 从 Project Settings → API 复制 Project URL 与 publishable key；
5. 在本机创建不会提交的 `.env.production.local`：

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
VITE_AUTH_REDIRECT_URL=https://jiugaaa.github.io/jieban-tuimian-radar/
```

6. 在 GitHub 仓库 Actions secrets 中设置 `SUPABASE_URL` 与 `SUPABASE_PUBLISHABLE_KEY`。

客户端只能使用 publishable/anon key，绝不能将 `service_role` key 写入 APK、环境文件或 GitHub Pages 构建。

## 测试与 Web 构建

```powershell
npm test
npm run build
npm run preview
```

生产文件输出到 `dist/`。

生产模式由同一个 Node 服务提供静态页面和同步 API：

```powershell
npm run build
npm start
```

## Android 同步

Android 工程位于 `android/`，应用 ID 为 `cn.jieban.tuimian`，最低支持 Android API 24。

原生 App 优先从 Supabase 实时政策表读取，失败时回退到 `config/android-build.json` 中的 GitHub Pages 公网 HTTPS 数据地址，不依赖电脑开机。

每次修改前端后运行：

```powershell
npm run android:sync
```

应用图标或启动画面需要重新生成时运行：

```powershell
npm run android:assets
```

## 生成 APK

项目已在 `App/.toolchains/` 中准备便携 JDK 21、Android SDK 36、Gradle 缓存和专用签名密钥，不要求全局安装 Android Studio。直接运行：

```powershell
npm run android:apk
```

APK 输出到 `releases/jieban-v版本号.apk`，脚本同时把文件大小和 SHA-256 写入 `data/version.json` 与 `public/api/version.json`。

`.toolchains/signing/jieban-release.jks` 与同目录 `signing.properties` 是覆盖更新所必需的私密签名材料，已被 Git 忽略。必须单独安全备份；一旦丢失，Android 将不允许新版覆盖旧版。

如需用 Android Studio 调试，可以运行 `npm run android:open`。

## 公网部署与版本更新

- 公网 PWA：`https://jiugaaa.github.io/jieban-tuimian-radar/`
- 公网数据：`https://jiugaaa.github.io/jieban-tuimian-radar/api/notices.json`
- APK：GitHub 仓库的 Releases 页面
- 主定时任务：Supabase 每小时第 7、27、47 分钟扫描官方来源
- 静态兜底：GitHub Actions 每小时第 11 分钟重新核验并部署

后续发布新版时：

1. 在 `data/version.json` 同时提高 `versionCode`（只能递增）和 `versionName`；
2. 运行 `npm run android:apk`；
3. 提交并推送源码及新版版本清单；
4. 以 `v版本号` 创建 GitHub Release，并上传 `releases/` 中对应 APK。

App 打开“我的 → 检查更新”后会读取公网版本清单；发现更高的 `versionCode` 就显示下载按钮。Android 要求新版与旧版使用同一签名证书，因此必须保管上述签名文件。

公网构建可在本地复现：

```powershell
npm run sync:export
npm run build:public
```

## “实时同步”的准确含义

- Supabase Cron 每20分钟调用云端采集函数，App 不需要重新发布即可读到新通知；
- GitHub Actions 每小时生成一份静态快照，供 Supabase 暂时不可用时回退；
- App 打开时每5分钟刷新一次，切回前台时也会立即检查；
- 点击右上角“官网已同步”或政策页“立即同步”会立即拉取最新一次公网核验结果；
- 当前只有 App 打开或回到前台时能发现新增并提醒。要在 App 完全关闭时也收到服务端推送，还需后续接入 Firebase Cloud Messaging。

## 视觉 QA

先启动预览服务，再运行：

```powershell
npm run qa:visual
```

脚本使用本机 Chrome 模拟 412×915 Android 手机视口，检查横向溢出与浏览器错误。
