import { getVapidKeys } from './subscribe.js';
import webpush from 'web-push';

function getCacheConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token, enabled: Boolean(url && token) };
}

async function runRedisCommand(command) {
  const cache = getCacheConfig();
  if (!cache.enabled) return null;
  try {
    const res = await fetch(cache.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cache.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    });
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error('Redis command failed:', command, err.message);
    return null;
  }
}

async function getSubscriptions() {
  const result = await runRedisCommand(['SMEMBERS', 'subscriptions']);
  if (!result) return [];
  return result.map(s => {
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

function verifyCronAuth(req, res) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  if (!expectedSecret) {
    console.warn('CRON_SECRET is not set; cron-check is unprotected');
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronAuth(req, res)) {
    return;
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';

  // Fetch feeds in parallel
  const ytPromise = fetch(`${protocol}://${host}/api/youtube`).then(r => r.json()).catch(() => null);
  const twPromise = fetch(`${protocol}://${host}/api/twitch`).then(r => r.json()).catch(() => null);
  const tkPromise = fetch(`${protocol}://${host}/api/tiktok`).then(r => r.json()).catch(() => null);

  const [ytData, twData, tkData] = await Promise.all([ytPromise, twPromise, tkPromise]);

  // Extract latest IDs
  const ytLiveId = ytData?.live?.[0]?.id?.videoId || ytData?.live?.[0]?.id || null;
  const ytVideoId = ytData?.videos?.[0]?.id || ytData?.archives?.[0]?.id || null;
  const ytVideoTitle = ytData?.videos?.[0]?.snippet?.title || ytData?.archives?.[0]?.snippet?.title || '';
  const ytVideoUrl = ytVideoId ? `https://www.youtube.com/watch?v=${ytVideoId}` : 'https://www.youtube.com/@remutarosu';

  const twLiveId = twData?.live?.[0]?.id || null;
  const twVideoId = twData?.archives?.[0]?.id || null;
  const twVideoTitle = twData?.archives?.[0]?.title || '';
  const twVideoUrl = twData?.archives?.[0]?.url || 'https://twitch.tv/remutarosu';

  const tkVideoUrl = tkData?.videos?.[0]?.url || null;
  const tkVideoTitle = tkData?.videos?.[0]?.title || '';

  // Get last checked state
  const lastCheckedRaw = await runRedisCommand(['GET', 'last_checked']);
  let lastCheckedState = null;
  if (lastCheckedRaw) {
    try {
      lastCheckedState = typeof lastCheckedRaw === 'string' ? JSON.parse(lastCheckedRaw) : lastCheckedRaw;
    } catch (e) {
      console.error('Failed to parse last checked state:', e);
    }
  }

  const newState = {
    youtube_live: lastCheckedState?.youtube_live ?? null,
    youtube_video: lastCheckedState?.youtube_video ?? null,
    twitch_live: lastCheckedState?.twitch_live ?? null,
    twitch_video: lastCheckedState?.twitch_video ?? null,
    tiktok_video: lastCheckedState?.tiktok_video ?? null
  };

  // If this is the first run, initialize state and do not notify
  if (!lastCheckedState) {
    const initialState = {
      youtube_live: ytLiveId,
      youtube_video: ytVideoId,
      twitch_live: twLiveId,
      twitch_video: twVideoId,
      tiktok_video: tkVideoUrl
    };
    await runRedisCommand(['SET', 'last_checked', JSON.stringify(initialState)]);
    return res.status(200).json({ status: 'initialized', state: initialState });
  }

  const notifications = [];

  // Check YouTube Live
  if (ytData && !ytData.error) {
    if (ytLiveId && ytLiveId !== lastCheckedState.youtube_live) {
      notifications.push({
        title: '🔴 れむたろす YouTube配信開始！',
        body: ytData.live[0].snippet?.title || 'ライブ配信がスタートしました！',
        url: `https://www.youtube.com/watch?v=${ytLiveId}`
      });
    }
    newState.youtube_live = ytLiveId;
  }

  // Check Twitch Live
  if (twData && !twData.error) {
    if (twLiveId && twLiveId !== lastCheckedState.twitch_live) {
      notifications.push({
        title: '🔴 れむたろす Twitch配信開始！',
        body: twData.live[0].title || 'ライブ配信がスタートしました！',
        url: 'https://twitch.tv/remutarosu'
      });
    }
    newState.twitch_live = twLiveId;
  }

  // Check YouTube Video
  if (ytData && !ytData.error) {
    if (ytVideoId && ytVideoId !== lastCheckedState.youtube_video) {
      notifications.push({
        title: '▶ れむたろす 新しいYouTube動画！',
        body: ytVideoTitle,
        url: ytVideoUrl
      });
    }
    newState.youtube_video = ytVideoId;
  }

  // Check Twitch Archive
  if (twData && !twData.error) {
    if (twVideoId && twVideoId !== lastCheckedState.twitch_video) {
      notifications.push({
        title: '🎮 れむたろす Twitchアーカイブ公開！',
        body: twVideoTitle,
        url: twVideoUrl
      });
    }
    newState.twitch_video = twVideoId;
  }

  // Check TikTok Video
  if (tkData && !tkData.error) {
    if (tkVideoUrl && tkVideoUrl !== lastCheckedState.tiktok_video) {
      notifications.push({
        title: '♪ れむたろす 新しいTikTok動画！',
        body: tkVideoTitle,
        url: tkVideoUrl
      });
    }
    newState.tiktok_video = tkVideoUrl;
  }

  // Update state in Redis
  await runRedisCommand(['SET', 'last_checked', JSON.stringify(newState)]);

  // If there are new items, broadcast notifications
  if (notifications.length > 0) {
    const subscriptions = await getSubscriptions();
    if (subscriptions.length === 0) {
      return res.status(200).json({ status: 'no_subscriptions', notifications });
    }

    const keys = await getVapidKeys();
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:your-email@example.com',
      keys.publicKey,
      keys.privateKey
    );

    const expiredSubs = [];
    const pushPromises = [];

    for (const notification of notifications) {
      const payloadString = JSON.stringify(notification);
      subscriptions.forEach(sub => {
        pushPromises.push(
          webpush.sendNotification(sub, payloadString).catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              expiredSubs.push(JSON.stringify(sub));
            } else {
              console.error('Push notification delivery error:', err.message);
            }
          })
        );
      });
    }

    await Promise.all(pushPromises);

    const uniqueExpired = [...new Set(expiredSubs)];

    // Clean up expired subscriptions
    if (uniqueExpired.length > 0) {
      console.log(`Removing ${uniqueExpired.length} expired subscriptions...`);
      await Promise.all(
        uniqueExpired.map(subStr => runRedisCommand(['SREM', 'subscriptions', subStr]))
      );
    }

    return res.status(200).json({
      status: 'notifications_sent',
      count: notifications.length,
      sentTo: subscriptions.length - uniqueExpired.length
    });
  }

  return res.status(200).json({ status: 'no_updates', state: newState });
}
