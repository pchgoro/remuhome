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

// Bluesky 取得
async function fetchBlueskySchedule() {
  try {
    const url = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=remutarosu.bsky.social&filter=posts_no_replies&limit=10';
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Bluesky API fetch failed:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    if (!data.feed || data.feed.length === 0) return null;

    // 週間スケジュール投稿のみ抽出（「今週の配信スケジュール」等）
    // 単発の配信告知（「本日21:00~」等）は除外する
    const scheduleKeywords = ['配信スケジュール', '今週のスケジュール', 'weekly schedule'];
    const match = data.feed.find(item => {
      const text = item.post?.record?.text || '';
      const hasScheduleKeyword = scheduleKeywords.some(k => text.toLowerCase().includes(k.toLowerCase()));
      const hasImages = item.post?.embed?.images && item.post.embed.images.length > 0;
      return hasScheduleKeyword && hasImages;
    });

    if (match) {
      const post = match.post;
      const rkey = post.uri.split('/').pop();
      return {
        week: post.record.createdAt.substring(0, 10), // "YYYY-MM-DD"
        source: 'bluesky',
        text: post.record.text,
        image: post.embed.images[0].fullsize,
        postUrl: `https://bsky.app/profile/remutarosu.bsky.social/post/${rkey}`
      };
    }
  } catch (err) {
    console.error('Bluesky fetch error:', err.message);
  }
  return null;
}

// X (Twitter) 取得（フォールバック）
async function fetchXSchedule() {
  try {
    const url = 'https://x.com/remutarosu';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (!res.ok) {
      console.warn(`X fetch failed with status ${res.status}`);
      return null;
    }
    const html = await res.text();
    
    // OGP等から画像と本文、URL情報を簡易抽出する試み
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i);
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i);
    const ogUrlMatch = html.match(/<meta\s+property=["']og:url["']\s+content=["'](.*?)["']/i);

    const image = ogImageMatch ? ogImageMatch[1] : null;
    const text = ogDescMatch ? ogDescMatch[1] : '';
    const postUrl = ogUrlMatch ? ogUrlMatch[1] : 'https://x.com/remutarosu';

    // スケジュール画像っぽい条件
    const keywords = ['配信告知', '配信スケジュール', 'schedule', '今週'];
    const hasKeyword = keywords.some(k => text.toLowerCase().includes(k.toLowerCase()));

    if (hasKeyword && image) {
      return {
        week: new Date().toISOString().substring(0, 10),
        source: 'x',
        text: text,
        image: image,
        postUrl: postUrl
      };
    }
  } catch (err) {
    console.error('X scrape fallback error:', err.message);
  }
  return null;
}

// 履歴リストの先頭に新要素を追加し、重複postUrlを除外、最大5件に切り取る
function updateHistory(existing, newItem) {
  const list = Array.isArray(existing) ? existing : [];
  // 重複を除去しながらマージ
  const merged = [newItem, ...list];
  const unique = [];
  const seen = new Set();
  for (const item of merged) {
    if (!item.postUrl) continue;
    if (!seen.has(item.postUrl)) {
      seen.add(item.postUrl);
      unique.push(item);
    }
  }
  return unique.slice(0, 5);
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
          week: week || new Date().toISOString().substring(0, 10),
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
      let schedule = await fetchBlueskySchedule();
      let source = 'bluesky';

      // 2. 失敗した場合、X (Twitter) から取得試行
      if (!schedule) {
        console.log('Bluesky fetch failed or returned no schedule. Trying X fallback...');
        schedule = await fetchXSchedule();
        source = 'x';
      }

      if (schedule) {
        // Redis の履歴を更新
        const existingRaw = await readCache('schedule_history') || [];
        const updated = updateHistory(existingRaw, schedule);
        await writeCacheNoTtl('schedule_history', updated);

        return res.status(200).json({ status: 'updated', source, schedule });
      } else {
        return res.status(200).json({ status: 'no_new_schedule', message: 'No schedule posts found on Bluesky or X' });
      }
    } catch (err) {
      console.error('Schedule-refresh GET error:', err.message);
      // 例外終了禁止
      return res.status(200).json({ status: 'error', message: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
