const CACHE_KEY = 'tiktok_data_v2';

const baseVideos = [
  {
    id: '7648950964237405448',
    title: 'まじでかわいいなぁ？',
    url: 'https://www.tiktok.com/@remutarosu1/video/7648950964237405448',
    date: '2026-06-08T19:00:00+09:00',
    thumbnail: null,
    platform: 'tiktok'
  },
  {
    id: '7648486889913175314',
    title: 'このエフェクト、似合うかな？ ',
    url: 'https://www.tiktok.com/@remutarosu1/video/7648486889913175314',
    date: '2026-06-08T19:00:00+09:00',
    thumbnail: null,
    platform: 'tiktok'
  },
  {
    id: '7648203731745426695',
    title: 'このエフェクト、リンネーにピッタリじゃん？',
    url: 'https://www.tiktok.com/@remutarosu1/video/7648203731745426695',
    date: '2026-06-08T19:00:00+09:00',
    thumbnail: null,
    platform: 'tiktok'
  },
  {
    id: '7647881059874409735',
    title: 'ぎゃるは好きですか？🥰鳴潮をやろう！',
    url: 'https://www.tiktok.com/@remutarosu1/video/7647881059874409735',
    date: '2026-06-07T19:00:00+09:00',
    thumbnail: null,
    platform: 'tiktok'
  },
  {
    id: '7646556294928665863',
    title: 'NGバージョン😂',
    url: 'https://www.tiktok.com/@remutarosu1/video/7646556294928665863',
    date: '2026-06-03T19:00:00+09:00',
    thumbnail: null,
    platform: 'tiktok'
  }
];

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

async function deleteCache(key) {
  const cache = getCacheConfig();
  if (!cache.enabled) return;

  try {
    await fetch(cache.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cache.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['DEL', key])
    });
  } catch (err) {
    console.log('Cache delete skipped:', err.message);
  }
}

async function fetchVideos() {
  const url = 'https://www.tiktok.com/embed/@remutarosu1';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  if (!res.ok) throw new Error(`Failed to fetch embed: ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script\s+id="__FRONTITY_CONNECT_STATE__"\s+type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__FRONTITY_CONNECT_STATE__ not found in embed');
  const data = JSON.parse(match[1]);
  const sourceData = data.source?.data || {};
  const embedKey = Object.keys(sourceData).find(k => k.startsWith('/embed/@'));
  if (!embedKey || !sourceData[embedKey]) throw new Error('Embed key data not found in state');
  
  const videoList = sourceData[embedKey].videoList || [];
  return videoList.map(v => {
    let dateStr = null;
    try {
      // Parse timestamp from Snowflake ID (first 32 bits of 64-bit BigInt)
      const ts = Number(BigInt(v.id) >> 32n);
      dateStr = new Date(ts * 1000).toISOString();
    } catch (e) {
      console.error('Failed to parse Snowflake date for video ID:', v.id, e.message);
    }
    return {
      title: v.desc || 'TikTok動画',
      url: `https://www.tiktok.com/@remutarosu1/video/${v.id}`,
      date: dateStr,
      thumbnail: v.coverUrl || null,
      id: v.id,
      platform: 'tiktok'
    };
  });
}

