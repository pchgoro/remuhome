import webpush from 'web-push';

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

async function writeCache(key, value) {
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
    console.log('Cache write skipped:', err.message);
  }
}

async function addOrUpdateSubscription(subData) {
  const cache = getCacheConfig();
  if (!cache.enabled) return;
  try {
    // Fetch existing subscriptions
    const res = await fetch(cache.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cache.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SMEMBERS', 'subscriptions'])
    });
    const data = await res.json();
    const members = data.result || [];
    
    // Find target endpoint from the incoming subData
    const targetEndpoint = subData.subscription?.endpoint || subData.endpoint;
    if (!targetEndpoint) return;
    
    const toRemove = [];
    
    for (const memberStr of members) {
      try {
        const parsed = JSON.parse(memberStr);
        const endpoint = parsed.endpoint || parsed.subscription?.endpoint;
        if (endpoint === targetEndpoint) {
          toRemove.push(memberStr);
        }
      } catch (e) {
        // Remove invalid entries
        toRemove.push(memberStr);
      }
    }
    
    // SREM matching elements
    if (toRemove.length > 0) {
      await Promise.all(
        toRemove.map(memberStr => 
          fetch(cache.url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cache.token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(['SREM', 'subscriptions', memberStr])
          })
        )
      );
    }
    
    // SADD the new subscription configuration
    await fetch(cache.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cache.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SADD', 'subscriptions', JSON.stringify(subData)])
    });
  } catch (err) {
    console.log('Redis subscription addition/update failed:', err.message);
  }
}

export async function getVapidKeys() {
  // Check environment variables first
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    return { publicKey, privateKey };
  }

  // Otherwise check cache
  const cachedKeys = await readCache('vapid_keys');
  if (cachedKeys && cachedKeys.publicKey && cachedKeys.privateKey) {
    return cachedKeys;
  }

  // Generate new keys and cache them permanently
  console.log('Generating new VAPID keys...');
  const keys = webpush.generateVAPIDKeys();
  await writeCache('vapid_keys', keys);
  return keys;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const keys = await getVapidKeys();

  if (req.method === 'GET') {
    return res.status(200).json({ publicKey: keys.publicKey });
  }

  if (req.method === 'POST') {
    const subData = req.body;
    
    // Support test push delivery
    if (subData && subData.action === 'test') {
      const subscription = subData.subscription;
      if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Invalid subscription for testing' });
      }
      try {
        webpush.setVapidDetails(
          process.env.VAPID_SUBJECT || 'mailto:your-email@example.com',
          keys.publicKey,
          keys.privateKey
        );
        await webpush.sendNotification(subscription, JSON.stringify({
          title: '🐈⚡ 通知テスト成功！',
          body: 'たろみんサポートアプリからのプッシュ通知が正常に届きました。',
          url: '/'
        }));
        return res.status(200).json({ success: true });
      } catch (err) {
        return res.status(500).json({ error: `Push delivery failed: ${err.message}` });
      }
    }

    // Regular register subscription logic
    const sub = subData?.subscription || subData;
    if (!sub || !sub.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    
    // Save to Redis (using subData directly to preserve preferences if provided)
    await addOrUpdateSubscription(subData);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
