export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const CACHE_KEY = 'tiktok_data';

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

  // TikTokは手動データなので固定で返す（キャッシュは1時間）
  const result = {
    videos: [
      {
        title: 'まじでかわいいなぁ？',
        url: 'https://www.tiktok.com/@remutarosu1/video/7648950964237405448',
        date: '2026-06-08T19:00:00+09:00'
      }
    ]
  };

  try {
    await fetch(`${KV_URL}/set/${CACHE_KEY}?ex=3600`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(result))
    });
  } catch(e) {
    console.log('Cache set error:', e.message);
  }

  res.status(200).json(result);
}
