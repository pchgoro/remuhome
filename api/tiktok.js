export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.status(200).json({
    videos: [
      {
        title: 'まじでかわいいなぁ？',
        url: 'https://www.tiktok.com/@remutarosu1/video/7648950964237405448',
        date: '2026-06-08T19:00:00+09:00'
      },
      {
        title: 'このエフェクト、似合うかな？ ',
        url: 'https://www.tiktok.com/@remutarosu1/video/7648486889913175314',
        date: '2026-06-08T19:00:00+09:00'
      },
      {
        title: 'このエフェクト、リンネーにピッタリじゃん？',
        url: 'https://www.tiktok.com/@remutarosu1/video/7648203731745426695',
        date: '2026-06-08T19:00:00+09:00'
      },
      {
        title: 'ぎゃるは好きですか？🥰鳴潮をやろう！',
        url: 'https://www.tiktok.com/@remutarosu1/video/7647881059874409735',
        date: '2026-06-07T19:00:00+09:00'
      },
      {
        title: 'NGバージョン😂',
        url: 'https://www.tiktok.com/@remutarosu1/video/7646556294928665863',
        date: '2026-06-03T19:00:00+09:00'
      }
    ]
  });
}