async function fetchLiveStatus() {
  const url = 'https://www.tiktok.com/@remutarosu1';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"\s+type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__UNIVERSAL_DATA_FOR_REHYDRATION__ not found in profile');
  const data = JSON.parse(match[1]);
  const scope = data.__DEFAULT_SCOPE__ || {};
  const userDetail = scope['webapp.user-detail'] || {};
  const userInfo = userDetail.userInfo || {};
  const user = userInfo.user || {};
  
  const roomId = user.roomId || null;
  const isLive = Boolean(roomId && roomId !== '0' && roomId !== '');
  
  return {
    isLive,
    roomId,
    title: isLive ? 'れむたろす TikTok配信中' : '',
    url: isLive ? 'https://www.tiktok.com/@remutarosu1/live' : '',
    platform: 'tiktok'
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle manual video additions or deletions (POST)
  if (req.method === 'POST') {
    try {
      const { action, url, title, password, id } = req.body || {};
      
      // Auth verification using CRON_SECRET
      const expectedSecret = process.env.CRON_SECRET?.trim();
      if (expectedSecret && password !== expectedSecret) {
        return res.status(401).json({ error: 'Unauthorized', hint: 'Invalid password' });
      }

      if (action === 'add_manual') {
        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }

        const idMatch = url.match(/\/video\/(\d+)/);
        if (!idMatch) {
          return res.status(400).json({ error: 'Invalid TikTok video URL. Must contain /video/<id>' });
        }
        const videoId = idMatch[1];

        // Parse date using Snowflake ID BigInt shifting
        let dateStr = new Date().toISOString();
        try {
          const ts = Number(BigInt(videoId) >> 32n);
          dateStr = new Date(ts * 1000).toISOString();
        } catch (e) {
          console.error('Snowflake calculation error for manual video:', e.message);
        }

        // Try getting title/thumbnail via oEmbed
        let finalTitle = title || 'TikTok動画';
        let coverUrl = null;
        try {
          const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
          if (oembedRes.ok) {
            const oembedData = await oembedRes.json();
            if (!title && oembedData.title) {
              finalTitle = oembedData.title;
            }
            coverUrl = oembedData.thumbnail_url || null;
          }
        } catch (err) {
          console.error('oEmbed fetch failed for manual video:', err.message);
        }

        const newVideo = {
          id: videoId,
          title: finalTitle,
          url: `https://www.tiktok.com/@remutarosu1/video/${videoId}`,
          date: dateStr,
          thumbnail: coverUrl,
          platform: 'tiktok',
          isManual: true
        };

        const currentRaw = await readCache('manual_tiktok_videos') || [];
        const currentList = Array.isArray(currentRaw) ? currentRaw : [];
        const filteredList = currentList.filter(v => v.id !== videoId);
        filteredList.unshift(newVideo);

        await writeCacheNoTtl('manual_tiktok_videos', filteredList);
        await deleteCache(CACHE_KEY);

        return res.status(200).json({ success: true, video: newVideo });
      }

      if (action === 'delete_manual') {
        if (!id) {
          return res.status(400).json({ error: 'Video ID is required' });
        }

        const currentRaw = await readCache('manual_tiktok_videos') || [];
        const currentList = Array.isArray(currentRaw) ? currentRaw : [];
        const filteredList = currentList.filter(v => v.id !== id);

        await writeCacheNoTtl('manual_tiktok_videos', filteredList);
        await deleteCache(CACHE_KEY);

        return res.status(200).json({ success: true });
      }

      if (action === 'list_manual') {
        const currentRaw = await readCache('manual_tiktok_videos') || [];
        const currentList = Array.isArray(currentRaw) ? currentRaw : [];
        return res.status(200).json({ videos: currentList });
      }

      return res.status(400).json({ error: 'Invalid action' });
    } catch (err) {
      console.error('TikTok POST error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Handle GET (scrape + read manual videos + merge + sort)
  const cached = await readCache(CACHE_KEY);
  if (cached) {
    console.log('tiktok cache hit');
    return res.status(200).json(cached);
  }
  console.log('tiktok cache miss');

  let videos = [];
  let live = [];
  let error = null;

  try {
    const [fetchedVideos, liveStatus, manualVideosRaw] = await Promise.all([
      fetchVideos().catch(err => {
        console.error('Fetch videos failed:', err.message);
        return null;
      }),
      fetchLiveStatus().catch(err => {
        console.error('Fetch live status failed:', err.message);
        return null;
      }),
      readCache('manual_tiktok_videos').catch(err => {
        console.error('Fetch manual videos failed:', err.message);
        return [];
      })
    ]);

    const manualVideos = Array.isArray(manualVideosRaw) ? manualVideosRaw : [];

    if (fetchedVideos) {
      videos = fetchedVideos;
    } else if (cached && cached.videos) {
      videos = cached.videos;
      error = 'Failed to fetch latest videos, using stale cache';
    } else {
      videos = baseVideos;
      error = 'Failed to fetch videos, using fallback list';
    }

    // Merge dynamic and manual lists, deduplicate by ID
    const mergedMap = new Map();
    videos.forEach(v => mergedMap.set(v.id, v));
    manualVideos.forEach(v => mergedMap.set(v.id, { ...v, isManual: true }));

    const mergedList = Array.from(mergedMap.values());
    mergedList.sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(0);
      const dateB = b.date ? new Date(b.date) : new Date(0);
      return dateB - dateA;
    });

    if (liveStatus) {
      live = liveStatus.isLive ? [liveStatus] : [];
    } else if (cached && cached.live) {
      live = cached.live;
    } else {
      live = [];
    }

    const result = { live, videos: mergedList, error };

    if (fetchedVideos || liveStatus) {
      await writeCache(CACHE_KEY, result, 900);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('TikTok API global error:', err.message);
    
    let manualVideos = [];
    try {
      const manualRaw = await readCache('manual_tiktok_videos');
      if (Array.isArray(manualRaw)) manualVideos = manualRaw;
    } catch (_) {}

    const mergedMap = new Map();
    baseVideos.forEach(v => mergedMap.set(v.id, v));
    manualVideos.forEach(v => mergedMap.set(v.id, { ...v, isManual: true }));
    const mergedList = Array.from(mergedMap.values());
    mergedList.sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(0);
      const dateB = b.date ? new Date(b.date) : new Date(0);
      return dateB - dateA;
    });

    return res.status(200).json({ live: [], videos: mergedList, error: err.message });
  }
}
