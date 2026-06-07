export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
  const CHANNEL_ID = 'UC6FgzOrl2Nmw7737hNXpKqw';

  try {
    // Search APIは1回だけ（最新20件を取得）
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&type=video&order=date&maxResults=20&key=${YOUTUBE_API_KEY}`
    );
    const searchData = await searchRes.json();

    if (searchData.error) {
      return res.status(200).json({ live: [], archives: [], videos: [], error: searchData.error.message });
    }

    const allItems = searchData.items || [];

    // ライブ中を抽出
    const liveItems = allItems.filter(v => v.snippet?.liveBroadcastContent === 'live');

    // ライブ以外の動画IDをまとめて取得（Videos APIはクォータ消費が少ない）
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

    // アーカイブ（配信録画）と通常動画に分類
    const archives = [];
    const videos = [];
    (videoDetails.items || []).forEach(v => {
      const lbc = v.snippet?.liveBroadcastContent;
      const hasLiveDetails = v.liveStreamingDetails?.actualStartTime;
      if (hasLiveDetails || lbc === 'completed') {
        archives.push(v);
      } else {
        videos.push(v);
      }
    });

    res.status(200).json({
      live: liveItems,
      archives,
      videos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
