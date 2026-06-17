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

async function writeCacheNoTtl(key, value) {
  const cache = getCacheConfig();
  if (!cache.enabled) return;

  try {
    await fetch(cache.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cache.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', key, JSON.stringify(value)])
    });
  } catch (err) {
    console.log('Cache write no-ttl skipped:', err.message);
  }
}

function verifyCronAuth(req, res) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  if (!expectedSecret) {
    console.warn('CRON_SECRET is not set; schedule-refresh cron is unprotected');
    return true;
  }

  const cronAuth = req.headers.authorization;
  if (!cronAuth || !cronAuth.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({ error: 'Unauthorized', hint: 'Authorization: Bearer <CRON_SECRET>' });
    return false;
  }

  const token = cronAuth.slice(7).trim();
  if (token !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized', hint: 'Invalid CRON_SECRET' });
    return false;
  }

  return true;
}

const BSKY_ACTOR = 'remutarosu.bsky.social';
const X_USERNAME = 'remutarosu';

function formatDateJst(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function classifySchedulePost(text, createdAt) {
  const lower = (text || '').toLowerCase();
  const weeklyKeywords = ['配信スケジュール', '今週のスケジュール', '週間スケジュール', 'weekly schedule'];
  const dailyKeywords = ['配信告知', '本日', '今日', '今夜', 'このあと', 'この後', '枠立て', '待機所'];
  const streamKeywords = ['配信', 'stream', 'live', 'ライブ'];
  const timePattern = /(?:[01]?\d|2[0-3])[:：時][0-5]?\d?/;

  if (weeklyKeywords.some(k => lower.includes(k.toLowerCase()))) {
    return 'weekly';
  }

  const isToday = createdAt ? formatDateJst(createdAt) === formatDateJst() : true;
  const hasDailySignal = dailyKeywords.some(k => lower.includes(k.toLowerCase())) || timePattern.test(text || '');
  const hasStreamSignal = streamKeywords.some(k => lower.includes(k.toLowerCase()));

  if (isToday && hasDailySignal && hasStreamSignal) {
    return 'daily';
  }

  return null;
}

function extractBlueskyImage(post) {
  const images = post?.embed?.images;
  if (Array.isArray(images) && images.length > 0) {
    return images[0].fullsize || images[0].thumb || null;
  }
  return post?.embed?.external?.thumb || null;
}

// Bluesky 取得
async function fetchBlueskySchedules() {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(BSKY_ACTOR)}&filter=posts_no_replies&limit=25`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Bluesky API fetch failed:', res.status, await res.text());
      return [];
    }
    const data = await res.json();
    if (!data.feed || data.feed.length === 0) return [];

    return data.feed
      .map(item => {
        const post = item.post;
        const text = post?.record?.text || '';
        const createdAt = post?.record?.createdAt;
        const type = classifySchedulePost(text, createdAt);
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
    console.error('Bluesky fetch error:', err.message);
  }
  return [];
}

function normalizeXIncludes(includes) {
  const media = new Map();
  for (const item of includes?.media || []) {
    media.set(item.media_key, item.url || item.preview_image_url || null);
  }
  return media;
}

async function fetchXApiSchedules() {
  const bearerToken = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) return [];

  try {
    const authHeaders = { Authorization: `Bearer ${bearerToken}` };
    const userRes = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(X_USERNAME)}`, {
      headers: authHeaders
    });
    if (!userRes.ok) {
      console.warn(`X API user lookup failed with status ${userRes.status}`);
      return [];
    }

    const userData = await userRes.json();
    const userId = userData?.data?.id;
    if (!userId) return [];

    const params = new URLSearchParams({
      max_results: '10',
      'tweet.fields': 'created_at,attachments',
      expansions: 'attachments.media_keys',
      'media.fields': 'url,preview_image_url'
    });
    const tweetsRes = await fetch(`https://api.x.com/2/users/${userId}/tweets?${params}`, {
      headers: authHeaders
    });
    if (!tweetsRes.ok) {
      console.warn(`X API timeline failed with status ${tweetsRes.status}`);
      return [];
    }

    const tweetsData = await tweetsRes.json();
    const media = normalizeXIncludes(tweetsData.includes);

    return (tweetsData.data || [])
      .map(tweet => {
        const type = classifySchedulePost(tweet.text, tweet.created_at);
        if (!type) return null;
        const mediaKeys = tweet.attachments?.media_keys || [];
        return {
          week: formatDateJst(tweet.created_at),
          type,
          source: 'x',
          text: tweet.text,
          image: mediaKeys.map(key => media.get(key)).find(Boolean) || null,
          postUrl: `https://x.com/${X_USERNAME}/status/${tweet.id}`
        };
      })
      .filter(Boolean)
      .slice(0, 5);
  } catch (err) {
    console.error('X API fallback error:', err.message);
    return [];
  }
}

