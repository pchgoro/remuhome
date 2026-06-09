export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
  const CHANNEL_ID = 'UC6FgzOrl2Nmw7737hNXpKqw';
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const CACHE_KEY = 'youtube_data';

  // キャッシュ確認
  try {
    const cacheRes = await fetch(`${KV_URL}/get/${CACHE_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const cacheData = await cacheRes.json();
    if (cacheData.result) {
      return res.status(200).json(JSON.parse(cacheData.result));
    }
  } catch(e) {
    console.log('Cache miss:', e.message);
  }

  try {
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

    // ライブ中は5分、通常は15分キャッシュ
    const ttl = liveItems.length > 0 ? 300 : 900;
    await fetch(`${KV_URL}/set/${CACHE_KEY}?ex=${ttl}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(result))
    });

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
