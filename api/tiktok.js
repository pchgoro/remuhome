const CACHE_KEY = 'tiktok_data';

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

async function writeCache(key, value, ttl) {
  const cache = getCacheConfig();
  if (!cache.enabled) return;

  try {
    await fetch(cache.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cache.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', ttl])
    });
  } catch (err) {
    console.log('Cache write skipped:', err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const cached = await readCache(CACHE_KEY);
  if (cached) {
    return res.status(200).json(cached);
  }

  const result = {
    videos: [
      {
        title: 'まじでかわいいなぁ？',
        url: 'https://www.tiktok.com/@remutarosu1/video/7648950964237405448',
        date: '2026-06-08T19:00:00+09:00'
      }
    ]
  };

  await writeCache(CACHE_KEY, result, 3600);
  return res.status(200).json(result);
}