// X (Twitter) 取得（フォールバック）
async function fetchXSchedules() {
  const apiItems = await fetchXApiSchedules();
  if (apiItems.length > 0) return apiItems;

  try {
    const url = `https://x.com/${X_USERNAME}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (!res.ok) {
      console.warn(`X fetch failed with status ${res.status}`);
      return [];
    }
    const html = await res.text();
    
    // OGP等から画像と本文、URL情報を簡易抽出する試み
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i);
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i);
    const ogUrlMatch = html.match(/<meta\s+property=["']og:url["']\s+content=["'](.*?)["']/i);

    const image = ogImageMatch ? ogImageMatch[1] : null;
    const text = ogDescMatch ? ogDescMatch[1] : '';
    const postUrl = ogUrlMatch ? ogUrlMatch[1] : `https://x.com/${X_USERNAME}`;

    const type = classifySchedulePost(text);

    if (type) {
      return [{
        week: formatDateJst(),
        type,
        source: 'x',
        text: text,
        image: image,
        postUrl: postUrl
      }];
    }
  } catch (err) {
    console.error('X scrape fallback error:', err.message);
  }
  return [];
}

// 履歴リストの先頭に新要素を追加し、重複postUrlを除外、最大8件に切り取る
function updateHistory(existing, newItems) {
  const list = Array.isArray(existing) ? existing : [];
  const items = Array.isArray(newItems) ? newItems : [newItems];
  // 重複を除去しながらマージ
  const merged = [...items, ...list];
  const unique = [];
  const seen = new Set();
  for (const item of merged) {
    if (!item.postUrl) continue;
    if (!seen.has(item.postUrl)) {
      seen.add(item.postUrl);
      unique.push(item);
    }
  }
  return unique.slice(0, 8);
}

function mergeMissingScheduleTypes(primary, fallback) {
  const merged = [...primary];
  const hasType = type => merged.some(item => item.type === type);

  for (const item of fallback) {
    if ((item.type === 'weekly' || item.type === 'daily') && !hasType(item.type)) {
      merged.push(item);
    }
  }

  return merged;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST: 手動追加・削除（認証はパスワード）
  if (req.method === 'POST') {
    try {
      const { action, week, text, image, postUrl, password } = req.body || {};
      const expectedSecret = process.env.CRON_SECRET?.trim();
      if (expectedSecret && password !== expectedSecret) {
        return res.status(401).json({ error: 'Unauthorized', hint: 'Invalid password' });
      }

      if (action === 'add_manual') {
        if (!image || !postUrl) {
          return res.status(400).json({ error: 'Image URL and Post URL are required' });
        }

        const newSchedule = {
          week: week || formatDateJst(),
          type: 'manual',
          source: 'manual',
          text: text || '手動登録された配信スケジュール',
          image: image,
          postUrl: postUrl
        };

        const existingRaw = await readCache('schedule_history') || [];
        const updated = updateHistory(existingRaw, newSchedule);
        await writeCacheNoTtl('schedule_history', updated);

        return res.status(200).json({ success: true, schedule: newSchedule });
      }

      if (action === 'delete_manual') {
        if (!postUrl) {
          return res.status(400).json({ error: 'postUrl is required for deletion' });
        }

        const existingRaw = await readCache('schedule_history') || [];
        const filtered = (Array.isArray(existingRaw) ? existingRaw : []).filter(s => s.postUrl !== postUrl);
        await writeCacheNoTtl('schedule_history', filtered);

        return res.status(200).json({ success: true });
      }

      if (action === 'list_manual') {
        const existingRaw = await readCache('schedule_history') || [];
        return res.status(200).json({ schedules: Array.isArray(existingRaw) ? existingRaw : [] });
      }

      return res.status(400).json({ error: 'Invalid action' });
    } catch (err) {
      console.error('Schedule-refresh POST error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // GET: cron自動取得（認証はBearerトークン）
  if (req.method === 'GET') {
    if (!verifyCronAuth(req, res)) {
      return;
    }

    try {
      // 1. Bluesky から取得
      let schedules = await fetchBlueskySchedules();
      let source = 'bluesky';

      // 2. 失敗または不足がある場合、X (Twitter) から取得試行
      const needsFallback = schedules.length === 0 || !schedules.some(item => item.type === 'weekly') || !schedules.some(item => item.type === 'daily');
      if (needsFallback) {
        console.log('Bluesky returned no schedule or missed one notice type. Trying X fallback...');
        const xSchedules = await fetchXSchedules();
        schedules = schedules.length > 0 ? mergeMissingScheduleTypes(schedules, xSchedules) : xSchedules;
        source = schedules.some(item => item.source === 'bluesky') && schedules.some(item => item.source === 'x') ? 'bluesky+x' : schedules[0]?.source || source;
      }

      if (schedules.length > 0) {
        // Redis の履歴を更新
        const existingRaw = await readCache('schedule_history') || [];
        const updated = updateHistory(existingRaw, schedules);
        await writeCacheNoTtl('schedule_history', updated);

        return res.status(200).json({ status: 'updated', source, schedules });
      } else {
        return res.status(200).json({ status: 'no_new_schedule', message: 'No schedule or daily notice posts found on Bluesky or X' });
      }
    } catch (err) {
      console.error('Schedule-refresh GET error:', err.message);
      // 例外終了禁止
      return res.status(200).json({ status: 'error', message: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
