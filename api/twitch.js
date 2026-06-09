export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
  const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
  const BROADCASTER_LOGIN = 'remutarosu';
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const CACHE_KEY = 'twitch_data';

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
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${BROADCASTER_LOGIN}`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const userData = await userRes.json();
    const userId = userData.data?.[0]?.id;
    if (!userId) throw new Error('ユーザーが見つかりません');

    const streamRes = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${BROADCASTER_LOGIN}`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const streamData = await streamRes.json();

    const archiveRes = await fetch(
      `https://api.twitch.tv/helix/videos?user_id=${userId}&first=10&type=archive`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const archiveData = await archiveRes.json();

    const now = new Date();
    const startedAt = new Date(now);
    startedAt.setMonth(startedAt.getMonth() - 3);

    const clips = [];
    let clipsCursor = '';

    for (let page = 0; page < 3; page++) {
      const params = new URLSearchParams({
        broadcaster_id: userId,
        first: '100',
        started_at: startedAt.toISOString(),
        ended_at: now.toISOString()
      });
      if (clipsCursor) params.set('after', clipsCursor);

      const clipsRes = await fetch(
        `https://api.twitch.tv/helix/clips?${params.toString()}`,
        { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
      );
      const clipsData = await clipsRes.json();

      clips.push(...(clipsData.data || []));
      clipsCursor = clipsData.pagination?.cursor || '';
      if (!clipsCursor) break;
    }

    const latestClips = clips
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    const result = {
      live: streamData.data || [],
      archives: archiveData.data || [],
      clips: latestClips
    };

    // ライブ中は5分、通常は15分キャッシュ
    const ttl = result.live.length > 0 ? 300 : 900;
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
