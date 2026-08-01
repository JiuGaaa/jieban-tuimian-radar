import { refreshFeed } from '../server/sync.mjs'

const feed = await refreshFeed()
console.log(JSON.stringify({
  noticeCount: feed.notices.length,
  lastSyncedAt: feed.meta.lastSyncedAt,
  successfulSources: `${feed.meta.successfulSourceCount}/${feed.meta.sourceCount}`,
  failedSources: feed.meta.sources.filter((source) => !source.ok).map((source) => ({ name: source.name, error: source.error }))
}, null, 2))
