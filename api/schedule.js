function getCacheConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token, enabled: Boolean(url && token) };
}

async function readCache(key) {
  const cache = getCacheConfig();
  if (!cache.enabled) return null;

  try {
    const cacheRes = await fetch(`${cache.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${cache.token}` }
    });
    const cacheData = await cacheRes.json();
    if (!cacheData.result) return null;
    const parsed = JSON.parse(cacheData.result);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch (err) {
    console.log('Cache read skipped:', err.message);
    return null;
  }
}

const BSKY_ACTOR = 'remutarosu.bsky.social';

function formatDateJst(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function classifySchedulePost(text) {
  const lower = (text || '').toLowerCase();
  const weeklyKeywords = ['配信スケジュール', '今週のスケジュール', '週間スケジュール', 'weekly schedule'];
  const dailyKeywords = ['配信告知', '本日', '今日', '今夜', 'このあと', 'この後', '枠立て', '待機所'];
  const streamKeywords = ['配信', 'stream', 'live', 'ライブ'];
  const timePattern = /(?:[01]?\d|2[0-3])[:：時][0-5]?\d?/;

  if (weeklyKeywords.some(k => lower.includes(k.toLowerCase()))) {
    return 'weekly';
  }

  const hasDailySignal = dailyKeywords.some(k => lower.includes(k.toLowerCase())) || timePattern.test(text || '');
  const hasStreamSignal = streamKeywords.some(k => lower.includes(k.toLowerCase()));

  return hasDailySignal && hasStreamSignal ? 'daily' : null;
}

function extractBlueskyImage(post) {
  const images = post?.embed?.images;
  if (Array.isArray(images) && images.length > 0) {
    return images[0].fullsize || images[0].thumb || null;
  }
  return post?.embed?.external?.thumb || null;
}

async function fetchBlueskySchedules() {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(BSKY_ACTOR)}&filter=posts_no_replies&limit=25`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data.feed)) return [];

    return data.feed
      .map(item => {
        const post = item.post;
        const text = post?.record?.text || '';
        const createdAt = post?.record?.createdAt;
        const type = classifySchedulePost(text);
        if (!type) return null;

        const rkey = post.uri.split('/').pop();
        return {
          week: formatDateJst(createdAt),
          type,
          source: 'bluesky',
          text,
          image: extractBlueskyImage(post),
          postUrl: `https://bsky.app/profile/${BSKY_ACTOR}/post/${rkey}`
        };
      })
      .filter(Boolean)
      .slice(0, 5);
  } catch (err) {
    console.log('Live Bluesky schedule fetch skipped:', err.message);
    return [];
  }
}

function mergeSchedules(primary, fallback) {
  const unique = [];
  const seen = new Set();

  for (const item of [...primary, ...fallback]) {
    if (!item?.postUrl || seen.has(item.postUrl)) continue;
    seen.add(item.postUrl);
    unique.push(item);
  }

  return unique.slice(0, 8);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const historyRaw = await readCache('schedule_history');
    const cachedSchedules = Array.isArray(historyRaw) ? historyRaw : [];
    const liveSchedules = await fetchBlueskySchedules();
    const schedules = mergeSchedules(liveSchedules, cachedSchedules);
    return res.status(200).json({ schedules });
  } catch (err) {
    console.error('Schedule GET error:', err.message);
    return res.status(500).json({ error: err.message, schedules: [] });
  }
}
