// Saine Wave — runs inside the YouTube page so it can ask YouTube to switch videos
// the way YouTube's own links do (no full page reload).
document.addEventListener('saine-wave-nav', e => {
  try {
    const d = JSON.parse(e.detail || '{}');
    if (!/^[\w-]{11}$/.test(d.v)) return;
    const t = Math.max(0, Math.floor(Number(d.t) || 0));
    const url = '/watch?v=' + d.v + (t ? '&t=' + t + 's' : '');
    const app = document.querySelector('ytd-app'); if (!app) return;
    app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint: {
      commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } },
      watchEndpoint: { videoId: d.v, startTimeSeconds: t }
    } } }));
  } catch (err) {}
});
