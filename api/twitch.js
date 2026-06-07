export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
  const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
  const BROADCASTER_LOGIN = 'remutarosu';

  try {
    // アクセストークン取得
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // ユーザー情報取得
    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${BROADCASTER_LOGIN}`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const userData = await userRes.json();
    const userId = userData.data?.[0]?.id;

    if (!userId) throw new Error('ユーザーが見つかりません');

    // ライブ配信中か確認
    const streamRes = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${BROADCASTER_LOGIN}`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const streamData = await streamRes.json();

    // 過去の配信（クリップ）
    const clipsRes = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=10`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const clipsData = await clipsRes.json();

    // チャンネル情報
    const channelRes = await fetch(
      `https://api.twitch.tv/helix/channels?broadcaster_id=${userId}`,
      { headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${accessToken}` } }
    );
    const channelData = await channelRes.json();

    res.status(200).json({
      live: streamData.data || [],
      clips: clipsData.data || [],
      channel: channelData.data?.[0] || {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
