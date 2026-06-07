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

    // 最近の動画（アーカイブ含む）
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&order=date&maxResults=10&type=video&key=${YOUTUBE_API_KEY}`
    );
    const videosData = await videosRes.json();

    // 動画の詳細（時間など）を取得
    const videoIds = videosData.items?.map(v => v.id.videoId).join(',');
    let detailsData = { items: [] };
    if (videoIds) {
      const detailsRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails,statistics&id=${videoIds}&key=${YOUTUBE_API_KEY}`
      );
      detailsData = await detailsRes.json();
    }

    res.status(200).json({
      live: liveData.items || [],
      videos: detailsData.items || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
