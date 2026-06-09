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
    console.log('tiktok cache hit');
    return res.status(200).json(cached);
  }
  console.log('tiktok cache miss');

  const baseVideos = [
    {
      title: 'まじでかわいいなぁ？',
      url: 'https://www.tiktok.com/@remutarosu1/video/7648950964237405448',
      date: '2026-06-08T19:00:00+09:00'
    },
    {
      title: 'このエフェクト、似合うかな？ ',
      url: 'https://www.tiktok.com/@remutarosu1/video/7648486889913175314',
      date: '2026-06-08T19:00:00+09:00'
    },
    {
      title: 'このエフェクト、リンネーにピッタリじゃん？',
      url: 'https://www.tiktok.com/@remutarosu1/video/7648203731745426695',
      date: '2026-06-08T19:00:00+09:00'
    },
    {
      title: 'ぎゃるは好きですか？🥰鳴潮をやろう！',
      url: 'https://www.tiktok.com/@remutarosu1/video/7647881059874409735',
      date: '2026-06-07T19:00:00+09:00'
    },
    {
      title: 'NGバージョン😂',
      url: 'https://www.tiktok.com/@remutarosu1/video/7646556294928665863',
      date: '2026-06-03T19:00:00+09:00'
    }
  ];

  try {
    const fetchPromises = baseVideos.map(async (v) => {
      try {
        const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(v.url)}`;
        const response = await fetch(oembedUrl);
        if (response.ok) {
          const data = await response.json();
          return {
            ...v,
            thumbnail: data.thumbnail_url || null
          };
        }
      } catch (err) {
        console.error(`Error fetching oembed for ${v.url}:`, err);
      }
      return {
        ...v,
        thumbnail: null
      };
    });

    const videos = await Promise.all(fetchPromises);
    const result = { videos };

    // Cache for 12 hours (43200 seconds) since TikTok links expire in ~24h
    await writeCache(CACHE_KEY, result, 43200);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ videos: baseVideos });
  }
}
