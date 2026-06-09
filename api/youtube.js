const CHANNEL_ID = 'UC6FgzOrl2Nmw7737hNXpKqw';
const CACHE_KEY = 'youtube_data';

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
    console.log('youtube cache hit');
    return res.status(200).json(cached);
  }
  console.log('youtube cache miss');

  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

  try {
    console.log('youtube api fetch: search');
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&type=video&order=date&maxResults=20&key=${YOUTUBE_API_KEY}`
    );
    const searchData = await searchRes.json();

    if (searchData.error) {
      return res.status(200).json({ live: [], archives: [], videos: [], error: searchData.error.message });
    }

    const allItems = searchData.items || [];
    const liveItems = allItems.filter(v => v.snippet?.liveBroadcastContent === 'live');

    const nonLiveIds = allItems
      .filter(v => v.snippet?.liveBroadcastContent !== 'live')
      .map(v => v.id?.videoId)
      .filter(Boolean)
      .join(',');

    let videoDetails = { items: [] };
    if (nonLiveIds) {
      console.log('youtube api fetch: videos');
      const detailRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails&id=${nonLiveIds}&key=${YOUTUBE_API_KEY}`
      );
      videoDetails = await detailRes.json();
    }

    const archives = [];
    const videos = [];
    (videoDetails.items || []).forEach(v => {
      const hasLiveDetails = v.liveStreamingDetails?.actualStartTime;
      const lbc = v.snippet?.liveBroadcastContent;
      if (hasLiveDetails || lbc === 'completed') {
        archives.push(v);
      } else {
        videos.push(v);
      }
    });

    const result = { live: liveItems, archives, videos };
    const ttl = liveItems.length > 0 ? 300 : 900;
    await writeCache(CACHE_KEY, result, ttl);

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
