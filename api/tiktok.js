export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.status(200).json({
    videos: [
      /*
      {
        title: 'まじでかわいいなぁ？',
        url: 'https://www.tiktok.com/@remutarosu1/video/7648950964237405448',
        date: '2026-06-08T19:00:00+09:00'
      }
      */
    ]
  });
}
