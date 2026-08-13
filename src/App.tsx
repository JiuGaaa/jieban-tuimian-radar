import { useCallback, useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Icon } from './components/Icon'
import { emptyProfile, initialTasks } from './data/notices'
import { useAccount, type AuthMode } from './hooks/useAccount'
import { currentVersionName as currentAppVersionName, useAppUpdate } from './hooks/useAppUpdate'
import { useCloudSync } from './hooks/useCloudSync'
import { useNoticeFeed } from './hooks/useNoticeFeed'
import { usePersistentState } from './hooks/usePersistentState'
import { formatDate, relativeDeadline } from './lib/date'
import { calculateJmuSampleMatch } from './lib/matcher'
import { compareNoticePriority, getUniversityTier } from './lib/universityPriority'
import {
  getNotificationState,
  notifyNewNotices,
  requestNotificationPermission,
  sendTestNotification,
  type NotificationState
} from './lib/notifications'
import type { FeedMeta, Notice, NoticePhase, SyncState, TabId, TaskItem, UserAppSnapshot, UserProfile } from './types'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const tabs: Array<{ id: TabId; label: string; icon: 'home' | 'radar' | 'target' | 'user' }> = [
  { id: 'home', label: '揭榜', icon: 'home' },
  { id: 'notices', label: '政策', icon: 'radar' },
  { id: 'tasks', label: '作战台', icon: 'target' },
  { id: 'profile', label: '我的', icon: 'user' }
]

const phases: Array<'全部' | NoticePhase> = ['全部', '国家政策', '本校推免', '夏令营', '预推免']
const brandIconUrl = `${import.meta.env.BASE_URL}icon.svg`

