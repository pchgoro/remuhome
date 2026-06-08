export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
  const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
  const BROADCASTER_LOGIN = 'remutarosu';

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

    // ライブ中
    const streamRes = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${BROADCASTER_LOGIN}`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const streamData = await streamRes.json();

    // 過去配信アーカイブ
    const archiveRes = await fetch(
      `https://api.twitch.tv/helix/videos?user_id=${userId}&first=10&type=archive`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const archiveData = await archiveRes.json();

    // クリップ（Twitch API は標準だと視聴数順なので、取得後に作成日時で並べ替える）
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

    res.status(200).json({
      live: streamData.data || [],
      archives: archiveData.data || [],
      clips: latestClips
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
