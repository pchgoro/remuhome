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

    // 配信アーカイブ（completed = 終了した配信）
    const archiveRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=completed&type=video&order=date&maxResults=10&key=${YOUTUBE_API_KEY}`
    );
    const archiveData = await archiveRes.json();
    const archiveIds = (archiveData.items || []).map(v => v.id.videoId).join(',');

    let archiveDetails = { items: [] };
    if (archiveIds) {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails&id=${archiveIds}&key=${YOUTUBE_API_KEY}`
      );
      archiveDetails = await r.json();
    }

    // 通常動画（none = ライブでない動画）
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=none&type=video&order=date&maxResults=10&key=${YOUTUBE_API_KEY}`
    );
    const videosData = await videosRes.json();
    const videoIds = (videosData.items || []).map(v => v.id.videoId).join(',');

    let videoDetails = { items: [] };
    if (videoIds) {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`
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