function App() {
  const { notices, meta, syncState, syncMessage, refresh } = useNoticeFeed()
  const appUpdate = useAppUpdate()
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [selectedNotice, setSelectedNotice] = useState<Notice | null>(null)
  const [search, setSearch] = useState('')
  const [phase, setPhase] = useState<'全部' | NoticePhase>('全部')
  const [toast, setToast] = useState('')
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [notificationState, setNotificationState] = useState<NotificationState>('prompt')
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [savedNoticeIds, setSavedNoticeIds] = usePersistentState<string[]>('jieban:saved', [])
  const [claimedNoticeIds, setClaimedNoticeIds] = usePersistentState<string[]>('jieban:claimed', [])
  const [knownNoticeIds, setKnownNoticeIds] = usePersistentState<string[]>('jieban:known-official-notices', [])
  const [tasks, setTasks] = usePersistentState<TaskItem[]>('jieban:tasks', initialTasks)
  const [profile, setProfile] = usePersistentState<UserProfile>('jieban:profile', emptyProfile)
  const account = useAccount()

  const appSnapshot = useMemo<UserAppSnapshot>(() => ({
    profile,
    savedNoticeIds,
    claimedNoticeIds,
    tasks
  }), [claimedNoticeIds, profile, savedNoticeIds, tasks])

  const applyCloudSnapshot = useCallback((snapshot: UserAppSnapshot) => {
    setProfile(snapshot.profile)
    setSavedNoticeIds(snapshot.savedNoticeIds)
    setClaimedNoticeIds(snapshot.claimedNoticeIds)
    setTasks(snapshot.tasks)
  }, [setClaimedNoticeIds, setProfile, setSavedNoticeIds, setTasks])

  const cloudSync = useCloudSync({
    configured: account.configured,
    userId: account.user?.id ?? null,
    snapshot: appSnapshot,
    applySnapshot: applyCloudSnapshot
  })

  const matchResult = useMemo(() => calculateJmuSampleMatch(profile), [profile])
  const completedTasks = tasks.filter((task) => task.completed).length
  const taskProgress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0

  const filteredNotices = useMemo(() => {
    const query = search.trim().toLowerCase()
    return notices.filter((notice) => {
      const matchesPhase = phase === '全部' || notice.phase === phase
      const haystack = [notice.university, notice.institute, notice.title, notice.summary, ...notice.tags].join(' ').toLowerCase()
      return matchesPhase && (!query || haystack.includes(query))
    }).sort(compareNoticePriority)
  }, [notices, phase, search])

  useEffect(() => {
    void getNotificationState().then(setNotificationState)
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!account.recoveryRequested) return
    setAuthMode('recovery')
    setAuthOpen(true)
    setActiveTab('profile')
  }, [account.recoveryRequested])

  useEffect(() => {
    if (syncState !== 'online' || !meta.lastSyncedAt || !notices.length) return
    const currentIds = notices.map((notice) => notice.id)
    if (!knownNoticeIds.length) {
      setKnownNoticeIds(currentIds)
      return
    }
    const recentThreshold = Date.now() - 21 * 24 * 60 * 60 * 1000
    const newNotices = notices.filter((notice) => !knownNoticeIds.includes(notice.id) && new Date(notice.publishedAt).getTime() >= recentThreshold)
    if (newNotices.length && notificationState === 'granted') void notifyNewNotices(newNotices)
    if (currentIds.some((id) => !knownNoticeIds.includes(id))) setKnownNoticeIds([...new Set([...knownNoticeIds, ...currentIds])])
  }, [knownNoticeIds, meta.lastSyncedAt, notices, notificationState, setKnownNoticeIds, syncState])

  const navigate = (tab: TabId) => {
    setActiveTab(tab)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleSaved = (noticeId: string) => {
    setSavedNoticeIds((current) =>
      current.includes(noticeId) ? current.filter((id) => id !== noticeId) : [...current, noticeId]
    )
    setToast(savedNoticeIds.includes(noticeId) ? '已取消收藏' : '已加入关注')
  }

  const claimNotice = (notice: Notice) => {
    if (claimedNoticeIds.includes(notice.id)) {
      setToast('这项任务已经揭榜')
      navigate('tasks')
      return
    }

    const generatedTasks: TaskItem[] = notice.materials.map((material, index) => ({
      id: `${notice.id}:material:${index}`,
      noticeId: notice.id,
      title: material,
      group: '材料',
      dueAt: notice.deadline,
      completed: false,
      source: `${notice.university} · ${notice.institute}`
    }))
    setClaimedNoticeIds((current) => [...current, notice.id])
    setTasks((current) => [...current, ...generatedTasks])
    setSelectedNotice(null)
    setToast(generatedTasks.length ? `揭榜成功，已生成 ${generatedTasks.length} 项准备任务` : '揭榜成功，已加入作战台')
    navigate('tasks')
  }

  const toggleTask = (taskId: string) => {
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, completed: !task.completed } : task)))
  }

  const updateProfile = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }))
  }

  const enableNotifications = async () => {
    const nextState = await requestNotificationPermission()
    setNotificationState(nextState)
    if (nextState === 'granted') {
      await sendTestNotification()
      setTasks((current) => current.map((task) => (task.id === 'starter-notification' ? { ...task, completed: true } : task)))
      setToast('通知已开启，测试消息即将送达')
    } else if (nextState === 'unsupported') {
      setToast('当前浏览器不支持通知，请安装原生版或更换浏览器')
    } else {
      setToast('通知未开启，可在系统设置中重新授权')
    }
  }

  const installApp = async () => {
    if (Capacitor.isNativePlatform()) {
      setToast('你正在使用 Android 原生模式')
      return
    }
    if (!installPrompt) {
      setToast('请使用浏览器菜单中的“添加到主屏幕”')
      return
    }
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setToast('已添加到主屏幕')
    setInstallPrompt(null)
  }

  const manualRefresh = async () => {
    const result = await refresh(true)
    setToast(result ? `同步完成：${result.notices.length} 条官方信息` : '同步失败，已保留最后一次核验数据')
  }

  const syncLabel = syncState === 'syncing' ? '正在同步' : syncState === 'online' ? '官网已同步' : syncState === 'cached' ? '离线缓存' : '同步异常'

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('home')} aria-label="返回一推而就首页">
          <img className="brand-mark" src={brandIconUrl} alt="" aria-hidden="true" />
          <span>
            <strong>一推而就</strong>
            <small>28 推免雷达</small>
          </span>
        </button>
        <button className={`sync-state ${syncState}`} title={syncMessage} onClick={() => void manualRefresh()} disabled={syncState === 'syncing'}>
          <span className="sync-dot" />
          {syncLabel}
        </button>
      </header>

      <main className="main-content">
        {activeTab === 'home' && (
          <HomePage
            notices={notices}
            tasks={tasks}
            profile={profile}
            savedNoticeIds={savedNoticeIds}
            claimedNoticeIds={claimedNoticeIds}
            onOpenNotice={setSelectedNotice}
            onToggleSaved={toggleSaved}
            onClaim={claimNotice}
            onNavigate={navigate}
            syncState={syncState}
            meta={meta}
          />
        )}

        {activeTab === 'notices' && (
          <NoticesPage
            notices={filteredNotices}
            meta={meta}
            syncState={syncState}
            syncMessage={syncMessage}
            search={search}
            phase={phase}
            savedNoticeIds={savedNoticeIds}
            claimedNoticeIds={claimedNoticeIds}
            onSearch={setSearch}
            onPhase={setPhase}
            onOpenNotice={setSelectedNotice}
            onToggleSaved={toggleSaved}
            onClaim={claimNotice}
            onRefresh={manualRefresh}
          />
        )}

        {activeTab === 'tasks' && (
          <TasksPage tasks={tasks} progress={taskProgress} onToggleTask={toggleTask} onNavigate={navigate} />
        )}

        {activeTab === 'profile' && (
          <ProfilePage
            profile={profile}
            matchResult={matchResult}
            notificationState={notificationState}
            appUpdate={appUpdate}
            account={account}
            cloudSync={cloudSync}
            onUpdate={updateProfile}
            onEnableNotifications={enableNotifications}
            onInstall={installApp}
            onOpenAuth={(mode) => {
              setAuthMode(mode)
              setAuthOpen(true)
            }}
            onSignOut={async () => {
              await account.signOut()
              setToast('已退出账号，本机资料仍然保留')
            }}
            onSyncNow={async () => {
              const synced = await cloudSync.syncNow()
              setToast(synced ? '本机与云端已同步' : '同步失败，请检查网络后重试')
            }}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="主导航">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => navigate(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <Icon name={tab.icon} size={21} />
            <span>{tab.label}</span>
            {tab.id === 'tasks' && tasks.some((task) => !task.completed) && <i>{tasks.filter((task) => !task.completed).length}</i>}
          </button>
        ))}
      </nav>

      {selectedNotice && (
        <NoticeDialog
          notice={selectedNotice}
          saved={savedNoticeIds.includes(selectedNotice.id)}
          claimed={claimedNoticeIds.includes(selectedNotice.id)}
          onClose={() => setSelectedNotice(null)}
          onToggleSaved={() => toggleSaved(selectedNotice.id)}
          onClaim={() => claimNotice(selectedNotice)}
        />
      )}

      {authOpen && (
        <AuthDialog
          initialMode={authMode}
          account={account}
          onClose={() => setAuthOpen(false)}
          onDone={(message) => {
            setAuthOpen(false)
            setToast(message)
          }}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

interface HomePageProps {
  notices: Notice[]
  tasks: TaskItem[]
  profile: UserProfile
  savedNoticeIds: string[]
  claimedNoticeIds: string[]
  onOpenNotice: (notice: Notice) => void
  onToggleSaved: (id: string) => void
  onClaim: (notice: Notice) => void
  onNavigate: (tab: TabId) => void
  syncState: SyncState
  meta: FeedMeta
}

function HomePage({
  notices,
  tasks,
  profile,
  savedNoticeIds,
  claimedNoticeIds,
  onOpenNotice,
  onToggleSaved,
  onClaim,
  onNavigate,
  syncState,
  meta
}: HomePageProps) {
  const profileReady = Boolean(profile.school && profile.major && profile.rank && profile.cohortSize)
  const openTasks = tasks.filter((task) => !task.completed)
  const priorityNotices = notices.filter((notice) => notice.isPriority).slice(0, 3)

  return (
    <>
      <section className="radar-hero">
        <div className="hero-copy">
          <span className="eyebrow">28届 · 预备监测期</span>
          <h1>第一手消息，<br />要比截止日先到。</h1>
          <p>只收录能追溯到教育部、研招网或高校官方域名的内容；28届正式政策尚未发布。</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => onNavigate('notices')}>
              查看政策雷达 <Icon name="chevron" size={17} />
            </button>
            <button className="text-button" onClick={() => onNavigate('profile')}>
              {profileReady ? '更新我的档案' : '先完善档案'}
            </button>
          </div>
        </div>
        <div className="radar-visual" aria-hidden="true">
          <span className="radar-ring ring-one" />
          <span className="radar-ring ring-two" />
          <span className="radar-sweep" />
          <span className="radar-core">28</span>
          <i className="radar-point point-a" />
          <i className="radar-point point-b" />
        </div>
      </section>

      <section className="metric-strip" aria-label="准备状态">
        <div><strong>{meta.monitoredUniversityCount || new Set(notices.map((item) => item.university)).size}</strong><span>监测院校</span></div>
        <div><strong>{notices.filter((item) => item.targetYear === '2028').length}</strong><span>28届已发布</span></div>
        <div><strong>{openTasks.length}</strong><span>待完成任务</span></div>
      </section>

      {syncState !== 'online' && <div className="status-alert verified-alert"><Icon name="alert" size={18} /><span>当前未连接实时服务，页面只保留最后一次已核验内容。</span></div>}

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">优先阅读</span><h2>今日公告</h2></div>
          <button onClick={() => onNavigate('notices')}>全部政策 <Icon name="chevron" size={16} /></button>
        </div>
        <div className="notice-stack">
          {priorityNotices.map((notice) => (
            <NoticeCard
              key={notice.id}
              notice={notice}
              saved={savedNoticeIds.includes(notice.id)}
              claimed={claimedNoticeIds.includes(notice.id)}
              onOpen={() => onOpenNotice(notice)}
              onToggleSaved={() => onToggleSaved(notice.id)}
              onClaim={() => onClaim(notice)}
            />
          ))}
        </div>
      </section>

      <section className="section-block readiness-block">
        <div className="section-heading compact">
          <div><span className="eyebrow">准备度</span><h2>先把地基打好</h2></div>
          <button onClick={() => onNavigate('tasks')}>进入作战台 <Icon name="chevron" size={16} /></button>
        </div>
        <div className="starter-list">
          {tasks.slice(0, 3).map((task) => (
            <div key={task.id} className={task.completed ? 'starter-item complete' : 'starter-item'}>
              <span className="starter-check">{task.completed ? <Icon name="check" size={15} /> : ''}</span>
              <div><strong>{task.title}</strong><small>{task.completed ? '已完成' : task.source}</small></div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

interface NoticesPageProps {
  notices: Notice[]
  meta: FeedMeta
  syncState: SyncState
  syncMessage: string
  search: string
  phase: '全部' | NoticePhase
  savedNoticeIds: string[]
  claimedNoticeIds: string[]
  onSearch: (value: string) => void
  onPhase: (phase: '全部' | NoticePhase) => void
  onOpenNotice: (notice: Notice) => void
  onToggleSaved: (id: string) => void
  onClaim: (notice: Notice) => void
  onRefresh: () => Promise<void>
}

function NoticesPage({
  notices: visibleNotices,
  meta,
  syncState,
  syncMessage,
  search,
  phase,
  savedNoticeIds,
  claimedNoticeIds,
  onSearch,
  onPhase,
  onOpenNotice,
  onToggleSaved,
  onClaim,
  onRefresh
}: NoticesPageProps) {
  return (
    <>
      <section className="page-intro">
        <span className="eyebrow">官方源优先</span>
        <h1>政策雷达</h1>
        <p>国家政策、本校细则、夏令营与预推免通知，统一按来源和版本核验。</p>
      </section>

      <div className={`status-alert verified-alert ${syncState}`}>
        <Icon name="shield" size={18} />
        <span>只展示官网或研招网可追溯内容；当前监测 {meta.monitoredUniversityCount || 0} 所院校，约每 20 分钟扫描一次。28届正式简章尚未发布，2027届信息用于提前准备参考。{meta.lastSyncedAt ? ` 最近同步：${formatSyncTime(meta.lastSyncedAt)}。` : ''}</span>
        <button onClick={() => void onRefresh()} disabled={syncState === 'syncing'}>{syncState === 'syncing' ? '同步中' : '立即同步'}</button>
      </div>
      {syncState !== 'online' && <p className="sync-warning">{syncMessage}</p>}

      <label className="search-box">
        <Icon name="search" size={19} />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索学校、学院或政策" />
      </label>

      <div className="chip-row" aria-label="政策类型筛选">
        {phases.map((item) => (
          <button key={item} className={phase === item ? 'active' : ''} onClick={() => onPhase(item)}>{item}</button>
        ))}
      </div>

      <div className="result-caption"><span>{visibleNotices.length} 条结果</span><span>国家级 · 985 · 211 · 其他</span></div>
      <div className="notice-stack">
        {visibleNotices.length ? visibleNotices.map((notice) => (
          <NoticeCard
            key={notice.id}
            notice={notice}
            saved={savedNoticeIds.includes(notice.id)}
            claimed={claimedNoticeIds.includes(notice.id)}
            onOpen={() => onOpenNotice(notice)}
            onToggleSaved={() => onToggleSaved(notice.id)}
            onClaim={() => onClaim(notice)}
          />
        )) : (
          <div className="empty-state"><Icon name="inbox" size={34} /><h3>没有匹配的政策</h3><p>清除搜索词或切换政策类型后再试。</p></div>
        )}
      </div>
    </>
  )
}

interface NoticeCardProps {
  notice: Notice
  saved: boolean
  claimed: boolean
  onOpen: () => void
  onToggleSaved: () => void
  onClaim: () => void
}

function NoticeCard({ notice, saved, claimed, onOpen, onToggleSaved, onClaim }: NoticeCardProps) {
  const deadline = relativeDeadline(notice.deadline)
  const universityTier = getUniversityTier(notice.university)
  const tierClass = universityTier === '国家级' ? 'national' : universityTier
  return (
    <article className="notice-card">
      <div className="notice-topline">
        <div className="source-level">
          <span>{notice.officialLevel}</span>
          {universityTier !== '其他' && <span className={`school-tier tier-${tierClass}`}>{universityTier}</span>}
          <b>官网</b>
        </div>
        <button className={saved ? 'icon-button saved' : 'icon-button'} onClick={onToggleSaved} aria-label={saved ? '取消收藏' : '收藏'}>
          <Icon name="bookmark" size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <button className="notice-main" data-has-materials={notice.materials.length > 0} onClick={onOpen}>
        <div className="notice-identity"><strong>{notice.university}</strong><span>{notice.institute}</span></div>
        <h3>{notice.title}</h3>
        <p>{notice.summary}</p>
      </button>
      <div className="notice-tags">{notice.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <div className="notice-footer">
        <div className={`deadline ${deadline.tone}`}><Icon name="calendar" size={16} /><span>{deadline.label}</span></div>
        <button className={claimed ? 'claim-button claimed' : 'claim-button'} onClick={onClaim}>
          {claimed ? <><Icon name="check" size={15} /> 已揭榜</> : '揭榜'}
        </button>
      </div>
    </article>
  )
}

interface TasksPageProps {
  tasks: TaskItem[]
  progress: number
  onToggleTask: (id: string) => void
  onNavigate: (tab: TabId) => void
}

function TasksPage({ tasks, progress, onToggleTask, onNavigate }: TasksPageProps) {
  const groups: TaskItem['group'][] = ['准备', '材料', '报名', '提醒']
  return (
    <>
      <section className="page-intro task-intro">
        <div>
          <span className="eyebrow">行动清单</span>
          <h1>申请作战台</h1>
          <p>每次揭榜都会把材料和截止节点拆成任务。</p>
        </div>
        <div className="progress-seal" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}>
          <strong>{progress}%</strong><span>准备度</span>
        </div>
      </section>

      <div className="task-summary">
        <span><b>{tasks.filter((task) => !task.completed).length}</b> 待完成</span>
        <span><b>{tasks.filter((task) => task.completed).length}</b> 已完成</span>
      </div>

      {groups.map((group) => {
        const groupTasks = tasks.filter((task) => task.group === group)
        if (!groupTasks.length) return null
        return (
          <section className="task-group" key={group}>
            <div className="task-group-title"><h2>{group}</h2><span>{groupTasks.filter((task) => !task.completed).length} 项待办</span></div>
            <div className="task-list">
              {groupTasks.map((task) => (
                <label key={task.id} className={task.completed ? 'task-row complete' : 'task-row'}>
                  <input type="checkbox" checked={task.completed} onChange={() => onToggleTask(task.id)} />
                  <span className="custom-checkbox"><Icon name="check" size={14} /></span>
                  <span className="task-copy">
                    <strong>{task.title}</strong>
                    <small>{task.source}{task.dueAt ? ` · ${formatDate(task.dueAt)} 截止` : ''}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )
      })}

      {!tasks.length && (
        <div className="empty-state"><Icon name="list" size={34} /><h3>作战台还是空的</h3><p>去政策雷达揭榜，材料任务会自动出现在这里。</p><button className="primary-button" onClick={() => onNavigate('notices')}>去揭榜</button></div>
      )}
    </>
  )
}

interface ProfilePageProps {
  profile: UserProfile
  matchResult: ReturnType<typeof calculateJmuSampleMatch>
  notificationState: NotificationState
  appUpdate: ReturnType<typeof useAppUpdate>
  account: ReturnType<typeof useAccount>
  cloudSync: ReturnType<typeof useCloudSync>
  onUpdate: <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => void
  onEnableNotifications: () => Promise<void>
  onInstall: () => Promise<void>
  onOpenAuth: (mode: AuthMode) => void
  onSignOut: () => Promise<void>
  onSyncNow: () => Promise<void>
}

function ProfilePage({
  profile,
  matchResult,
  notificationState,
  appUpdate,
  account,
  cloudSync,
  onUpdate,
  onEnableNotifications,
  onInstall,
  onOpenAuth,
  onSignOut,
  onSyncNow
}: ProfilePageProps) {
  const accountStatusLabel = account.initializing
    ? '正在恢复登录状态'
    : cloudSync.state === 'synced'
      ? '云端已同步'
      : cloudSync.state === 'syncing' || cloudSync.state === 'loading'
        ? '正在同步'
        : cloudSync.state === 'error'
          ? '同步需重试'
          : account.configured
            ? '仅保存在本机'
            : '等待连接服务'

  return (
    <>
      <section className="page-intro profile-intro">
        <span className="eyebrow">本机优先 · 登录后同步</span>
        <h1>我的档案</h1>
        <p>未登录时资料留在本机；登录后会在 Android 与网页版之间安全同步。</p>
      </section>

      <section className={`account-card ${account.user ? 'signed-in' : 'signed-out'} ${cloudSync.state}`}>
        <div className="account-dawn" aria-hidden="true"><span /><i /></div>
        <div className="account-copy">
          <div className="account-heading">
            <div>
              <span className="eyebrow">云端账号</span>
              <h2>{account.user?.email ?? '把作战进度带在身边'}</h2>
            </div>
            <span className={`account-state ${cloudSync.state}`}>{accountStatusLabel}</span>
          </div>
          <p>{account.user ? cloudSync.message : account.configured ? '登录后同步档案、收藏、揭榜记录和材料任务；本机资料不会被简单覆盖。' : '账号界面已经就绪，连接云端项目后即可注册和登录。'}</p>
          {account.user && cloudSync.lastSyncedAt && <small>最近保存：{formatSyncTime(cloudSync.lastSyncedAt)}</small>}
          <div className="account-actions">
            {account.user ? (
              <>
                <button className="primary-button" disabled={cloudSync.state === 'syncing' || cloudSync.state === 'loading'} onClick={() => void onSyncNow()}>立即同步</button>
                <button className="secondary-button" onClick={() => void onSignOut()}>退出登录</button>
              </>
            ) : (
              <>
                <button className="primary-button" disabled={!account.configured || account.initializing} onClick={() => onOpenAuth('signin')}>登录</button>
                <button className="secondary-button" disabled={!account.configured || account.initializing} onClick={() => onOpenAuth('signup')}>创建账号</button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="match-card">
        <div className="match-score">
          <span>综合匹配度</span>
          <strong>{matchResult.matchScore}<i>%</i></strong>
          <small>基于你提供的2027届校内正式文件</small>
        </div>
        <div className="match-status">
          <span className={matchResult.qualified === true ? 'pass' : matchResult.qualified === false ? 'fail' : 'pending'}>
            {matchResult.qualified === true ? '硬门槛通过' : matchResult.qualified === false ? '存在未通过项' : '等待补全档案'}
          </span>
          <h2>{matchResult.pathway}</h2>
          <p>{matchResult.summary}</p>
          <div className="profile-completeness"><span style={{ width: `${matchResult.completeness}%` }} /><small>档案完整度 {matchResult.completeness}%</small></div>
        </div>
      </section>

      <section className="form-section">
        <div className="section-heading compact"><div><span className="eyebrow">基本信息</span><h2>学业档案</h2></div></div>
        <div className="form-grid">
          <Field label="本科学校"><input value={profile.school} onChange={(e) => onUpdate('school', e.target.value)} placeholder="例如：集美大学" /></Field>
          <Field label="专业"><input value={profile.major} onChange={(e) => onUpdate('major', e.target.value)} placeholder="例如：轮机工程" /></Field>
          <Field label="专业排名"><NumberInput value={profile.rank} onChange={(value) => onUpdate('rank', value)} placeholder="名次" min={1} /></Field>
          <Field label="年级人数"><NumberInput value={profile.cohortSize} onChange={(value) => onUpdate('cohortSize', value)} placeholder="总人数" min={1} /></Field>
          <Field label="平均绩点">
            <div className="joined-input"><NumberInput value={profile.gpa} onChange={(value) => onUpdate('gpa', value)} placeholder="GPA" min={0} step="0.01" /><select value={profile.gpaScale} onChange={(e) => onUpdate('gpaScale', Number(e.target.value) as 4 | 5)}><option value={4}>4分制</option><option value={5}>5分制</option></select></div>
          </Field>
          <Field label="CET-4"><NumberInput value={profile.cet4} onChange={(value) => onUpdate('cet4', value)} placeholder="未考可留空" min={0} /></Field>
          <Field label="CET-6"><NumberInput value={profile.cet6} onChange={(value) => onUpdate('cet6', value)} placeholder="未考可留空" min={0} /></Field>
          <Field label="科研成果数量"><NumberInput value={profile.researchCount} onChange={(value) => onUpdate('researchCount', value === '' ? 0 : value)} placeholder="论文/专利等" min={0} /></Field>
          <Field label="最高竞赛级别"><select value={profile.competitionLevel} onChange={(e) => onUpdate('competitionLevel', e.target.value as UserProfile['competitionLevel'])}><option>无</option><option>校级</option><option>省级</option><option>国家级</option></select></Field>
          <Field label="意向地区" wide><input value={profile.targetRegions} onChange={(e) => onUpdate('targetRegions', e.target.value)} placeholder="例如：福建、上海、浙江" /></Field>
        </div>
        <div className="toggle-list">
          <Toggle label="前六学期有补考或重新学习记录" checked={profile.hasMakeup} onChange={(value) => onUpdate('hasMakeup', value)} />
          <Toggle label="有需要人工复核的纪律处分记录" checked={profile.hasDisciplinaryIssue} onChange={(value) => onUpdate('hasDisciplinaryIssue', value)} />
          <Toggle label="申请特殊学术专长路径" checked={profile.specialTalent} onChange={(value) => onUpdate('specialTalent', value)} />
        </div>
      </section>

      <section className="form-section check-section">
        <div className="section-heading compact"><div><span className="eyebrow">可解释判断</span><h2>门槛逐项核对</h2></div></div>
        <div className="check-list">
          {matchResult.checks.map((check) => (
            <div className="check-row" key={check.label}>
              <span className={check.passed === true ? 'pass' : check.passed === false ? 'fail' : 'pending'}>
                {check.passed === true ? <Icon name="check" size={15} /> : check.passed === false ? '×' : '?'}
              </span>
              <div><strong>{check.label}</strong><small>{check.detail}</small></div>
            </div>
          ))}
        </div>
      </section>

      <section className="device-card">
        <div className="device-icon"><Icon name="bell" size={22} /></div>
        <div><span className="eyebrow">Android 优先</span><h2>安装与通知</h2><p>{Capacitor.isNativePlatform() ? '当前正在 Android 原生容器中运行。' : '可先添加到主屏幕；原生工程将复用同一套代码。'}</p></div>
        <div className="device-actions">
          <button className="secondary-button" onClick={() => void onInstall()}>{Capacitor.isNativePlatform() ? '原生模式已启用' : '添加到主屏幕'}</button>
          <button className="primary-button" onClick={() => void onEnableNotifications()}>
            {notificationState === 'granted' ? '再次测试通知' : '开启并测试通知'}
          </button>
        </div>
        <div className={`update-status ${appUpdate.state}`}>
          <div>
            <strong>应用更新 · v{currentAppVersionName}</strong>
            <small>{appUpdate.message}</small>
          </div>
          {appUpdate.state === 'available' ? (
            <button className="primary-button" onClick={() => void appUpdate.download()}>下载 v{appUpdate.latest?.versionName}</button>
          ) : (
            <button className="secondary-button" disabled={appUpdate.state === 'checking'} onClick={() => void appUpdate.check(true)}>
              {appUpdate.state === 'checking' ? '检查中' : '检查更新'}
            </button>
          )}
        </div>
      </section>

      <div className="privacy-note"><Icon name="shield" size={18} /><span>账号数据使用行级权限隔离：登录用户只能读取和修改自己的档案。退出后，本机资料仍可离线使用。</span></div>
    </>
  )
}

interface AuthDialogProps {
  initialMode: AuthMode
  account: ReturnType<typeof useAccount>
  onClose: () => void
  onDone: (message: string) => void
}

function AuthDialog({ initialMode, account, onClose, onDone }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    document.body.classList.add('dialog-open')
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      document.body.classList.remove('dialog-open')
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFeedback('')
    if (password.length < 8) {
      setFeedback('密码至少需要 8 位')
      return
    }
    if ((mode === 'signup' || mode === 'recovery') && password !== confirmPassword) {
      setFeedback('两次输入的密码不一致')
      return
    }
    setBusy(true)
    const result = mode === 'signin'
      ? await account.signIn(email, password)
      : mode === 'signup'
        ? await account.signUp(email, password)
        : await account.updatePassword(password)
    setBusy(false)
    setFeedback(result.message)
    if (result.ok && !result.needsEmailConfirmation) onDone(result.message)
    if (result.needsEmailConfirmation) setMode('signin')
  }

  const resetPassword = async () => {
    if (!email.trim()) {
      setFeedback('先填写注册邮箱，再发送重置邮件')
      return
    }
    setBusy(true)
    const result = await account.sendPasswordReset(email)
    setBusy(false)
    setFeedback(result.message)
  }

  const title = mode === 'signin' ? '登录一推而就' : mode === 'signup' ? '创建云端账号' : '设置新密码'
  const description = mode === 'signin'
    ? '登录后自动合并本机与云端作战进度。'
    : mode === 'signup'
      ? '只需邮箱和密码；注册后按邮件提示确认邮箱。'
      : '新密码设置完成后，所有已登录设备继续使用同一账号。'

  return (
    <div className="dialog-backdrop auth-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        <div className="dialog-handle" />
        <header>
          <div className="auth-brand"><img src={brandIconUrl} alt="" /><span><small>云端档案</small><strong id="auth-dialog-title">{title}</strong></span></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close" size={20} /></button>
        </header>
        <p className="auth-description">{description}</p>
        {mode !== 'recovery' && (
          <div className="auth-tabs" role="tablist" aria-label="账号操作">
            <button className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setFeedback('') }}>登录</button>
            <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setFeedback('') }}>注册</button>
          </div>
        )}
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {mode !== 'recovery' && <Field label="邮箱"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" placeholder="name@example.com" required /></Field>}
          <Field label={mode === 'recovery' ? '新密码' : '密码'}><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="至少 8 位" minLength={8} required /></Field>
          {(mode === 'signup' || mode === 'recovery') && <Field label="再次输入密码"><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="再次输入" minLength={8} required /></Field>}
          {feedback && <div className="auth-feedback" role="status">{feedback}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? '正在处理…' : mode === 'signin' ? '登录并同步' : mode === 'signup' ? '创建账号' : '保存新密码'}</button>
          {mode === 'signin' && <button className="auth-link" type="button" disabled={busy} onClick={() => void resetPassword()}>忘记密码？发送重置邮件</button>}
        </form>
        <div className="auth-privacy"><Icon name="shield" size={17} /><span>密码由账号服务加密处理；应用不会读取或保存明文密码。</span></div>
      </section>
    </div>
  )
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>
}

function NumberInput({ value, onChange, ...props }: { value: number | ''; onChange: (value: number | '') => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return <input type="number" value={value} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} {...props} />
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

interface NoticeDialogProps {
  notice: Notice
  saved: boolean
  claimed: boolean
  onClose: () => void
  onToggleSaved: () => void
  onClaim: () => void
}

function NoticeDialog({ notice, saved, claimed, onClose, onToggleSaved, onClaim }: NoticeDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.classList.add('dialog-open')
    window.addEventListener('keydown', handleKey)
    return () => {
      document.body.classList.remove('dialog-open')
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const deadline = relativeDeadline(notice.deadline)
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="notice-dialog" role="dialog" aria-modal="true" aria-labelledby="notice-dialog-title">
        <div className="dialog-handle" />
        <header>
          <div className="source-level"><span>{notice.officialLevel}</span><b>官网</b></div>
          <div className="dialog-header-actions">
            <button className={saved ? 'icon-button saved' : 'icon-button'} onClick={onToggleSaved} aria-label={saved ? '取消收藏' : '收藏'}><Icon name="bookmark" size={19} fill={saved ? 'currentColor' : 'none'} /></button>
            <button className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close" size={20} /></button>
          </div>
        </header>
        <div className="dialog-title"><span>{notice.university} · {notice.institute}</span><h2 id="notice-dialog-title">{notice.title}</h2><p>{notice.summary}</p></div>
        <div className="fact-grid">
          <div><span>面向届次</span><strong>{notice.targetYear}</strong></div>
          <div><span>截止状态</span><strong className={deadline.tone}>{deadline.label}</strong></div>
          <div><span>原文发布</span><strong>{formatDate(notice.publishedAt)}</strong></div>
          <div><span>最近核验</span><strong>{formatDate(notice.checkedAt)}</strong></div>
        </div>
        <div className="dialog-section"><h3>要求速览</h3><div className="requirement-list">{notice.requirements.map((item) => <div key={item.label}><span>{item.label}</span><strong className={item.tone}>{item.value}</strong></div>)}</div></div>
        <div className="dialog-section"><h3>材料清单</h3>{notice.materials.length ? <ul className="material-list">{notice.materials.map((item) => <li key={item}><span /><p>{item}</p></li>)}</ul> : <p className="quiet-copy">官方页面未明确列出材料清单，请直接查看原文，不作推测补全。</p>}</div>
        <div className="source-proof"><Icon name="shield" size={19} /><div><span>{notice.verificationStatus === 'official-indexed' ? '官方目录已收录' : '官方原文已核验'} · {notice.sourceDomain}</span><strong>{notice.sourceName}</strong></div>{notice.sourceUrl && <a href={notice.sourceUrl} target="_blank" rel="noreferrer">打开官网 <Icon name="external" size={15} /></a>}</div>
        <footer><button className="secondary-button" onClick={onClose}>稍后处理</button><button className={claimed ? 'primary-button claimed' : 'primary-button'} onClick={onClaim}>{claimed ? '已揭榜 · 查看作战台' : '立即揭榜'}</button></footer>
      </section>
    </div>
  )
}

function formatSyncTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

export default App
