export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
  const CHANNEL_ID = 'UC6FgzOrl2Nmw7737hNXpKqw';

  try {
    // ライブ配信中か確認
    const liveRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`
    );
    const liveData = await liveRes.json();

    // ライブアーカイブ（配信録画）
    const archiveRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=completed&type=video&order=date&maxResults=10&key=${YOUTUBE_API_KEY}`
    );
    const archiveData = await archiveRes.json();

    // 通常動画（配信以外）
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&type=video&order=date&maxResults=10&key=${YOUTUBE_API_KEY}`
    );
    const videosData = await videosRes.json();

    // アーカイブの詳細（時間など）
    const archiveIds = archiveData.items?.map(v => v.id.videoId).join(',');
    let archiveDetails = { items: [] };
    if (archiveIds) {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails,statistics&id=${archiveIds}&key=${YOUTUBE_API_KEY}`
      );
      archiveDetails = await r.json();
    }

    // 通常動画の詳細
    const videoIds = videosData.items?.map(v => v.id.videoId).join(',');
    let videoDetails = { items: [] };
    if (videoIds) {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoIds}&key=${YOUTUBE_API_KEY}`
      );
      videoDetails = await r.json();
    }

    res.status(200).json({
      live: liveData.items || [],
      archives: archiveDetails.items || [],
      videos: videoDetails.items || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
