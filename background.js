// Saine Wave — background
chrome.action.onClicked.addListener(tab => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { t: 'toggle' }).catch(() => {});
});

// Lyrics lookups go through here so the YouTube page's own rules can't block them.
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || m.t !== 'lrclib' || typeof m.path !== 'string') return;
  if (!/^\/api\/(search\?|get\/\d+$)/.test(m.path)) { reply({ ok: false, error: 'bad path' }); return; }
  fetch('https://lrclib.net' + m.path, { headers: { 'Lrclib-Client': 'Saine Wave/' + chrome.runtime.getManifest().version + ' (browser extension)' } })
    .then(async r => {
      if (r.status === 429) return reply({ ok: false, status: 429 });
      if (!r.ok) return reply({ ok: false, status: r.status });
      reply({ ok: true, data: await r.json() });
    })
    .catch(err => reply({ ok: false, error: String(err) }));
  return true; // reply comes later
});
