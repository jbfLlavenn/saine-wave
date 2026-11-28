// Saine Wave — clip songs from YouTube streams, loop them, play them as playlists.
(() => {
  if (window.__saineWave) return;
  window.__saineWave = true;

  // ---------- helpers ----------
  const sync = chrome.storage.sync, local = chrome.storage.local;
  const q = s => document.querySelector(s);
  const V = () => q('video.html5-main-video') || q('video');
  const vidNow = () => (location.pathname === '/watch' && new URLSearchParams(location.search).get('v')) || '';
  const r1 = n => Math.round(n * 10) / 10;
  const adOn = () => !!q('#movie_player.ad-showing, .ad-showing');   // YouTube marks its player while an ad plays
  const AD_WAIT = 'An ad is playing. Wait for it to finish, then try again.';
  const fmt = n => {
    n = Math.max(0, Math.round(n));
    const h = Math.floor(n / 3600), m = Math.floor((n - h * 3600) / 60), s = n - h * 3600 - m * 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  };
  const videoTitle = () => {
    const h = q('h1.ytd-watch-metadata yt-formatted-string') || q('h1.ytd-watch-metadata');
    return ((h && h.textContent.trim()) || document.title.replace(/ - YouTube$/, '').replace(/^\(\d+\) /, '')).slice(0, 120);
  };
  // a song link; LRCLIB lyrics, their offset and tap-sync timings ride along so the person you send it to sees them too
  const link = (x, at) => location.origin + '/watch?v=' + x.v + '&t=' + Math.floor(at == null ? x.s : at) + 's&ls=' + x.s + '&le=' + x.e + '&ln=' + encodeURIComponent(x.n)
    + (x.li ? '&li=' + x.li + (x.lo ? '&lo=' + x.lo : '') + (x.tt && x.tt.length ? '&tt=' + x.tt.join('.') : '') : '');
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- featured on the welcome screen (links and times only; everything plays on YouTube) ----------
  const FEATURED = {
    name: 'Ginjo Saine', mark: '🎈',
    v: 'GVjhhSSSbLs', title: '【#銀城サイネ3D】おまたせ...！見ててくだサイネ。【ぶいすぽっ！/銀城サイネ 】',
    songs: [
      { n: '♪ The Beginning / ONE OK ROCK', s: 87, e: 380, li: 33383217 },
      { n: '♪ 生きる / 水野あつ feat. 可不', s: 1501.3, e: 1642.4, li: 23770907,
        tt: [36, 70, 109, 156, 293, 334, 376, 421, 459, 499, 543, 586, 679, 695, 724, 766, 798, 845, 884, 928, 971, 1014, 1057, 1100, 1146, 1278, 1321] }
    ]
  };

  // ---------- sharing and backup ----------
  const b64u = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const packLink = async obj => {
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const buf = await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return 'z' + b64u(new Uint8Array(buf));
  };
  const unpackLink = async str => {
    if (!str || str[0] !== 'z') throw new Error('unknown format');
    const buf = await new Response(new Blob([unb64u(str.slice(1))]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  };
  // a song as shared: [video, start, end, name, lrclib id, lyrics offset, tapped timings, stream title]
  const songOut = x => [x.v, x.s, x.e, x.n, x.li || 0, x.lo || 0, x.tt || 0, x.t || ''];
  const songIn = a => {
    if (!Array.isArray(a)) return null;
    const [v, s, e, n, li, lo, tt, t] = a;
    if (!/^[\w-]{11}$/.test(v) || !(typeof s === 'number' && typeof e === 'number' && e > s && s >= 0 && e < 360000)) return null;
    const x = { v, s: r1(s), e: r1(e), n: String(n || 'Song').slice(0, 200), t: String(t || '').slice(0, 200) };
    if (Number.isInteger(li) && li > 0) x.li = li;
    if (typeof lo === 'number' && Math.abs(lo) < 600) x.lo = r1(lo);
    if (Array.isArray(tt) && tt.length && tt.length < 1000 && tt.every(n2 => Number.isInteger(n2) && n2 >= 0)) x.tt = tt;
    return x;
  };
  // add songs (skipping ones already saved) and an optional playlist; returns { added, skipped, playlist }
  const importItems = async (songs, lists) => {
    let added = 0, skipped = 0; const keyOf = [];
    for (const x of songs) {
      if (!x) { keyOf.push(null); continue; }
      const have = findSong(x.v, x.s, x.e);
      if (have) { skipped++; keyOf.push(have.k); if (x.li && !have.li && !LY[have.k]) { have.li = x.li; have.lo = x.lo; if (x.tt) have.tt = x.tt; await put(have); } continue; }
      const y = { k: uid('s_'), ...x }; S[y.k] = y;
      try { await sync.set({ [y.k]: strip(y) }); } catch (err) { delete S[y.k]; throw new Error('Edge\'s sync storage is full after ' + added + ' new songs. Delete some songs and try again.'); }
      added++; keyOf.push(y.k);
    }
    const made = [];
    for (const l of lists || []) {
      const list = (l.list || []).map(i => keyOf[i]).filter(Boolean);
      if (!list.length) continue;
      let name = String(l.n || 'Shared playlist').slice(0, 100);
      if (PL.some(p2 => p2.n === name)) name += ' (shared)';
      const pl = await addPlaylist(name);
      pl.list = [...new Set(list)]; pl.sh = !!l.sh; pl.r = [1, 2, 3].includes(l.r) ? l.r : 1; pl.g = [0, 2, 5].includes(l.g) ? l.g : 0;
      await put(pl); made.push(pl);
    }
    return { added, skipped, made };
  };
  const shareLink = async p => {
    const songs = p.list.map(k => S[k]).filter(Boolean);
    const z = await packLink({ n: p.n, s: songs.map(songOut), sh: p.sh ? 1 : 0, r: p.r, g: p.g });
    const first = songs[0];
    return location.origin + '/watch?v=' + first.v + '&t=' + Math.floor(first.s) + 's&swpl=' + z;
  };
  const exportAll = () => {
    const songs = Object.values(S), idx = {};
    songs.forEach((x, i) => { idx[x.k] = i; });
    const data = { app: 'Saine Wave', format: 1, exported: new Date().toISOString(), songs: songs.map(songOut),
      playlists: PL.map(p2 => ({ n: p2.n, list: p2.list.map(k => idx[k]).filter(i => i != null), sh: p2.sh ? 1 : 0, r: p2.r, g: p2.g })) };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'saine-wave-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    say('Exported ' + songs.length + ' songs and ' + PL.length + ' playlists.');
  };
  const importFile = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (err) { say('That file isn\'t a Saine Wave backup.'); return; }
      if (!data || data.app !== 'Saine Wave' || !Array.isArray(data.songs)) { say('That file isn\'t a Saine Wave backup.'); return; }
      const songs = data.songs.map(songIn), lists = Array.isArray(data.playlists) ? data.playlists : [];
      const n = songs.filter(Boolean).length;
      if (!confirm('Import ' + n + ' song' + (n === 1 ? '' : 's') + ' and ' + lists.length + ' playlist' + (lists.length === 1 ? '' : 's') + ' from ' + f.name + '? Songs you already have are skipped.')) return;
      try {
        const r = await importItems(songs, lists);
        say('Imported ' + r.added + ' new song' + (r.added === 1 ? '' : 's') + (r.skipped ? ' (' + r.skipped + ' already saved)' : '') + ' and ' + r.made.length + ' playlist' + (r.made.length === 1 ? '' : 's') + '.');
      } catch (err) { say(err.message); }
      draw();
    };
    inp.click();
  };

  // ---------- data (synced) ----------
  // songs:     s_<id> -> { v, n, s, e, t }      t = stream title
  // playlists: p_<id> -> { n, list:[song keys], sh, r, g, o }
  let S = {}, PL = [];
  let ui = { x: null, y: 70, min: false, tab: 'songs', pl: null, ov: 'bottom', xl: 'next', rp: 'all' };

  const load = async () => {
    const all = await sync.get(null);
    S = {}; PL = [];
    for (const k in all) {
      if (k.startsWith('s_')) S[k] = { k, ...all[k] };
      else if (k.startsWith('p_')) PL.push({ k, list: [], ...all[k] });
    }
    PL.sort((a, b) => a.o - b.o);
  };
  const strip = x => { const { k, ...d } = x; return d; };
  const timers = {};
  const put = (x, delay = 0) => {            // delay > 0 batches quick repeated edits
    clearTimeout(timers[x.k]);
    const write = () => sync.set({ [x.k]: strip(x) }).catch(err => say('Could not save: ' + err.message));
    if (delay) timers[x.k] = setTimeout(write, delay); else return write();
  };
  const findSong = (v, s, e) => Object.values(S).find(x => x.v === v && Math.abs(x.s - s) < 1 && Math.abs(x.e - e) < 1);
  const addSong = async (v, n, s, e, t) => { const x = { k: uid('s_'), v, n, s: r1(s), e: r1(e), t: t || '' }; S[x.k] = x; await put(x); return x; };
  const addPlaylist = async n => {
    const p = { k: uid('p_'), n, list: [], sh: false, r: 1, g: 0, o: PL.length ? Math.max(...PL.map(y => y.o)) + 1 : 1 };
    PL.push(p); await put(p); return p;
  };
  // ---------- background frames (image kept on this computer, timestamp synced) ----------
  const IMG = {};                                   // song key -> data URL
  const loadImgs = async () => { try { const all = await local.get(null); for (const k in all) if (k.startsWith('img_')) IMG[k.slice(4)] = all[k]; } catch (err) {} };
  const grabFrame = () => {
    const v = V(); if (!v || !v.videoWidth) return null;
    try {
      const c = document.createElement('canvas'); c.width = 480; c.height = Math.round(480 * v.videoHeight / v.videoWidth);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.78);
      return url && url.length > 2000 ? url : null;
    } catch (err) { return null; }
  };
  const saveImg = async (x, url) => { IMG[x.k] = url; bgFor = null; try { await local.set({ ['img_' + x.k]: url }); } catch (err) {} };
  const dropImg = async x => { delete IMG[x.k]; bgFor = null; try { await local.remove('img_' + x.k); } catch (err) {} };

  // ---------- lyrics ----------
  // Synced with the song: li = LRCLIB id, lt = matched title, lo = timing offset (s), lw = own lyrics on some computer.
  // Kept on this computer: lyr_<song key> -> { src: 'lrclib'|'own', id, raw }
  const LY = {}, PARSED = {};
  const loadLyrics = async () => { try { const all = await local.get(null); for (const k in all) if (k.startsWith('lyr_')) LY[k.slice(4)] = all[k]; } catch (err) {} };
  const parseLyrics = raw => {
    raw = String(raw || '');
    if (/-->/.test(raw)) {                                  // .srt subtitles
      const lines = [];
      for (const block of raw.split(/\r?\n\s*\r?\n/)) {
        const m = block.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->/);
        if (!m) continue;
        const text = block.split(/\r?\n/).filter(l => l && !/-->/.test(l) && !/^\d+$/.test(l.trim())).join(' ').trim();
        lines.push({ t: (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000, text });
      }
      return { synced: true, lines: lines.sort((a, b) => a.t - b.t) };
    }
    const timed = [], plain = [];
    for (const line of raw.split(/\r?\n/)) {
      const tags = [...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      if (tags.length) for (const g of tags) timed.push({ t: (+g[1]) * 60 + parseFloat(g[2].replace(':', '.')), text });
      else if (text && !/^\[[a-z]+:/i.test(line.trim())) plain.push({ t: null, text });
    }
    return timed.length ? { synced: true, lines: timed.sort((a, b) => a.t - b.t) } : { synced: false, lines: plain };
  };
  const tapTexts = raw => parseLyrics(raw).lines.map(l => l.text).filter(Boolean);
  const lyricsFor = x => {
    const e = x && LY[x.k]; if (!e) return null;
    const key = e.raw + '|' + (x.tt ? x.tt.join(',') : '');
    if (!PARSED[x.k] || PARSED[x.k].key !== key) {
      let res = parseLyrics(e.raw);
      if (Array.isArray(x.tt) && x.tt.length) {     // your own tapped timings win over any in the lyrics
        const texts = tapTexts(e.raw);
        res = { synced: true, tapped: true, lines: texts.map((text, i) => (x.tt[i] != null ? { t: x.tt[i] / 10, text } : null)).filter(Boolean) };
      }
      PARSED[x.k] = { key, raw: e.raw, ...res };
    }
    return PARSED[x.k].lines.length ? PARSED[x.k] : null;
  };
  const saveLyrics = async (x, entry) => { LY[x.k] = entry; try { await local.set({ ['lyr_' + x.k]: entry }); } catch (err) {} };
  const dropLyrics = async x => { delete LY[x.k]; delete PARSED[x.k]; delete TR[x.k]; delete OWN[x.k]; try { await local.remove(['lyr_' + x.k, 'tr_' + x.k, 'own_' + x.k]); } catch (err) {} };

  // ---------- romaji / English for the second line (kept on this computer) ----------
  const TR = {};                                   // song key -> { h, ro: [..], en: [..] }
  const hashOf = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36) + ':' + str.length; };
  const OWN = {};                                  // song key -> { ro: text, en: text } you pasted yourself (this computer)
  const loadTr = async () => { try { const all = await local.get(null); for (const k in all) { if (k.startsWith('tr_')) TR[k.slice(3)] = all[k]; if (k.startsWith('own_')) OWN[k.slice(4)] = all[k]; } } catch (err) {} };
  const ownLines = raw => String(raw || '').split(/\r?\n/).map(l => l.replace(/^\s*(\[[^\]]*\]\s*)+/, '').trim()).filter(Boolean);   // timings like [01:23.45] are dropped
  // match your own lines to the lyric lines that have text, in order
  const alignOwn = (L, raw) => { const mine = ownLines(raw); let i = 0; return L.lines.map(l => l.text ? (mine[i++] || '') : ''); };
  const saveOwn = async (x, field, raw) => {
    const o = { ...(OWN[x.k] || {}) }; if (raw && raw.trim()) o[field] = raw; else delete o[field];
    if (Object.keys(o).length) { OWN[x.k] = o; try { await local.set({ ['own_' + x.k]: o }); } catch (err) {} }
    else { delete OWN[x.k]; try { await local.remove('own_' + x.k); } catch (err) {} }
  };
  // your per-song romaji fixes, like shintai -> karada (whole words, any case)
  const applyFixes = (x, lines) => {
    const fx = (x.rf || []).filter(f => f && f[0]);
    if (!fx.length) return lines;
    return lines.map(t => fx.reduce((s, [a, b]) => s.replace(new RegExp('(^|[^a-z])' + a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z])', 'gi'), (m, p) => p + b), t || ''));
  };
  const working = new Set(), failed = {};
  const srcLang = lines => { const t = lines.map(l => l.text).join(''); return /[぀-ヿ]/.test(t) ? 'ja' : /[가-힯]/.test(t) ? 'ko' : /[一-鿿]/.test(t) ? 'zh' : null; };
  const extraFor = (x, mode) => {                  // the romaji/English lines for this song, or null while being prepared
    const L = lyricsFor(x); if (!L || !L.synced || mode === 'next') return null;
    const field = mode === 'romaji' ? 'ro' : 'en';
    if (OWN[x.k] && OWN[x.k][field]) return alignOwn(L, OWN[x.k][field]);    // your own romaji/English wins
    const h = hashOf(LY[x.k].raw + '|' + (x.tt ? x.tt.join(',') : '')), t = TR[x.k];
    // saved romaji/English made by an older version are made again (romaji v2: song readings like karada; English v2: with context)
    if (t && t.h === h && t[field] && (field === 'ro' ? t.rov === 2 : t.env === 2)) return field === 'ro' ? applyFixes(x, t[field]) : t[field];
    prepareExtra(x, mode, L, h);
    return null;
  };
  const prepareExtra = async (x, mode, L, h) => {
    const job = x.k + ':' + mode;
    if (working.has(job) || failed[job] === h) return;
    working.add(job);
    try {
      let out;
      if (mode === 'romaji') {
        if (!L.lines.some(l => window.__saineRomaji.isJapanese(l.text))) out = L.lines.map(() => '');
        else {
          say('Preparing romaji… (the first time takes a few seconds)');
          const tk = await window.__saineRomaji.getTokenizer();
          out = L.lines.map(l => window.__saineRomaji.lineToRomaji(tk, l.text));
        }
      } else {
        const src = srcLang(L.lines);
        if (!src) out = L.lines.map(() => '');            // already English (or another Latin-script language)
        else {
          if (typeof Translator === 'undefined') throw new Error('nosupport');
          const opts = { sourceLanguage: src, targetLanguage: 'en' };
          const av = await Translator.availability(opts);
          if (av === 'unavailable') throw new Error('nosupport');
          if (av !== 'available') say('Downloading Edge\'s translation model… (only needed once)');
          const tr = await Translator.create({ ...opts, monitor(m) { m.addEventListener('downloadprogress', e => say('Downloading Edge\'s translation model… ' + Math.round((e.loaded || 0) * 100) + '%')); } });
          say('Translating lyrics…');
          // translate in blocks of lines so the translator sees the context; if a block doesn't come back
          // with the same number of lines, translate that block line by line instead
          const memo = {}; out = L.lines.map(() => '');
          const idx = L.lines.map((l, i) => l.text ? i : -1).filter(i => i >= 0);
          for (let b = 0; b < idx.length; b += 16) {
            const part = idx.slice(b, b + 16), src = part.map(i => L.lines[i].text);
            let got = null;
            try { const r = await tr.translate(src.join('\n')); const lines = String(r).split(/\r?\n/).map(s => s.trim()); if (lines.length === src.length && lines.every(Boolean)) got = lines; } catch (err) {}
            if (!got) { got = []; for (const s of src) got.push(memo[s] = memo[s] || await tr.translate(s)); }
            part.forEach((i, j) => { out[i] = got[j]; });
          }
          try { tr.destroy && tr.destroy(); } catch (err) {}
        }
      }
      const t = TR[x.k] && TR[x.k].h === h ? TR[x.k] : { h };
      t[mode === 'romaji' ? 'ro' : 'en'] = out; if (mode === 'romaji') t.rov = 2; else t.env = 2; TR[x.k] = t;
      try { await local.set({ ['tr_' + x.k]: t }); } catch (err) {}
      say(mode === 'romaji' ? 'Romaji ready.' : 'English translation ready.');
      updateOverlay(true);
    } catch (err) {
      failed[job] = h;
      say(mode === 'romaji' ? 'Could not prepare romaji: ' + (err.message || err) :
        String(err.message) === 'nosupport' ? 'English translation needs Edge\'s built-in translator (Edge 148 or newer). Showing the original lyrics instead.' :
        'Could not translate: ' + (err.message || err));
    } finally { working.delete(job); }
  };
  const lrclib = path => new Promise(res => {
    try { chrome.runtime.sendMessage({ t: 'lrclib', path }, r => res(r || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message })); }
    catch (err) { res({ ok: false, error: String(err) }); }
  });
  const fetching = new Set();
  const ensureLyrics = async x => {                       // another computer picked LRCLIB lyrics: fetch them here too
    if (!x || !x.li || (LY[x.k] && LY[x.k].id === x.li) || fetching.has(x.k)) return;
    fetching.add(x.k);
    const r = await lrclib('/api/get/' + x.li);
    fetching.delete(x.k);
    if (r.ok && r.data && (r.data.syncedLyrics || r.data.plainLyrics)) { await saveLyrics(x, { src: 'lrclib', id: x.li, raw: r.data.syncedLyrics || r.data.plainLyrics }); if (isOpen()) draw(); }
  };
  const lyricsQuery = n => String(n).replace(/[♪♫★☆♡♥【】\[\]「」『』()（）]/g, ' ').replace(/\s*[\/／|｜]\s*/g, ' ').replace(/\s+/g, ' ').trim();

  const deleteSong = async x => {
    delete S[x.k]; dropImg(x); dropLyrics(x);
    const ch = PL.filter(p => p.list.includes(x.k));
    ch.forEach(p => { p.list = p.list.filter(k => k !== x.k); });
    await sync.remove(x.k);
    for (const p of ch) await put(p);
  };

  // Import songs saved by the old Loop song favorite, once per computer.
  const importOld = async () => {
    try {
      if (localStorage.getItem('loopSongsImported')) return 0;
      const found = [];
      for (const x of JSON.parse(localStorage.getItem('abloop2') || '[]')) if (x && x.vid) found.push({ v: x.vid, n: x.name || 'Song', s: x.s, e: x.e });
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('abloop:') === 0) { const r = JSON.parse(localStorage.getItem(k)); if (r) found.push({ v: k.slice(7), n: 'Saved song', s: r[0], e: r[1] }); }
      }
      const keys = [];
      for (const x of found) {
        if (!(x.e > x.s)) continue;
        const y = findSong(x.v, x.s, x.e) || await addSong(x.v, x.n, x.s, x.e, '');
        if (!keys.includes(y.k)) keys.push(y.k);
      }
      if (keys.length) { const p = await addPlaylist('My playlist'); p.list = keys; await put(p); ui.pl = p.k; }
      localStorage.setItem('loopSongsImported', '1');
      return keys.length;
    } catch (err) { return 0; }
  };

  // ---------- icons (Material Design paths) ----------
  const ICONS = {
    play: 'M8 5v14l11-7z', pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z', stop: 'M6 6h12v12H6z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z', prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    loop: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
    shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
    timer: 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0012 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
    plAdd: 'M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z',
    link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    down: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z', right: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    minus: 'M19 13H5v-2h14v2z', plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    shrink: 'M5 11h14v2H5z', expand: 'M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    movie: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    grip: 'M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    boxOff: 'M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
    boxOn: 'M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    boxPart: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z',
    up: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z', dn: 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z',
    queue: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
    note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
    markIn: 'M18.41 16.59L13.82 12l4.59-4.59L17 6l-6 6 6 6zM6 6h2v12H6z', markOut: 'M5.59 7.41L10.18 12l-4.59 4.59L7 18l6-6-6-6zM16 6h2v12h-2z',
    remove: 'M19 13H5v-2h14v2z',
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    file: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    subs: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z',
    translate: 'M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z',
    gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    loopOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
    image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
    restore: 'M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0013 21a9 9 0 000-18z'
  };
  const NS = 'http://www.w3.org/2000/svg';
  const icon = name => {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name]); s.append(p); return s;
  };
  const wave = () => {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('class', 'logo');
    const r = document.createElementNS(NS, 'rect'); r.setAttribute('width', '32'); r.setAttribute('height', '32'); r.setAttribute('rx', '8'); r.setAttribute('class', 'logo-bg');
    const defs = document.createElementNS(NS, 'defs'), g = document.createElementNS(NS, 'linearGradient');
    g.setAttribute('id', 'swg'); g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '1'); g.setAttribute('y2', '1');
    [['0', '#F2F4F8'], ['1', '#A6D8F0']].forEach(([o, c]) => { const st = document.createElementNS(NS, 'stop'); st.setAttribute('offset', o); st.setAttribute('stop-color', c); g.append(st); });
    defs.append(g); s.append(defs); r.setAttribute('fill', 'url(#swg)');
    const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', '25'); dot.setAttribute('cy', '8'); dot.setAttribute('r', '2'); dot.setAttribute('fill', '#F5C84C');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M5 16c2.2-6.5 4.4-6.5 6.6 0s4.4 6.5 6.6 0 4.4-6.5 6.6 0'); p.setAttribute('class', 'logo-wave');
    s.append(r, p, dot); return s;
  };

  // ---------- styles (inside a shadow root so YouTube's CSS can't interfere) ----------
  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box}
  .panel{position:fixed;isolation:isolate;z-index:2147483647;width:384px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;
    background:#1E1E24;color:#F2F4F8;border:1px solid #3a3842;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.55);
    font:14px/1.4 Roboto,"Segoe UI",Arial,sans-serif;overflow:hidden}
  .panel.hidden{display:none}
  svg{width:20px;height:20px;fill:currentColor;flex:none}
  button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:999px}
  button:focus-visible{outline:2px solid #A6D8F0;outline-offset:1px}
  .ib{width:34px;height:34px;color:#bdbac6}
  .ib:hover{background:#2e2d36;color:#fff}
  .ib.sm{width:28px;height:28px}.ib.sm svg{width:18px;height:18px}
  .ib.on{color:#A6D8F0}
  .ib.danger:hover{color:#F4A6C1;background:rgba(244,166,193,.14)}
  .head{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px;cursor:move;user-select:none;border-bottom:1px solid #2a2930}
  .logo{width:26px;height:26px;border-radius:7px;object-fit:cover;flex:none}.logo-wave{fill:none;stroke:#58535E;stroke-width:2.6;stroke-linecap:round}
  .brand{font-weight:600;font-size:15px;letter-spacing:.2px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tabs{display:flex;gap:4px;padding:10px 14px 0}
  .tab{flex:1;height:34px;border-radius:10px;color:#bdbac6;font-weight:500;font-size:13px}
  .tab:hover{background:#2b2a33;color:#fff}
  .tab.on{background:#58535E;color:#fff}
  .tab svg{width:18px;height:18px}
  .scroll{overflow:auto;padding:10px 14px 22px;flex:1 1 auto;min-height:0;overscroll-behavior:contain}
  .head,.now,.tabs,.status{flex:none}
  .now{margin:10px 14px 0;padding:12px;border-radius:12px;background:linear-gradient(135deg,#58535E 0%,#3d3a45 55%,#2b3440 100%);background-size:cover;background-position:center;min-height:118px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
  .now .ib svg,.now-title,.now-sub,.times{filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}
  .ambient{position:absolute;inset:-60px;background-size:cover;background-position:center;filter:blur(40px) saturate(1.2) brightness(.5);opacity:0;transition:opacity .5s,background-image .5s;pointer-events:none;z-index:0}
  .ambient.on{opacity:.5}
  .panel>:not(.ambient):not(.grip){position:relative;z-index:1}
  .now.hidden{display:none}
  .now-title{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .now-sub{font-size:12px;color:#cfcdd8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar{height:4px;border-radius:4px;background:rgba(255,255,255,.18);margin:10px 0 4px;overflow:hidden}
  .bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#F2F4F8,#F5C84C);border-radius:4px}
  .times{display:flex;justify-content:space-between;font-size:11px;color:#cfcdd8;font-variant-numeric:tabular-nums}
  .ctrls{display:flex;justify-content:center;align-items:center;gap:6px;margin-top:4px}
  .rpbtn{position:absolute;left:4px;bottom:5px}.rpbtn:not(.on){opacity:.5}
  .rpbtn[data-mode=off]::after{content:'';position:absolute;width:22px;height:2px;background:#F2F4F8;transform:rotate(-45deg);border-radius:2px}
  .ovbtn{position:absolute;right:4px;bottom:5px}.xlbtn{position:absolute;right:40px;bottom:5px}.ctrls{position:relative}
  .xlbtn:not(.on){opacity:.55}
  .xlbtn[data-mode=romaji]::after,.xlbtn[data-mode=english]::after{position:absolute;bottom:1px;right:1px;font-size:9px;font-weight:700;color:#F5C84C}
  .xlbtn[data-mode=romaji]::after{content:'R'}.xlbtn[data-mode=english]::after{content:'EN'}
  .ovbtn:not(.on){opacity:.55}
  .ovbtn[data-mode=top]::after{content:'';position:absolute;top:6px;left:50%;width:10px;height:2px;margin-left:-5px;border-radius:2px;background:#F5C84C}
  .ctrls .ib{color:#fff}.ctrls .ib:hover{background:rgba(255,255,255,.12)}
  .big{width:44px;height:44px;background:#fff;color:#1E1E24!important}.big:hover{background:#ffffff!important}
  .big svg{width:24px;height:24px}
  .status{margin:8px 14px 0;font-size:12.5px;color:#A6D8F0;min-height:17px}
  .undo{height:24px;padding:0 10px;margin-left:4px;border-radius:999px;background:#A6D8F0;color:#1E1E24;font-size:12px;font-weight:600}
  .undo:hover{background:#F2F4F8}
  .status:empty{display:none}
  .marks{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .pill:disabled{opacity:.45;cursor:default}
  .newbtn{width:100%;height:38px;border-radius:12px;border:1px dashed #4a4752;color:#d1cfd9;font-size:13px;font-weight:500}
  .newbtn:hover{background:#25242c;border-color:#A6D8F0;color:#fff}
  .newsong{border:1px solid #36343e;border-radius:12px;padding:10px 12px 12px;background:rgba(27,30,37,.85)}
  .nshead{display:flex;align-items:center;margin-bottom:6px}
  .nshead .grow{flex:1}
  .nsstep{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:#d1cfd9;margin:4px 0}
  .nsstep.done{color:#A6D8F0}
  .nsnum{flex:none;width:18px;height:18px;border-radius:50%;background:#58535E;color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center}
  .nsstep.done .nsnum{background:#A6D8F0;color:#1E1E24}
  .newsong .marks{margin-top:10px}
  .nsfoot{font-size:11.5px;color:#8c8996;margin-top:8px}
  .nsnow{color:#F2F4F8;font-variant-numeric:tabular-nums}
  .tbox .ib.sm{width:26px;height:26px}
  .timesrow{display:flex;align-items:center;gap:8px;margin:2px 0 8px}
  .tsum{flex:1;font-size:13px;color:#bdbac6;font-variant-numeric:tabular-nums}
  .tsum b{color:#F2F4F8;font-weight:600}
  .editbox{border:1px dashed #58535E;border-radius:12px;padding:8px;margin:2px 0 8px;background:rgba(88,83,94,.15)}
  .edhint{font-size:11.5px;color:#a19eab;margin:0 2px 6px}
  .tbox.changed{box-shadow:inset 0 0 0 1px #F5C84C}
  .tbox.changed .tlabel b{color:#F5C84C}
  .was{display:block;font-size:10.5px;color:#8c8996}
  .saverow{margin-top:6px;align-items:center}.saverow .grow{flex:1}
  .act.primary{background:#F2F4F8;color:#1E1E24;font-weight:600}
  .act.primary:hover{background:#fff}
  .act:disabled{opacity:.4;cursor:default}
  .pill{height:40px;border-radius:12px;background:#2a2931;color:#F2F4F8;font-weight:500;font-size:13px;padding:0 12px}
  .pill:hover{background:#34323c}
  .pill.primary{background:#F2F4F8;color:#1E1E24}.pill.primary:hover{background:#ffffff}
  .pill.armed{background:#F4A6C1;color:#1E1E24}
  .hint{font-size:11.5px;color:#8c8996;margin:8px 2px 4px;display:flex;gap:10px;flex-wrap:wrap}
  kbd{font:11px/1 ui-monospace,Consolas,monospace;background:#2e2d36;border:1px solid #3e3c47;border-bottom-width:2px;border-radius:5px;padding:2px 5px;color:#dcdae3}
  .group{margin-top:12px}
  .ghead{display:flex;align-items:center;gap:4px;padding:4px 0;border-top:1px solid #2a2930;padding-top:10px}
  .gtitle{flex:1;min-width:0;font-size:12.5px;font-weight:600;color:#dcdae3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
  .badge{font-size:11px;color:#aaa7b4;background:#2a2930;border-radius:999px;padding:1px 7px;margin-left:6px;font-weight:500}
  .here{color:#F5C84C;font-weight:600;font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;margin-right:6px}
  .song{border-radius:12px;margin-top:6px;background:rgba(27,30,37,.78);border:1px solid transparent}
  .song:hover{background:rgba(32,36,44,.9)}
  .song.playing{border-color:#A6D8F0;background:rgba(58,62,74,.85)}
  .row{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 8px}
  .playbtn{width:34px;height:34px;background:#3e3c47;color:#F2F4F8}.playbtn:hover{background:#58535E}
  .song.playing .playbtn{background:#A6D8F0;color:#1E1E24}
  .meta{flex:1;min-width:0}
  .name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sub{font-size:12px;color:#a19eab;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tools{padding:2px 10px 10px;display:none}
  .quick{align-items:center;margin-bottom:2px}
  .quick .grow{flex:1}
  .act.on{background:#58535E;color:#A6D8F0}
  .fold{margin-top:6px;border-radius:10px;background:rgba(21,23,28,.7)}
  .foldhead{width:100%;justify-content:flex-start;gap:8px;padding:8px 10px;border-radius:10px;color:#dcdae3;font-size:13px}
  .foldhead:hover{background:#2b2a33}
  .foldhead svg{width:17px;height:17px;color:#a19eab}
  .ftitle{font-weight:500}
  .fsum{flex:1;min-width:0;text-align:right;color:#8c8996;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fold.open .foldhead{border-bottom-left-radius:0;border-bottom-right-radius:0}
  .foldbody{padding:2px 10px 10px}
  .foldbody .lyrsec{margin:0;padding:0;border:0}
  .grip{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;z-index:3;border-bottom-right-radius:16px;
    background:linear-gradient(135deg,transparent 0 55%,#5a5763 55% 60%,transparent 60% 70%,#5a5763 70% 75%,transparent 75%)}
  .grip:hover{background-color:rgba(255,255,255,.06)}
  .mini .grip{display:none}
  .set{padding:10px 0;border-bottom:1px solid #2a2930}
  .set:last-of-type{border-bottom:0}
  .sethead{font-weight:600;font-size:13px;margin-bottom:8px}
  .setnote{font-size:12px;color:#8c8996;margin-top:6px}
  .setnote.ver{margin-top:12px;text-align:center}
  .seg{display:flex;gap:4px;background:#25242c;border-radius:12px;padding:4px;flex-wrap:wrap}
  .seg .segbtn{min-width:64px}
  .lmlabel{font-size:12px;color:#bdbac6;margin:8px 2px 4px}
  .lyrmenu{margin-top:6px;padding:4px 8px 8px;border-radius:12px;background:rgba(30,30,36,.92)}
  .lyrmenu.hidden{display:none}
  .lyrmenu .segbtn{height:30px;font-size:12px}
  .segbtn{flex:1;height:34px;border-radius:9px;color:#bdbac6;font-size:13px}
  .segbtn:hover{background:#2e2d36;color:#fff}
  .segbtn.on{background:#58535E;color:#fff}
  .segbtn svg{width:15px;height:15px}
  .keys{display:grid;gap:6px}
  .welcome{padding:4px 2px}
  .wtitle{font-size:18px;font-weight:700;margin-top:2px}
  .wsub{font-size:13px;color:#a19eab;margin:4px 0 12px}
  .wsteps{margin:0 0 14px;padding:0;list-style:none;counter-reset:w;display:grid;gap:8px}
  .wsteps li{counter-increment:w;display:grid;grid-template-columns:24px 1fr;column-gap:10px;font-size:13px}
  .wsteps li::before{content:counter(w);grid-row:span 2;width:24px;height:24px;border-radius:50%;background:#58535E;color:#F2F4F8;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center}
  .wsteps b{font-weight:600}.wsteps span{color:#8c8996;font-size:12px}
  .feat{display:flex;gap:12px;padding:10px;border-radius:14px;background:linear-gradient(135deg,rgba(88,83,94,.55),rgba(166,216,240,.12));border:1px solid #3a3842}
  .fthumb{flex:none;width:112px;aspect-ratio:16/9;border-radius:9px;background:#2a2931 center/cover no-repeat}
  .finfo{min-width:0}
  .fkicker{font-size:12px;font-weight:700;color:#F5C84C}
  .ftitle2{font-size:12.5px;line-height:1.35;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .fmeta{font-size:11.5px;color:#a19eab;margin-top:4px}
  .fbtns{display:grid;gap:6px;margin-top:10px}
  .fbtns .act{justify-content:center;height:34px}
  .wskip{width:100%;height:32px;margin-top:8px;color:#8c8996;font-size:12.5px}
  .wskip:hover{color:#F2F4F8}
  .welcomeagain{margin-top:12px;justify-content:center}
  .incoming{border:1px solid #A6D8F0;border-radius:12px;padding:10px 12px 12px;margin-bottom:10px;background:rgba(166,216,240,.08)}
  .incoming .nshead{gap:8px}.incoming .nshead svg{width:18px;height:18px;color:#A6D8F0}
  .inname{font-size:13px;font-weight:600;margin:2px 0 6px}
  .inlist{font-size:12px;color:#bdbac6;display:grid;gap:2px;margin-bottom:10px}
  .inlist div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .inmore{color:#8c8996}
  .incoming .playall{height:36px;font-size:13px}
  .krow{display:flex;align-items:center;gap:10px;font-size:12.5px;color:#d1cfd9}
  .krow kbd{min-width:76px;text-align:center}
  .ib.on{color:#A6D8F0}
  .song.open .tools{display:block}
  .tune{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:4px 0 8px}
  .tbox{background:#1E1E24;border-radius:10px;padding:6px 6px 6px 10px;display:flex;align-items:center;gap:2px}
  .tlabel{flex:1;font-size:11px;color:#a19eab;line-height:1.2}
  .tlabel b{display:block;font-size:13px;color:#F2F4F8;font-weight:500;font-variant-numeric:tabular-nums}
  .acts{display:flex;gap:2px;flex-wrap:wrap}
  .bgrow{display:flex;align-items:center;gap:10px;margin:2px 0 6px}
  .lyrsec{margin:10px 0 4px;padding-top:8px;border-top:1px solid #2a2930}
  .lyrsec .acts{margin-top:4px}
  .lyrtime{margin-top:6px}
  .ctrls.hidden,.syncbar.hidden{display:none}
  .syncbar{margin-top:8px}
  .synccount{font-size:12px;color:#cfcdd8}
  .syncnext{font-size:14px;font-weight:600;margin:4px 0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .syncbtns{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .tap{height:40px;padding:0 18px;border-radius:12px;background:#F2F4F8;color:#1E1E24;font-weight:600}
  .tap:hover{background:#ffffff}
  .syncbtns .act{background:rgba(255,255,255,.12);color:#fff}
  .lyrtime .act{margin-left:4px}
  .results{display:flex;flex-direction:column;gap:4px;margin-top:6px}
  .result{display:block;text-align:left;border-radius:10px;padding:7px 10px;background:#1E1E24;color:#F2F4F8;width:100%}
  .result:hover{background:#2e2d36}
  .result b{display:block;font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .result span{display:block;font-size:11.5px;color:#a19eab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .results .act{align-self:flex-start}
  .paste{width:100%;min-height:120px;margin-top:6px;border-radius:10px;border:1px solid #36343e;background:#1E1E24;color:#F2F4F8;font:12.5px/1.45 inherit;font-family:inherit;padding:8px 10px;resize:vertical}

  .bgprev{width:72px;height:40px;border-radius:8px;background:#2a2931 center/cover no-repeat;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
  .bgtext{font-size:12px;color:#a19eab;line-height:1.3;min-width:0}
  .bgtext b{display:block;font-size:12px;color:#dcdae3;font-weight:500}
  .acts+.acts{margin-top:4px}
  .act{height:30px;padding:0 10px;border-radius:999px;font-size:12px;color:#d1cfd9;background:#2e2d36}
  .act:hover{background:#383641;color:#fff}.act svg{width:16px;height:16px}
  .act.danger:hover{background:rgba(244,166,193,.14);color:#F4A6C1}
  .picker{margin-top:8px;padding:8px;border-radius:10px;background:#1E1E24}
  .pkrow.part{color:#A6D8F0}
  .searchbox{display:flex;align-items:center;gap:6px;height:36px;margin:8px 0 2px;padding:0 4px 0 10px;border-radius:10px;background:#25242c;border:1px solid #3a3842}
  .searchbox:focus-within{border-color:#A6D8F0}
  .sic svg{width:18px;height:18px;fill:#8e8b98;display:block}
  .sinput{flex:1;min-width:0;height:100%;border:0;background:transparent;color:#F2F4F8;font:inherit;font-size:13px;outline:none}
  .nstimes{display:flex;align-items:center;gap:8px;margin:8px 0}
  .nstime{display:flex;flex-direction:column;min-width:64px;padding:6px 10px;border-radius:10px;background:#25242c}
  .nstime .nslab{font-size:11px;color:#8e8b98}.nstime b{font-size:16px;color:#8e8b98;font-variant-numeric:tabular-nums}.nstime.set b{color:#F2F4F8}
  .nslen{font-size:12px;color:#A6D8F0;margin-left:auto}
  .marks .pill.full{grid-column:1 / -1}.pill.wide{width:100%;margin-top:8px;justify-content:center}
  .ownsec{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
  .fixes{margin-top:6px}.fixrow{display:flex;align-items:center;gap:6px;margin-top:4px}
  .fixword{font-size:13px;color:#F2F4F8;background:#25242c;border-radius:6px;padding:3px 8px}.fixarrow{color:#8e8b98}
  .fixin{width:88px;height:28px;box-sizing:border-box;padding:0 8px;border-radius:8px;border:1px solid #3a3842;background:#25242c;color:#F2F4F8;font:inherit;font-size:13px}
  .fixin:focus{outline:2px solid #A6D8F0;outline-offset:-1px}
  .pllist{display:flex;flex-direction:column}
  .draghandle{cursor:grab;touch-action:none;color:#bdbac6;flex:none;width:28px;margin-right:-4px}.draghandle:active{cursor:grabbing}
  .pllist.sorting{user-select:none}.pllist.sorting .song:not(.dragging){transition:transform .12s}
  .song.dragging{opacity:.95;outline:2px solid #A6D8F0;background:#2e3440;box-shadow:0 8px 20px rgba(0,0,0,.45);position:relative;z-index:3}
  .rmx{flex:none;background:#3a2a32;color:#F4A6C1}.rmx svg{fill:#F4A6C1}.rmx:hover{background:#4a3340}
  .allbar{display:flex;align-items:center;gap:6px;margin:8px 0 2px;flex-wrap:wrap}
  .selhint{font-size:12px;color:#bdbac6;padding-left:2px}
  .song.sel .row{gap:8px}.song.chosen{background:#2e3440;outline:1px solid rgba(166,216,240,.45)}
  .selbox svg{fill:#A6D8F0}
  .selbar{position:sticky;bottom:0;z-index:2;margin-top:8px;padding:8px;border-radius:12px;background:rgba(30,30,36,.97);box-shadow:0 -6px 16px rgba(0,0,0,.35)}
  .selbar .picker{margin:0 0 8px}
  .selrow{display:flex;align-items:center;gap:6px}.selcount{font-size:13px;color:#F2F4F8}
  .pksearch{width:100%;box-sizing:border-box;height:32px;margin:6px 0;padding:0 10px;border-radius:8px;border:1px solid #3a3842;background:#25242c;color:#F2F4F8;font:inherit;font-size:13px}
  .pksearch:focus{outline:2px solid #A6D8F0;outline-offset:-1px}
  .pklist{max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;overscroll-behavior:contain}
  .pkhead{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8e8b98;margin:6px 4px 2px}
  .pkrow{display:flex;align-items:center;gap:8px;min-height:34px;padding:0 8px;border-radius:8px;background:transparent;color:#dcdae3;font-size:13px;text-align:left;width:100%;flex:none}
  .pkrow:hover{background:#2e2d36}.pkrow.on{color:#F5C84C}
  .pkmark{width:18px;height:18px;display:flex;align-items:center;justify-content:center;flex:none}.pkmark svg{width:16px;height:16px}
  .pkname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pkcount{font-size:12px;color:#8e8b98;font-variant-numeric:tabular-nums}
  .pknew{color:#A6D8F0}
  .pkempty{font-size:12px;color:#8e8b98;padding:6px 4px}
  .chip{height:30px;padding:0 12px;border-radius:999px;background:#2e2d36;color:#dcdae3;font-size:12px}
  .chip:hover{background:#383641}.chip.on{background:#58535E;color:#F5C84C}
  .chip svg{width:16px;height:16px}
  .clabel{width:100%;font-size:11px;color:#8c8996}
  .empty{color:#8c8996;text-align:center;padding:26px 10px;font-size:13px}
  .empty svg{width:36px;height:36px;display:block;margin:0 auto 8px;color:#4d4a56}
  .plhead{display:flex;gap:6px;align-items:center}
  select{flex:1;min-width:0;height:36px;border-radius:10px;background:#2a2931;color:#F2F4F8;border:1px solid #36343e;padding:0 10px;font:inherit;font-size:13px}
  .opts{display:flex;gap:6px;margin:10px 0;flex-wrap:wrap}
  .opts .grow{flex:1}
  .playall{width:100%;height:40px;border-radius:12px;background:#F2F4F8;color:#1E1E24;font-weight:600}
  .playall:hover{background:#ffffff}
  .num{width:22px;text-align:center;font-size:12px;color:#8c8996;font-variant-numeric:tabular-nums}
  .mini .tabs,.mini .scroll,.mini .status{display:none}
  .compact .now{min-height:0;padding:8px 10px;margin-top:8px}
  .compact .now-sub,.compact .times{display:none}
  .compact .bar{margin:6px 0 2px}
  .compact .ctrls{margin-top:2px}
  .compact .ctrls .ib{width:30px;height:30px}
  .compact .big{width:36px;height:36px}
  .compact .tabs{padding-top:8px}
  .compact .tab{height:30px}
  .compact .head{padding-top:6px;padding-bottom:6px}
  .mini .now{margin:0;border-radius:0}
  .mini .bar{margin-top:6px}
  .scroll::-webkit-scrollbar{width:8px}.scroll::-webkit-scrollbar-thumb{background:#36343e;border-radius:8px}
  .pklist::-webkit-scrollbar{width:6px}.pklist::-webkit-scrollbar-track{background:transparent}.pklist::-webkit-scrollbar-thumb{background:#4a4752;border-radius:6px}.pklist::-webkit-scrollbar-button{display:none;height:0}`;

  // ---------- UI building blocks ----------
  const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const ibtn = (name, label, fn, cls) => {
    const b = el('button', 'ib ' + (cls || '')); b.append(icon(name)); b.title = label; b.setAttribute('aria-label', label);
    b.onclick = ev => { ev.stopPropagation(); fn(); }; return b;
  };
  const tbtn = (cls, name, label, fn) => {
    const b = el('button', cls); if (name) b.append(icon(name)); b.append(label); b.setAttribute('aria-label', label);
    b.onclick = ev => { ev.stopPropagation(); fn(); }; return b;
  };

  const host = el('div'); host.id = 'saine-wave';
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style'); style.textContent = CSS;
  const panel = el('div', 'panel hidden'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Saine Wave');
  root.append(style, panel);
  host.addEventListener('keydown', ev => ev.stopPropagation());
  document.body.append(host);

  // header
  const head = el('div', 'head');
  const brand = el('div', 'brand', 'Saine Wave');
  const minBtn = ibtn('shrink', 'Shrink', () => { ui.min = !ui.min; saveUi(); draw(); });
  const logo = el('img', 'logo'); logo.src = chrome.runtime.getURL('icon48.png'); logo.alt = '';
  const gearBtn = ibtn('gear', 'Settings', () => { ui.tab = ui.tab === 'settings' ? (ui.lastTab || 'songs') : (ui.lastTab = ui.tab, 'settings'); ui.min = false; saveUi(); draw(); });
  head.append(logo, brand, gearBtn, minBtn, ibtn('close', 'Close', () => toggle(false)));
  // tabs
  const tabs = el('div', 'tabs');
  const tabSongs = tbtn('tab', 'note', 'Songs', () => { ui.tab = ui.lastTab = 'songs'; say(''); saveUi(); draw(); });
  const tabPl = tbtn('tab', 'queue', 'Playlists', () => { ui.tab = ui.lastTab = 'pl'; say(''); plEdit = false; saveUi(); draw(); });
  tabs.append(tabSongs, tabPl);
  // now playing
  const now = el('div', 'now hidden');
  const nowTitle = el('div', 'now-title'), nowSub = el('div', 'now-sub');
  const bar = el('div', 'bar'), barFill = el('i'); bar.append(barFill);
  const times = el('div', 'times'), tA = el('span'), tB = el('span'); times.append(tA, tB);
  const prevBtn = ibtn('prev', 'Previous song', () => prevSong());
  const awayFromSong = () => { const x = P && cur(); return !!x && x.v !== vidNow(); };
  const ppBtn = ibtn('pause', 'Pause', () => {
    if (awayFromSong()) {                         // left the stream (e.g. went to the home page): go back and continue
      const x = cur(); if (P.at && P.at.k === x.k) P.resume = P.at;
      start(); return;
    }
    const v = V(); if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); setTimeout(syncPP, 50);
  }, 'big');
  const nextBtn = ibtn('next', 'Next song', () => nextSong(true));
  const stopBtn = ibtn('stop', 'Stop', () => stop('Stopped.'));
  const OV_LABEL = { bottom: 'Lyrics on video: bottom', top: 'Lyrics on video: top', off: 'Lyrics on video: off' };
  const ovBtn = ibtn('subs', OV_LABEL.bottom, () => {
    ui.ov = { bottom: 'top', top: 'off', off: 'bottom' }[ui.ov || 'bottom']; saveUi(); syncOvBtn(); updateOverlay(true);
    say(OV_LABEL[ui.ov] + '.');
  }, 'ovbtn');
  const syncOvBtn = () => { const m = ui.ov || 'bottom'; ovBtn.title = OV_LABEL[m]; ovBtn.setAttribute('aria-label', OV_LABEL[m]); ovBtn.classList.toggle('on', m !== 'off'); ovBtn.dataset.mode = m; };
  // which lyric goes on the big line and which on the small line under it (all songs)
  const LM_OPTS = [['orig', 'Original'], ['romaji', 'Romaji'], ['english', 'English']];
  const L2_OPTS = [['none', 'None'], ['next', 'Next lyric'], ['orig', 'Original'], ['romaji', 'Romaji'], ['english', 'English']];
  const lyrName = v => (L2_OPTS.find(o => o[0] === v) || ['', v])[1];
  const lyrMain = () => LM_OPTS.some(o => o[0] === ui.lm) ? ui.lm : 'orig';
  const lyrSecond = () => { const v = L2_OPTS.some(o => o[0] === ui.xl) ? ui.xl : 'next'; return v === lyrMain() ? 'none' : v; };
  const setLyr = (which, v) => {
    if (which === 'main') { ui.lm = v; if ((ui.xl || 'next') === v) ui.xl = v === 'orig' ? 'next' : 'orig'; }
    else ui.xl = v;
    saveUi();
    const x = cur(); if (x) { delete failed[x.k + ':romaji']; delete failed[x.k + ':english']; }
    say('Lyrics: ' + lyrName(lyrMain()) + (lyrSecond() === 'none' ? ' only.' : ', then ' + lyrName(lyrSecond()).toLowerCase() + ' underneath.'));
    updateOverlay(true); draw();
  };
  const choice = (cur, opts, set) => { const r = el('div', 'seg'); opts.forEach(([v, label]) => r.append(tbtn('segbtn' + (cur === v ? ' on' : ''), cur === v ? 'check' : null, label, () => set(v)))); return r; };
  let lyrMenuOpen = false;
  const lyrMenu = el('div', 'lyrmenu hidden');
  const fillLyrMenu = () => {
    lyrMenu.textContent = ''; lyrMenu.classList.toggle('hidden', !lyrMenuOpen); if (!lyrMenuOpen) return;
    lyrMenu.append(el('div', 'lmlabel', 'Main line'), choice(lyrMain(), LM_OPTS, v => setLyr('main', v)),
      el('div', 'lmlabel', 'Second line'), choice(lyrSecond(), L2_OPTS.filter(o => o[0] !== lyrMain()), v => setLyr('second', v)));
  };
  const xlBtn = ibtn('translate', 'Lyrics lines', () => { lyrMenuOpen = !lyrMenuOpen; syncXlBtn(); fillLyrMenu(); }, 'xlbtn');
  const syncXlBtn = () => {
    const t = 'Lyrics lines: ' + lyrName(lyrMain()) + ' + ' + lyrName(lyrSecond()).toLowerCase();
    xlBtn.title = t; xlBtn.setAttribute('aria-label', t); xlBtn.setAttribute('aria-expanded', String(lyrMenuOpen));
    xlBtn.classList.toggle('on', lyrMenuOpen || lyrMain() !== 'orig' || lyrSecond() !== 'next');
  };
  const RP_LABEL = { all: 'Repeat: all', one: 'Repeat: one song', off: 'Repeat: off' };
  const setRepeat = m => { ui.rp = m; saveUi(); say(RP_LABEL[m] + '.'); draw(); };
  const rpBtn = ibtn('loop', RP_LABEL.all, () => setRepeat({ all: 'one', one: 'off', off: 'all' }[ui.rp || 'all']), 'rpbtn');
  const syncRpBtn = () => { const m = ui.rp || 'all'; setIcon(rpBtn, m === 'one' ? 'loopOne' : 'loop', RP_LABEL[m]); rpBtn.classList.toggle('on', m !== 'off'); rpBtn.dataset.mode = m; };
  const ctrls = el('div', 'ctrls'); ctrls.append(rpBtn, prevBtn, ppBtn, nextBtn, stopBtn, xlBtn, ovBtn);
  const syncBar = el('div', 'syncbar hidden');
  const syncCount = el('div', 'synccount');
  const syncNextEl = el('div', 'syncnext');
  const syncBtns = el('div', 'syncbtns');
  syncBtns.append(
    tbtn('tap', null, 'Tap (Space)', () => syncTap()),
    tbtn('act', null, 'Undo', () => syncUndo()),
    tbtn('act', 'check', 'Finish', () => syncFinish()),
    tbtn('act', 'close', 'Cancel', () => syncCancel()));
  syncBar.append(syncCount, syncNextEl, syncBtns);
  const drawSyncBar = () => {
    syncBar.classList.toggle('hidden', !SY); ctrls.classList.toggle('hidden', !!SY);
    if (!SY) return;
    syncCount.textContent = 'Syncing lyrics · ' + SY.times.length + ' of ' + SY.texts.length + ' lines tapped';
    syncNextEl.textContent = SY.texts[SY.times.length] ? 'Next: ' + SY.texts[SY.times.length] : 'All lines tapped';
  };
  now.append(nowTitle, nowSub, bar, times, ctrls, lyrMenu, syncBar);
  const status = el('div', 'status');
  const scroll = el('div', 'scroll');
  const ambient = el('div', 'ambient');
  const grip = el('div', 'grip');
  new ResizeObserver(() => panel.classList.toggle('compact', panel.clientHeight > 0 && panel.clientHeight < 520 && !ui.min)).observe(panel);
  panel.append(ambient, head, now, tabs, status, scroll, grip);
  let undoFn = null, undoTimer = null;
  const say = (m, undo) => {
    status.textContent = ''; clearTimeout(undoTimer); undoFn = null;
    if (m) status.append(el('span', '', m));
    if (m && undo) {
      undoFn = undo;
      const b = el('button', 'undo', 'Undo'); b.setAttribute('aria-label', 'Undo last change');
      b.onclick = async ev => { ev.stopPropagation(); const f = undoFn; undoFn = null; status.textContent = ''; if (f) await f(); draw(); };
      status.append(' ', b);
      undoTimer = setTimeout(() => { if (undoFn === undo) { undoFn = null; b.remove(); } }, 20000);
    }
  };

  const setIcon = (b, name, label) => { b.firstChild.replaceWith(icon(name)); b.title = label; b.setAttribute('aria-label', label); };
  const syncPP = () => { const v = V(); const playing = v && !v.paused && !awayFromSong(); setIcon(ppBtn, playing ? 'pause' : 'play', playing ? 'Pause' : 'Play'); };

  // drag the panel by its header
  head.addEventListener('pointerdown', ev => {
    if (ev.target.closest && ev.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    const mv = e => { ui.x = Math.max(0, Math.min(innerWidth - 80, e.clientX - dx)); ui.y = Math.max(0, Math.min(innerHeight - 50, e.clientY - dy)); place(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); saveUi(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  const MIN_W = 320, MIN_H = 280, DEF_W = 384;
  const place = () => {
    // if the panel was left low on the screen, move it up so it always has room to show its contents
    const want = ui.min ? 140 : Math.min(innerHeight - 16, Math.max(ui.h || 0, 420));
    const top = Math.max(8, Math.min(ui.y == null ? 70 : ui.y, innerHeight - want - 8));
    panel.style.top = top + 'px';
    const room = innerHeight - top - 12;                       // space left below the top edge, so nothing is cut off
    const w = ui.min ? 320 : Math.max(MIN_W, Math.min(innerWidth - 16, ui.w || DEF_W));
    panel.style.width = w + 'px';
    if (ui.min) { panel.style.height = ''; panel.style.maxHeight = room + 'px'; }
    else if (ui.h) { panel.style.height = Math.max(Math.min(MIN_H, room), Math.min(room, ui.h)) + 'px'; panel.style.maxHeight = ''; }
    else { panel.style.height = ''; panel.style.maxHeight = Math.min(room, Math.round(innerHeight * 0.8)) + 'px'; }
    if (ui.x == null) { panel.style.left = ''; panel.style.right = '16px'; }
    else { panel.style.right = ''; panel.style.left = Math.max(0, Math.min(innerWidth - w, ui.x)) + 'px'; }
  };
  grip.title = 'Drag to resize · double-click to reset size';
  grip.addEventListener('pointerdown', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const r = panel.getBoundingClientRect();
    ui.x = r.left; ui.y = r.top;                               // pin the top-left corner while resizing
    const sx = ev.clientX, sy = ev.clientY, sw = r.width, sh = r.height;
    const mv = e => { ui.w = Math.round(Math.max(MIN_W, Math.min(innerWidth - 16, sw + e.clientX - sx))); ui.x = Math.max(8, Math.min(r.left, innerWidth - 8 - ui.w)); ui.h = Math.round(Math.max(MIN_H, Math.min(innerHeight - r.top - 12, sh + e.clientY - sy))); place(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); saveUi(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', ev => { ev.stopPropagation(); resetSize(); });
  const resetSize = () => { delete ui.w; delete ui.h; saveUi(); place(); say('Panel size reset.'); };
  const saveUi = () => local.set({ ui }).catch(() => {});

  // ---------- drawing ----------
  let openSong = null, chooserFor = null, pickQuery = ''; const collapsed = new Set();
  let pickStream = null, selecting = null, pickSel = false;     // add a whole stream / selected songs to a playlist
  const endSelect = () => { selecting = null; pickSel = false; };
  let dragging = false, keepFocus = null;
  let songQuery = '', plQuery = '', searchFocus = null;      // search on the Songs tab and inside a playlist
  const norm = t => String(t || '').normalize('NFKC').toLowerCase();
  const searchBox = (val, label, set) => {
    const wrap = el('div', 'searchbox');
    const ic = el('span', 'sic'); ic.append(icon('search'));
    const inp = el('input', 'sinput'); inp.type = 'text'; inp.value = val; inp.placeholder = label; inp.setAttribute('aria-label', label);
    const apply = () => { searchFocus = { cls: label, pos: inp.selectionStart }; set(inp.value); draw(); };
    inp.oninput = ev => { if (!ev.isComposing) apply(); };          // Japanese input: wait until the word is confirmed
    inp.addEventListener('compositionend', apply);
    inp.onkeydown = ev => { if (ev.key === 'Escape' && inp.value) { ev.preventDefault(); searchFocus = { cls: label, pos: 0 }; set(''); draw(); } };
    wrap.append(ic, inp);
    if (val) { const c = ibtn('close', 'Clear search', () => { searchFocus = { cls: label, pos: 0 }; set(''); draw(); }, 'sm'); wrap.append(c); }
    return wrap;
  };
  // drag a song by its handle to a new place in the playlist (mouse or touch)
  const startDrag = (ev, handle, list, x, done) => {
    if (ev.button > 0) return;
    ev.preventDefault();
    const card = handle.closest('.song'); if (!card) return;
    dragging = true;
    const y0 = ev.clientY, start = [...list.children].indexOf(card);
    card.classList.add('dragging'); list.classList.add('sorting');
    const id = ev.pointerId;
    const move = e => {
      if (e.pointerId !== id) return;
      const r = scroll.getBoundingClientRect();        // scroll the panel near its edges
      if (e.clientY < r.top + 40) scroll.scrollTop -= 10; else if (e.clientY > r.bottom - 40) scroll.scrollTop += 10;
      const others = [...list.children].filter(c => c !== card);
      let at = others.length;
      for (let i = 0; i < others.length; i++) { const b = others[i].getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { at = i; break; } }
      const ref = others[at] || null;
      if (card.nextSibling !== ref) list.insertBefore(card, ref);
      [...list.children].forEach((c, i) => { const n = c.querySelector('.num'); if (n) n.textContent = String(i + 1); });
    };
    const end = e => {
      if (e && e.pointerId !== id) return;
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true);
      card.classList.remove('dragging'); list.classList.remove('sorting'); dragging = false;
      const keys = [...list.children].map(c => c.dataset.k);
      if ([...list.children].indexOf(card) === start) { draw(); return; }
      done(keys, x);
    };
    // listen on the page, not the handle: moving the row in the list would make the browser drop the handle's events
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
  };
  // ---------- add-to-playlist picker: recent first, then A–Z, with search ----------
  const touchPl = k => { ui.plr = ui.plr || {}; ui.plr[k] = Date.now(); saveUi(); };   // "recently used" is kept per computer
  const playlistPicker = (keys, done) => {
    keys = keys.filter(k => S[k]);
    const one = keys.length === 1, nSongs = n => n === 1 ? '1 song' : n + ' songs';
    const box = el('div', 'picker');
    box.append(el('div', 'clabel', one ? 'Add to playlist' : 'Add ' + nSongs(keys.length) + ' to playlist'));
    const many = PL.length > 6;
    const inp = el('input', 'pksearch'); inp.type = 'text'; inp.value = pickQuery; inp.setAttribute('aria-label', 'Search or name a new playlist');
    inp.placeholder = many ? 'Search or name a new playlist' : 'Name a new playlist';
    const list = el('div', 'pklist'); list.setAttribute('role', 'list');
    const inside = p => keys.filter(k => p.list.includes(k)).length;      // how many of these songs the playlist has
    const toggle = async p => {
      const before = [...p.list], n = inside(p), all = n === keys.length;
      if (all) p.list = p.list.filter(k => !keys.includes(k));
      else { keys.forEach(k => { if (!p.list.includes(k)) p.list.push(k); }); touchPl(p.k); }
      await put(p);
      const msg = one ? (all ? 'Removed from ' : 'Added to ') + p.n + '.'
        : all ? 'Removed ' + nSongs(keys.length) + ' from ' + p.n + '.'
        : 'Added ' + nSongs(keys.length - n) + ' to ' + p.n + (n ? ' (' + n + (n === 1 ? ' was' : ' were') + ' already there).' : '.');
      if (done) done();
      say(msg, async () => { p.list = before; await put(p); });
      draw();
    };
    const create = async name => {
      const p = await addPlaylist(name); keys.forEach(k => p.list.push(k)); await put(p); touchPl(p.k); pickQuery = '';
      if (done) done();
      say('Made ' + p.n + ' and added ' + (one ? 'the song' : nSongs(keys.length)) + '.', async () => { if (P && P.plk === p.k) stop('Stopped.'); PL = PL.filter(y => y !== p); if (ui.plr) delete ui.plr[p.k]; if (ui.pl === p.k) delete ui.pl; saveUi(); await sync.remove(p.k); });
      draw();
    };
    const row = p => {
      const c = inside(p), has = c === keys.length, part = c > 0 && !has, n = p.list.filter(k => S[k]).length;
      const b = el('button', 'pkrow' + (has ? ' on' : part ? ' part' : '')); b.type = 'button'; b.setAttribute('role', 'listitem');
      b.setAttribute('aria-pressed', has ? 'true' : part ? 'mixed' : 'false');
      b.setAttribute('aria-label', (has ? 'Remove from ' : 'Add to ') + p.n + (part ? ' (has ' + c + ' of ' + keys.length + ')' : ''));
      const mark = el('span', 'pkmark'); if (has) mark.append(icon('check')); else if (part) mark.append(icon('minus'));
      b.append(mark, el('span', 'pkname', p.n), el('span', 'pkcount', String(n)));
      b.onclick = ev => { ev.stopPropagation(); toggle(p); };
      return b;
    };
    const fill = () => {
      list.textContent = '';
      const qv = inp.value.trim().toLowerCase();
      const match = PL.filter(p => !qv || p.n.toLowerCase().includes(qv));
      const used = ui.plr || {};
      const recent = match.filter(p => used[p.k]).sort((a, b) => used[b.k] - used[a.k]).slice(0, 3);
      const rest = match.filter(p => !recent.includes(p)).sort((a, b) => a.n.localeCompare(b.n, undefined, { sensitivity: 'base', numeric: true }));
      const heads = PL.length > 4 && recent.length && rest.length;
      if (heads) list.append(el('div', 'pkhead', 'Recent'));
      recent.forEach(p => list.append(row(p)));
      if (heads) list.append(el('div', 'pkhead', 'All playlists'));
      rest.forEach(p => list.append(row(p)));
      const name = inp.value.trim();
      if (name && !PL.some(p => p.n.toLowerCase() === name.toLowerCase())) {
        const c = el('button', 'pkrow pknew'); c.type = 'button';
        const mark = el('span', 'pkmark'); mark.append(icon('plus'));
        c.append(mark, el('span', 'pkname', 'Create “' + name + '”'));
        c.onclick = ev => { ev.stopPropagation(); create(name); };
        list.append(c);
      } else if (!match.length) list.append(el('div', 'pkempty', 'No playlist matches.'));
    };
    inp.oninput = () => { pickQuery = inp.value; fill(); };
    inp.onkeydown = ev => {
      if (ev.key !== 'Enter') return; ev.preventDefault();
      const name = inp.value.trim(); if (!name) return;
      const same = PL.find(p => p.n.toLowerCase() === name.toLowerCase());
      if (same) toggle(same); else create(name);
    };
    fill();
    box.append(inp, list);
    if (!PL.length) box.append(el('div', 'pkempty', 'No playlists yet. Type a name above and press Enter.'));
    return box;
  };

  const draw = () => {
    if (dragging) return;
    place();
    panel.classList.toggle('mini', ui.min);
    setIcon(minBtn, ui.min ? 'expand' : 'shrink', ui.min ? 'Expand' : 'Shrink');
    tabSongs.classList.toggle('on', ui.tab === 'songs');
    tabPl.classList.toggle('on', ui.tab === 'pl');
    gearBtn.classList.toggle('on', ui.tab === 'settings');
    tabs.style.display = ui.tab === 'welcome' ? 'none' : '';
    drawNow();
    if (ui.min) return;
    scroll.textContent = '';
    if (incoming && ui.tab !== 'welcome') {
      const c = el('div', 'incoming');
      const top = el('div', 'nshead'); top.append(icon('share'), el('b', '', 'Shared playlist'), el('span', 'grow'), ibtn('close', 'Not now', () => { incoming = null; draw(); }, 'sm'));
      const list = el('div', 'inlist');
      incoming.songs.filter(Boolean).slice(0, 4).forEach(x => list.append(el('div', '', x.n)));
      const more = incoming.songs.filter(Boolean).length - 4; if (more > 0) list.append(el('div', 'inmore', '+ ' + more + ' more'));
      const btns = el('div', 'acts');
      btns.append(tbtn('playall', 'plus', 'Add "' + incoming.name + '" to my playlists', async () => {
        const inc = incoming; incoming = null;
        try {
          const r = await importItems(inc.songs, [{ n: inc.name, list: inc.songs.map((_, i) => i), sh: inc.sh, r: inc.r, g: inc.g }]);
          if (r.made[0]) { ui.pl = r.made[0].k; ui.tab = ui.lastTab = 'pl'; saveUi(); }
          say('Added "' + inc.name + '" with ' + (r.added + r.skipped) + ' songs' + (r.skipped ? ' (' + r.skipped + ' you already had)' : '') + '.');
        } catch (err) { say(err.message); }
        draw();
      }));
      c.append(top, el('div', 'inname', incoming.name + ' · ' + incoming.songs.filter(Boolean).length + ' songs'), list, btns);
      scroll.append(c);
    }
    if (ui.tab === 'pl') drawPlaylists(); else if (ui.tab === 'settings') drawSettings(); else if (ui.tab === 'welcome') drawWelcome(); else drawSongs();
    if (shownTab !== ui.tab) { scroll.scrollTop = 0; if (shownTab !== null) { songQuery = plQuery = ''; } shownTab = ui.tab; }
    if (searchFocus) {                                 // keep typing in the search box after the list redraws
      const f = searchFocus; searchFocus = null;
      const inp = [...scroll.querySelectorAll('.sinput')].find(i => i.getAttribute('aria-label') === f.cls);
      if (inp) { inp.focus(); try { inp.setSelectionRange(f.pos, f.pos); } catch (err) {} }
    }
    if (reveal) { const t = scroll.querySelector(reveal); reveal = null; if (t) { const d = t.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (scroll.clientHeight - t.offsetHeight) / 2; scroll.scrollTo({ top: scroll.scrollTop + d, behavior: 'smooth' }); panel.scrollTop = 0; } }
  };

  const thumbs = v => 'url("https://i.ytimg.com/vi/' + v + '/maxresdefault.jpg"), url("https://i.ytimg.com/vi/' + v + '/hqdefault.jpg")';
  let bgFor = null;
  const setBg = (v, k) => {
    const img = k && IMG[k], id = img ? 'img:' + k : v;
    if (id === bgFor) return; bgFor = id;
    if (!v) { now.style.backgroundImage = ''; ambient.style.backgroundImage = ''; ambient.classList.remove('on'); return; }
    const src = img ? 'url("' + img + '")' : thumbs(v);
    now.style.backgroundImage = 'linear-gradient(90deg, rgba(30,30,36,.9) 0%, rgba(30,30,36,.62) 55%, rgba(30,30,36,.3) 100%), ' + src;
    ambient.style.backgroundImage = src; ambient.classList.add('on');
  };
  const drawNow = () => {
    const x = cur();
    setBg(x ? x.v : vidNow(), x && x.k);
    now.classList.toggle('hidden', !x && !ui.min);
    brand.textContent = 'Saine Wave';
    syncOvBtn(); syncRpBtn(); ovBtn.style.display = xlBtn.style.display = x && lyricsFor(x) && lyricsFor(x).synced ? '' : 'none';
    if (xlBtn.style.display === 'none' || SY) lyrMenuOpen = false;
    syncXlBtn(); fillLyrMenu();
    if (!x) {                                     // nothing playing: just the text, no controls, bar or times
      nowTitle.textContent = 'Nothing playing'; nowSub.textContent = 'Open the panel to pick a song';
      [prevBtn, ppBtn, nextBtn, stopBtn, rpBtn].forEach(b => b.style.display = 'none');
      bar.style.display = times.style.display = ctrls.style.display = 'none';
      return;
    }
    rpBtn.style.display = bar.style.display = times.style.display = ctrls.style.display = '';
    nowTitle.textContent = x.n;
    nowSub.textContent = P.mode === 'one' ? ((ui.rp || 'all') === 'off' ? 'Playing once' : 'Looping') + (x.t ? ' · ' + x.t : '')
      : P.name + ' · ' + (P.i + 1) + ' of ' + P.list.length + (P.r > 1 ? ' · play ' + P.rep + ' of ' + P.r : '');
    tA.textContent = fmt(x.s); tB.textContent = fmt(x.e);
    ppBtn.style.display = stopBtn.style.display = '';
    prevBtn.style.display = nextBtn.style.display = P.mode === 'list' ? '' : 'none';
    syncPP();
    ensureLyrics(x);
  };
  const drawBar = () => {
    const x = cur(), v = V(); if (!x || !v) return;
    const f = Math.max(0, Math.min(1, (v.currentTime - x.s) / (x.e - x.s)));
    barFill.style.width = (f * 100).toFixed(1) + '%';
    tA.textContent = fmt(Math.max(x.s, Math.min(x.e, v.currentTime)));
  };
  // ---------- lyrics on the video ----------
  const ovHost = el('div'); ovHost.id = 'saine-wave-lyrics';
  const ovRoot = ovHost.attachShadow({ mode: 'open' });
  const ovStyle = el('style'); ovStyle.textContent = `
    :host{all:initial;position:absolute;left:0;right:0;bottom:var(--sw-b,72px);z-index:59;pointer-events:none;display:flex;justify-content:center;transition:bottom .2s}
    :host(.top){top:var(--sw-t,56px);bottom:auto}
    :host(.off){display:none}
    .wrap{max-width:86%;text-align:center;font-family:Roboto,"Segoe UI",Arial,sans-serif;font-size:var(--sw-fs,24px);line-height:1.3}
    .cur{display:inline-block;padding:.16em .6em .2em;border-radius:.45em;background:rgba(30,30,36,.62);color:#F2F4F8;font-weight:600;
      text-shadow:0 2px 6px rgba(0,0,0,.85);transition:opacity .22s ease}
    .cur.fade{opacity:0}
    .cur:empty{display:none}
    .nxt{display:table;margin:.3em auto 0;padding:.1em .55em .14em;border-radius:.45em;background:rgba(30,30,36,.46);color:rgba(242,244,248,.88);font-size:.62em;font-weight:500;text-shadow:0 1px 4px rgba(0,0,0,.95)}
    .nxt:empty{display:none}`;
  const ovWrap = el('div', 'wrap'), ovCur = el('div', 'cur'), ovNxt = el('div', 'nxt');
  ovWrap.append(ovCur, ovNxt); ovRoot.append(ovStyle, ovWrap);
  let ovShown = '';
  // ---------- sync it yourself: tap along ----------
  let SY = null;                                    // { k, texts:[...], times:[...] }
  const syncSong = () => SY && S[SY.k];
  const startSync = x => {
    const e = LY[x.k]; if (!e) return;
    if (x.v !== vidNow()) { say('Open this song\'s stream first.'); return; }
    const texts = tapTexts(e.raw);
    if (!texts.length) { say('These lyrics have no lines to sync.'); return; }
    SY = { k: x.k, texts, times: [] };
    playOne(x); toggle(true);
    say('Tap Space (or Tap) each time a new line starts. Backspace undoes, Enter finishes, Esc cancels.');
    drawSyncBar(); updateOverlay(true);
  };
  const syncTap = () => {
    const x = syncSong(), v = V(); if (!x || !v) return;
    if (adOn()) { say('An ad is playing. Taps are ignored until it finishes.'); return; }
    if (SY.times.length >= SY.texts.length) return;
    SY.times.push(Math.max(0, Math.round((v.currentTime - x.s) * 10)));
    drawSyncBar(); updateOverlay(true);
    if (SY.times.length === SY.texts.length) say('All lines tapped. They\'ll be saved when the song ends, or press Enter to save now.');
  };
  const syncUndo = () => {
    const x = syncSong(), v = V(); if (!x || !v || !SY.times.length) return;
    const t = SY.times.pop() / 10;
    seek(v, Math.max(x.s, x.s + t - 3));            // jump back a little so you can tap that line again
    say('Undone. Tap again when "' + SY.texts[SY.times.length] + '" starts.');
    drawSyncBar(); updateOverlay(true);
  };
  const syncFinish = async () => {
    const x = syncSong(); if (!x) { SY = null; return; }
    if (!SY.times.length) { syncCancel('Nothing was tapped, so nothing changed.'); return; }
    const left = SY.texts.length - SY.times.length;
    if (left && !confirm(left + ' line' + (left > 1 ? 's were' : ' was') + ' not tapped and won\'t show on the video. Save anyway?')) return;
    x.tt = SY.times.slice(); x.lo = 0; SY = null;
    await put(x);
    say('Lyrics synced. They\'ll show on the video from now on' + (x.li ? ', on your other computers too.' : '.'));
    drawSyncBar(); draw(); updateOverlay(true);
  };
  const syncCancel = msg => { SY = null; say(msg || 'Syncing cancelled. Nothing changed.'); drawSyncBar(); draw(); updateOverlay(true); };

  const ovLines = () => {
    if (SY) {                                       // while tapping: the line being sung, and the next one to tap
      const x = syncSong(), n = SY.times.length;
      if (!x || x.v !== vidNow() || q('.ad-showing')) return null;
      const next = SY.texts[n];
      return { cur: n ? SY.texts[n - 1] : '', nxt: next ? '▸ ' + next + '   (Space)' : 'All lines tapped · Enter to save' };
    }
    const x = cur(), v = V(), L = x && lyricsFor(x);
    if (!x || !v || !L || !L.synced || x.v !== vidNow() || q('.ad-showing')) return null;
    const rel = v.currentTime - x.s - (x.lo || 0);
    let i = -1; for (let j = 0; j < L.lines.length; j++) { if (L.lines[j].t <= rel) i = j; else break; }
    const at = k => (L.lines[k] && L.lines[k].text) || '';
    const main = lyrMain(), sec = lyrSecond();
    const ex = {};                                  // romaji / English lines; null while being prepared
    for (const m of ['romaji', 'english']) if (main === m || sec === m) ex[m] = extraFor(x, m);
    const txt = (kind, k) => kind === 'orig' ? at(k) : (ex[kind] && ex[kind][k]) || null;   // null: not ready or not needed (e.g. not Japanese)
    const big = k => txt(main, k) || at(k);         // falls back to the original
    if (i < 0) return { cur: '', nxt: sec === 'none' ? '' : big(0) };
    const c = big(i) || '♪';
    let n = '';
    if (sec === 'next') n = big(i + 1);
    else if (sec !== 'none') {
      if (sec !== 'orig' && !ex[sec]) n = big(i + 1);          // not ready yet: show the next line meanwhile
      else { const t = txt(sec, i); n = t && t !== c ? t : ''; }
    }
    return { cur: c, nxt: n };
  };
  const updateOverlay = force => {
    const player = q('#movie_player') || (V() && V().parentElement);
    const mode = ui.ov || 'bottom';
    const lines = mode === 'off' ? null : ovLines();
    if (!player || !lines) { ovHost.classList.add('off'); ovShown = ''; return; }
    if (ovHost.parentElement !== player) player.append(ovHost);
    ovHost.classList.remove('off'); ovHost.classList.toggle('top', mode === 'top');
    const h = player.clientHeight || 360;
    ovHost.style.setProperty('--sw-fs', Math.round(Math.max(15, Math.min(46, h * 0.048))) + 'px');
    const hidden = player.classList.contains('ytp-autohide');
    ovHost.style.setProperty('--sw-b', (hidden ? Math.round(h * 0.06) : Math.round(h * 0.06) + 54) + 'px');
    ovHost.style.setProperty('--sw-t', Math.round(h * 0.06) + 'px');
    const key = lines.cur + '\n' + lines.nxt;
    if (key === ovShown && !force) return;
    const changed = ovShown && lines.cur !== ovCur.textContent;
    ovShown = key;
    if (changed) { ovCur.classList.add('fade'); setTimeout(() => { ovCur.textContent = lines.cur; ovNxt.textContent = lines.nxt; ovCur.classList.remove('fade'); }, 120); }
    else { ovCur.textContent = lines.cur; ovNxt.textContent = lines.nxt; }
  };

  let searchFor = null, found = [], pasteFor = null, searching = false, reveal = null;
  const lyricsSection = x => {
    ensureLyrics(x);
    const box = el('div', 'lyrsec');
    const L = lyricsFor(x), e = LY[x.k];
    const head = el('div', 'bgtext');
    let st = '';
    if (e && L) st = (e.src === 'lrclib' ? 'From LRCLIB' + (x.lt ? ': ' + x.lt : '') : 'Your own lyrics') + (L.tapped ? ' · synced by you' : L.synced ? ' · synced' : ' · not synced yet. Press Sync it yourself to time them so they show on the video.');
    else if (x.li) st = 'From LRCLIB' + (x.lt ? ': ' + x.lt : '') + ' · loading…';
    else if (x.lw) st = 'Your own lyrics are on another computer. Paste them here too to see them on this one.';
    head.append(st);
    if (st) box.append(head);
    const btns = el('div', 'acts');
    btns.append(
      tbtn('act', 'search', 'Find lyrics', async () => {
        const qy = prompt('Search LRCLIB for (song title and artist):', lyricsQuery(x.n));
        if (!qy || !qy.trim()) return;
        searchFor = x.k; found = []; searching = true; pasteFor = null; say('Searching LRCLIB…'); draw();
        const r = await lrclib('/api/search?q=' + encodeURIComponent(qy.trim()));
        searching = false;
        if (!r.ok) { say(r.status === 429 ? 'LRCLIB is busy. Try again in a minute.' : 'Could not reach LRCLIB. Check your connection and try again.'); searchFor = null; draw(); return; }
        found = (r.data || []).filter(d => d && (d.syncedLyrics || d.plainLyrics)).slice(0, 8);
        say(found.length ? 'Pick the right version below.' : 'No lyrics found. Try a different spelling, or paste your own.');
        if (found.length) reveal = '.results';
        if (!found.length) searchFor = null;
        draw();
      }),
      tbtn('act', 'edit', 'Paste', () => { pasteFor = pasteFor === x.k ? null : x.k; searchFor = null; if (pasteFor) reveal = '.paste'; draw(); }),
      tbtn('act', 'file', 'Load file', () => {
        const inp = el('input'); inp.type = 'file'; inp.accept = '.lrc,.srt,.txt';
        inp.onchange = async () => {
          const f = inp.files && inp.files[0]; if (!f) return;
          const raw = await f.text();
          if (!parseLyrics(raw).lines.length) { say('That file has no lyrics in it.'); return; }
          await saveLyrics(x, { src: 'own', raw }); delete x.li; delete x.lt; delete x.tt; x.lw = 1; await put(x);
          say('Lyrics loaded from ' + f.name + '.'); draw();
        };
        inp.click();
      }));
    if (L) btns.append(tbtn('act', 'subs', L.synced && !L.tapped ? 'Re-time by tapping' : L.tapped ? 'Re-sync by tapping' : 'Sync it yourself', () => startSync(x)));
    if (e || x.li || x.lw) btns.append(tbtn('act danger', 'trash', 'Remove lyrics', async () => {
      delete x.li; delete x.lt; delete x.lw; delete x.lo; delete x.tt; await put(x); await dropLyrics(x); say('Lyrics removed.'); draw();
    }));
    box.append(btns);
    if (L && L.synced) {
      const tm = el('div', 'tbox lyrtime');
      const lab = el('div', 'tlabel', 'Lyrics timing'); lab.append(el('b', '', ((x.lo || 0) >= 0 ? '+' : '') + (x.lo || 0).toFixed(1) + 's'));
      const shift = d => { x.lo = r1((x.lo || 0) + d); put(x, 700); draw(); };
      tm.append(lab,
        ibtn('minus', 'Lyrics 0.5 seconds earlier', () => shift(-0.5), 'sm'),
        ibtn('plus', 'Lyrics 0.5 seconds later', () => shift(0.5), 'sm'),
        tbtn('act', null, 'First line now', () => {
          const v = V(); if (!v || x.v !== vidNow()) { say('Play this song first.'); return; }
          const first = L.lines.find(l => l.text); if (!first) return;
          x.lo = r1(v.currentTime - x.s - first.t); put(x); say('Lyrics lined up: the first line starts now.'); draw();
        }));
      box.append(tm);
    }
    if (searchFor === x.k && found.length) {
      const list = el('div', 'results');
      found.forEach(d => {
        const b = el('button', 'result');
        const kind = d.syncedLyrics ? 'synced' : 'not synced';
        b.append(el('b', '', d.trackName || d.name || 'Untitled'), el('span', '', (d.artistName || '') + (d.duration ? ' · ' + fmt(d.duration) : '') + ' · ' + kind));
        b.setAttribute('aria-label', 'Use lyrics: ' + (d.trackName || '') + ' by ' + (d.artistName || ''));
        b.onclick = async ev => {
          ev.stopPropagation();
          await saveLyrics(x, { src: 'lrclib', id: d.id, raw: d.syncedLyrics || d.plainLyrics });
          x.li = d.id; x.lt = (d.trackName || '') + (d.artistName ? ' — ' + d.artistName : ''); delete x.lw; delete x.tt; x.lo = 0; await put(x);
          searchFor = null; found = [];
          say('Lyrics added' + (d.syncedLyrics ? '. Play the song and adjust the timing if the lines are early or late.' : '. These aren\'t synced yet, so press Sync it yourself to time them for the video.'));
          draw();
        };
        list.append(b);
      });
      list.append(tbtn('act', 'close', 'Cancel', () => { searchFor = null; found = []; say(''); draw(); }));
      box.append(list);
    }
    if (L && L.lines.some(l => l.text)) {
      const own = OWN[x.k] || {}, jp = L.lines.some(l => /[぀-ヿ一-鿿]/.test(l.text));
      const sec = el('div', 'ownsec');
      sec.append(el('div', 'tlabel', 'Romaji and English'));
      const note = [];
      if (own.ro) note.push('Using your romaji (' + ownLines(own.ro).length + ' lines).');
      if (own.en) note.push('Using your English (' + ownLines(own.en).length + ' lines).');
      if (!note.length) note.push('Made automatically. Paste your own to get them exactly right.');
      sec.append(el('div', 'setnote', note.join(' ')));
      const acts = el('div', 'acts');
      if (jp) acts.append(tbtn('act' + (ownFor === x.k + ':ro' ? ' on' : ''), 'edit', own.ro ? 'Edit your romaji' : 'Paste romaji', () => { ownFor = ownFor === x.k + ':ro' ? null : x.k + ':ro'; draw(); }));
      acts.append(tbtn('act' + (ownFor === x.k + ':en' ? ' on' : ''), 'edit', own.en ? 'Edit your English' : 'Paste English', () => { ownFor = ownFor === x.k + ':en' ? null : x.k + ':en'; draw(); }));
      sec.append(acts);
      const which = ownFor && ownFor.startsWith(x.k + ':') ? ownFor.slice(x.k.length + 1) : null;
      if (which) {
        const ta = el('textarea', 'paste');
        ta.placeholder = 'Paste the ' + (which === 'ro' ? 'romaji' : 'English') + ', one line per lyric line, in the same order.';
        ta.setAttribute('aria-label', which === 'ro' ? 'Your romaji' : 'Your English');
        ta.value = own[which] || '';
        const want = L.lines.filter(l => l.text).length;
        const cnt = el('div', 'setnote');
        const upd = () => { const n = ownLines(ta.value).length; cnt.textContent = n + ' of ' + want + ' lines' + (n && n !== want ? ' — they\'re matched in order, so check the end.' : '.'); };
        ta.oninput = upd; upd();
        const row = el('div', 'acts');
        row.append(tbtn('act primary', 'check', 'Save', async () => {
          await saveOwn(x, which, ta.value); ownFor = null;
          say(ta.value.trim() ? 'Saved. Your ' + (which === 'ro' ? 'romaji' : 'English') + ' shows on the video now.' : 'Cleared.'); updateOverlay(true); draw();
        }), tbtn('act', 'close', 'Cancel', () => { ownFor = null; draw(); }));
        if (own[which]) row.append(tbtn('act danger', 'trash', 'Use automatic', async () => { await saveOwn(x, which, ''); ownFor = null; say('Back to automatic ' + (which === 'ro' ? 'romaji.' : 'English.')); updateOverlay(true); draw(); }));
        sec.append(ta, cnt, row);
      }
      if (jp && !own.ro) {                         // fix single words in the automatic romaji
        const fx = el('div', 'fixes');
        fx.append(el('div', 'setnote', 'Fix a word in the automatic romaji (for this song):'));
        (x.rf || []).forEach((f, i) => {
          const r = el('div', 'fixrow');
          const rm = ibtn('close', 'Remove the fix ' + f[0] + ' to ' + f[1], async () => {
            const before = (x.rf || []).map(y => y.slice()); x.rf.splice(i, 1); if (!x.rf.length) delete x.rf; await put(x);
            say('Fix removed.', async () => { x.rf = before; await put(x); updateOverlay(true); }); updateOverlay(true); draw();
          }, 'sm rmx');
          r.append(el('span', 'fixword', f[0]), el('span', 'fixarrow', '→'), el('span', 'fixword', f[1]), rm);
          fx.append(r);
        });
        const add = el('div', 'fixrow');
        const a = el('input', 'fixin'); a.type = 'text'; a.placeholder = 'shintai'; a.setAttribute('aria-label', 'Word in the romaji');
        const b = el('input', 'fixin'); b.type = 'text'; b.placeholder = 'karada'; b.setAttribute('aria-label', 'Replace with');
        const go = async () => {
          const f = a.value.trim(), t = b.value.trim(); if (!f || !t) { say('Type the word as it shows, and what it should be.'); return; }
          x.rf = (x.rf || []).filter(y => y[0].toLowerCase() !== f.toLowerCase()).concat([[f, t]]); await put(x);
          say('Fixed: ' + f + ' → ' + t + '.'); updateOverlay(true); draw();
        };
        b.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } };
        add.append(a, el('span', 'fixarrow', '→'), b, tbtn('act', 'plus', 'Add', go));
        fx.append(add);
        sec.append(fx);
      }
      box.append(sec);
    }
    if (pasteFor === x.k) {
      const ta = el('textarea', 'paste'); ta.placeholder = 'Paste lyrics here. Lines starting with timings like [01:23.45] will be synced.';
      ta.setAttribute('aria-label', 'Lyrics text');
      if (e && e.src === 'own') ta.value = e.raw;
      const row = el('div', 'acts');
      row.append(tbtn('act', 'check', 'Save lyrics', async () => {
        if (!parseLyrics(ta.value).lines.length) { say('Paste some lyrics first.'); return; }
        await saveLyrics(x, { src: 'own', raw: ta.value }); delete x.li; delete x.lt; delete x.tt; x.lw = 1; await put(x);
        pasteFor = null; say('Lyrics saved.'); draw();
      }), tbtn('act', 'close', 'Cancel', () => { pasteFor = null; draw(); }));
      box.append(ta, row);
      setTimeout(() => ta.focus(), 0);
    }
    return box;
  };

  let ownFor = null;                                // 'songKey:ro' / 'songKey:en' while pasting your own romaji/English
  let incoming = null;                              // a playlist someone shared with you, waiting for your OK
  let welcomed = true;                               // set from storage at start
  const finishWelcome = tab => { welcomed = true; local.set({ welcomed: true }).catch(() => {}); ui.tab = ui.lastTab = tab || 'songs'; saveUi(); draw(); };
  const loadSample = async () => {
    const keys = [];
    for (const x of FEATURED.songs) {
      const y = findSong(FEATURED.v, x.s, x.e) || await addSong(FEATURED.v, x.n, x.s, x.e, FEATURED.title);
      if (x.li && !y.li && !y.lw && !LY[y.k]) {        // give the sample songs their lyrics, unless you already set your own
        y.li = x.li; y.lo = 0; if (x.tt) y.tt = x.tt.slice(); await put(y);
      }
      keys.push(y.k);
    }
    return keys;
  };
  const drawWelcome = () => {
    const w = el('div', 'welcome');
    w.append(el('div', 'wtitle', 'Welcome to Saine Wave'), el('div', 'wsub', 'Save the songs from any YouTube stream, loop them, and make playlists.'));
    const steps = el('ol', 'wsteps');
    [['Open a stream', 'any VTuber, any karaoke or live stream'], ['Press New song', 'mark where the song starts and ends'], ['Loop it or add it to a playlist', 'lyrics, romaji and more are in each song\'s options']]
      .forEach(([a, b]) => { const li = el('li'); li.append(el('b', '', a), el('span', '', b)); steps.append(li); });
    const card = el('div', 'feat');
    const thumb = el('div', 'fthumb'); thumb.style.backgroundImage = 'url("https://i.ytimg.com/vi/' + FEATURED.v + '/mqdefault.jpg")';
    const info = el('div', 'finfo');
    info.append(el('div', 'fkicker', 'Try it with ' + FEATURED.name + ' ' + FEATURED.mark), el('div', 'ftitle2', FEATURED.title),
      el('div', 'fmeta', FEATURED.songs.length + ' sample songs · plays on YouTube, so every listen counts for her'));
    card.append(thumb, info);
    const btns = el('div', 'fbtns');
    btns.append(
      tbtn('playall', 'play', 'Load sample songs and play', async () => {
        const keys = await loadSample();
        finishWelcome('songs');
        const x = S[keys[0]]; if (x) playOne(x);
      }),
      tbtn('act', null, 'Just open the stream', () => { finishWelcome('songs'); location.href = location.origin + '/watch?v=' + FEATURED.v; }));
    w.append(steps, card, btns, tbtn('wskip', null, 'Skip, I\'ll add my own', () => finishWelcome('songs')));
    scroll.append(w);
  };

  const drawSettings = () => {
    const sec = (title, ...kids) => { const d = el('div', 'set'); d.append(el('div', 'sethead', title), ...kids); return d; };
    scroll.append(
      sec('Lyrics on the video',
        choice(ui.ov || 'bottom', [['bottom', 'Bottom'], ['top', 'Top'], ['off', 'Off']], v => { ui.ov = v; saveUi(); updateOverlay(true); draw(); }),
        el('div', 'setnote', 'Use Top if they overlap YouTube\'s own captions.')),
      sec('Repeat',
        choice(ui.rp || 'all', [['all', 'All'], ['one', 'One song'], ['off', 'Off']], v => setRepeat(v)),
        el('div', 'setnote', 'All: a song loops, a playlist starts over. One song: keep repeating the current song. Off: play once, then stop.')),
      sec('Lyrics lines',
        el('div', 'lmlabel', 'Main line'), choice(lyrMain(), LM_OPTS, v => setLyr('main', v)),
        el('div', 'lmlabel', 'Second line'), choice(lyrSecond(), L2_OPTS.filter(o => o[0] !== lyrMain()), v => setLyr('second', v)),
        el('div', 'setnote', 'For all songs. Songs that aren\'t in Japanese show the original instead of romaji. English uses Edge\'s built-in translator (Edge 148 or newer). Also in the 🌐 button while a song plays.')),
      sec('Backup and sharing',
        (() => { const r = el('div', 'acts'); r.append(tbtn('act', 'download', 'Export everything', () => exportAll()), tbtn('act', 'upload', 'Import from file', () => importFile())); return r; })(),
        el('div', 'setnote', 'Saves your songs and playlists (with lyrics matches and timings) to a small file. Lyrics text and background frames aren\'t included.')),
      sec('Panel size',
        el('div', 'setnote', 'Drag the bottom-right corner of the panel to resize it. Drag the title bar to move it.'),
        (() => { const r = el('div', 'acts'); r.append(tbtn('act', 'restore', 'Reset size and position', () => { delete ui.w; delete ui.h; ui.x = null; ui.y = 70; saveUi(); draw(); say('Panel size and position reset.'); })); return r; })()),
      sec('Keyboard shortcuts', (() => {
        const t = el('div', 'keys');
        [['[', 'Mark the start of a song'], [']', 'Mark the end and save'], ['\\', 'Show or hide this panel'],
         ['Space', 'While syncing lyrics: tap the next line'], ['Backspace', 'While syncing: undo the last tap'], ['Enter / Esc', 'While syncing: finish / cancel']]
          .forEach(([k, d]) => { const row = el('div', 'krow'); row.append(el('kbd', '', k), el('span', '', d)); t.append(row); });
        return t; })()),
      (() => { const r = el('div', 'acts welcomeagain'); r.append(tbtn('act', null, 'Show the welcome screen', () => { ui.tab = 'welcome'; draw(); })); return r; })(),
      el('div', 'setnote ver', 'Saine Wave ' + chrome.runtime.getManifest().version),
      el('div', 'setnote ver', 'Lyrics from LRCLIB'));
  };

  const empty = (name, text) => { const d = el('div', 'empty'); d.append(icon(name), text); return d; };

  let openFold = null, plEdit = false, shownTab = null, editing = null, previewEnd = null;                              // which optional section is open in the open song
  const fold = (x, id, iconName, title, summary, body) => {
    const isOpen = openFold === id;
    const f = el('div', 'fold' + (isOpen ? ' open' : ''));
    const h = el('button', 'foldhead'); h.setAttribute('aria-expanded', String(isOpen)); h.setAttribute('aria-label', title + ': ' + summary);
    h.append(icon(iconName), el('span', 'ftitle', title), el('span', 'fsum', summary), icon(isOpen ? 'down' : 'right'));
    h.onclick = ev => { ev.stopPropagation(); openFold = isOpen ? null : id; if (id !== 'lyrics') { searchFor = null; pasteFor = null; } draw(); };
    f.append(h);
    if (isOpen) { const b = el('div', 'foldbody'); b.append(body()); f.append(b); }
    return f;
  };
  const songRow = (x, opts = {}) => {
    const playing = P && cur() === x;
    const card = el('div', 'song' + (playing ? ' playing' : '') + (openSong === x.k && !opts.pl ? ' open' : '')); card.dataset.k = x.k;
    const row = el('div', 'row');
    if (selecting && !opts.pl) {                      // select mode: the whole row is a checkbox
      const on = selecting.has(x.k);
      card.classList.add('sel'); if (on) card.classList.add('chosen');
      const cb = el('button', 'ib selbox'); cb.append(icon(on ? 'boxOn' : 'boxOff'));
      cb.setAttribute('role', 'checkbox'); cb.setAttribute('aria-checked', String(on)); cb.setAttribute('aria-label', 'Select ' + x.n);
      const flip = ev => { ev.stopPropagation(); if (on) selecting.delete(x.k); else selecting.add(x.k); draw(); };
      cb.onclick = flip; row.onclick = flip; row.style.cursor = 'pointer';
      const meta = el('div', 'meta'); meta.append(el('div', 'name', x.n), el('div', 'sub', fmt(x.s) + ' – ' + fmt(x.e) + '  ·  ' + fmt(x.e - x.s)));
      row.append(cb, meta); card.append(row); return card;
    }
    const pb = el('button', 'ib playbtn'); pb.append(icon(playing ? 'loop' : 'play'));
    const verb = (ui.rp || 'all') === 'off' ? 'Play ' : 'Loop '; pb.title = verb + x.n; pb.setAttribute('aria-label', verb + x.n); pb.onclick = ev => { ev.stopPropagation(); if (opts.onPlay) opts.onPlay(); else playOne(x); };
    const meta = el('div', 'meta');
    meta.append(el('div', 'name', x.n), el('div', 'sub', fmt(x.s) + ' – ' + fmt(x.e) + '  ·  ' + fmt(x.e - x.s) + (opts.pl && x.t ? '  ·  ' + x.t : '')));
    if (opts.lead) row.append(opts.lead);
    else if (opts.num != null) row.append(el('div', 'num', String(opts.num)));
    row.append(pb, meta);
    if (opts.pl) row.append(...opts.pl);
    else {
      const toggleOpen = () => { openSong = openSong === x.k ? null : x.k; chooserFor = null; openFold = null; searchFor = null; pasteFor = null; editing = null; previewEnd = null; draw(); };
      row.append(ibtn('more', openSong === x.k ? 'Hide options' : 'More options', toggleOpen, 'sm'));
      meta.style.cursor = 'pointer'; meta.onclick = toggleOpen;
    }
    card.append(row);
    if (opts.pl || openSong !== x.k) return card;

    // essentials: times, add to playlist, rename, delete
    const tools = el('div', 'tools');
    const ed = editing && editing.k === x.k ? editing : null;
    let tune;
    if (!ed) {
      tune = el('div', 'timesrow');
      const t = el('div', 'tsum'); t.append(el('b', '', fmt(x.s)), ' → ', el('b', '', fmt(x.e)), el('span', '', '  ·  ' + fmt(x.e - x.s)));
      tune.append(t, tbtn('act', 'edit', 'Edit times', () => { editing = { k: x.k, s: x.s, e: x.e }; chooserFor = null; draw(); }));
    } else {
      tune = el('div', 'editbox');
      const valid = (f, val) => val >= 0 && (f === 's' ? val < ed.e - 1 : val > ed.s + 1);
      const setDraft = (f, val, label) => {
        val = r1(val);
        if (!valid(f, val)) { say(f === 's' ? 'The start must be before the end (' + fmt(ed.e) + ').' : 'The end must be after the start (' + fmt(ed.s) + ').'); return; }
        ed[f] = val; say(''); draw();
      };
      const tbox = (label, f) => {
        const b = el('div', 'tbox' + (ed[f] !== x[f] ? ' changed' : ''));
        const l = el('div', 'tlabel', label); l.append(el('b', '', fmt(ed[f])));
        if (ed[f] !== x[f]) l.append(el('span', 'was', 'was ' + fmt(x[f])));
        b.append(l,
          ibtn(f === 's' ? 'markIn' : 'markOut', 'Set ' + label.toLowerCase() + ' to the current video time', () => {
            const v = V(); if (!v || x.v !== vidNow()) { say('Open this song\'s stream first.'); return; }
            if (adOn()) { say(AD_WAIT); return; }
            setDraft(f, v.currentTime);
          }, 'sm'),
          ibtn('minus', label + ' 1 second earlier', () => setDraft(f, ed[f] - 1), 'sm'),
          ibtn('plus', label + ' 1 second later', () => setDraft(f, ed[f] + 1), 'sm'));
        return b;
      };
      const grid = el('div', 'tune'); grid.append(tbox('Start', 's'), tbox('End', 'e'));
      const prevRow = el('div', 'acts');
      const preview = from => {
        const v = V(); if (!v || x.v !== vidNow()) { say('Open this song\'s stream first.'); return; }
        if (adOn()) { say(AD_WAIT); return; }
        if (P) stop(null);
        previewEnd = from === 'end' ? ed.e : Math.min(ed.e, ed.s + 8);
        seek(v, from === 'end' ? Math.max(ed.s, ed.e - 5) : ed.s); v.play().catch(() => {});
        say(from === 'end' ? 'Previewing the last few seconds…' : 'Previewing the first few seconds…');
      };
      prevRow.append(tbtn('act', 'play', 'Preview start', () => preview('start')), tbtn('act', 'play', 'Preview end', () => preview('end')));
      const saveRow = el('div', 'acts saverow');
      const changed = ed.s !== x.s || ed.e !== x.e;
      const saveBtn = tbtn('act primary', 'check', 'Save times', async () => {
        const old = { s: x.s, e: x.e };
        x.s = ed.s; x.e = ed.e; editing = null; previewEnd = null; await put(x);
        say('Times saved: ' + fmt(x.s) + ' → ' + fmt(x.e) + '.', async () => { x.s = old.s; x.e = old.e; await put(x); say('Times restored to ' + fmt(x.s) + ' → ' + fmt(x.e) + '.'); });
        draw();
      });
      saveBtn.disabled = !changed;
      saveRow.append(tbtn('act', 'close', 'Cancel', () => { editing = null; previewEnd = null; say(''); draw(); }), el('span', 'grow'), saveBtn);
      tune.append(el('div', 'edhint', 'Editing times. Nothing changes until you press Save times.'), grid, prevRow, saveRow);
    }
    const quick = el('div', 'acts quick');
    quick.append(
      tbtn('act' + (chooserFor === x.k ? ' on' : ''), 'plAdd', 'Add to playlist', () => { chooserFor = chooserFor === x.k ? null : x.k; pickQuery = ''; draw(); }),
      tbtn('act', 'edit', 'Rename', async () => {
        const n = prompt('Rename song', x.n); if (!n || !n.trim() || n.trim() === x.n) return;
        const old = x.n; x.n = n.trim(); await put(x);
        say('Renamed to ' + x.n + '.', async () => { x.n = old; await put(x); say('Name restored.'); }); draw();
      }),
      el('span', 'grow'),
      ibtn('trash', 'Delete', async () => {
        if (P && P.list.includes(x.k)) stop(null);
        const snap = { song: { ...x }, lists: PL.map(pl => ({ pl, i: pl.list.indexOf(x.k) })).filter(m => m.i >= 0), ly: LY[x.k], img: IMG[x.k], tr: TR[x.k] };
        await deleteSong(x); openSong = null; editing = null;
        say('Deleted ' + snap.song.n + '.', async () => {
          const y = snap.song; S[y.k] = y; await put(y);
          for (const m of snap.lists) { if (!m.pl.list.includes(y.k)) m.pl.list.splice(Math.min(m.i, m.pl.list.length), 0, y.k); await put(m.pl); }
          if (snap.ly) await saveLyrics(y, snap.ly);
          if (snap.img) await saveImg(y, snap.img);
          if (snap.tr) { TR[y.k] = snap.tr; try { await local.set({ ['tr_' + y.k]: snap.tr }); } catch (err) {} }
          say('Restored ' + y.n + '.');
        });
        draw();
      }, 'sm danger'));
    tools.append(tune, quick);
    if (chooserFor === x.k) tools.append(playlistPicker([x.k]));

    // optional: folded sections, each with a one-line summary
    const L = lyricsFor(x), e = LY[x.k];
    const lySum = L ? (L.tapped ? 'Synced by you' : L.synced ? 'Synced' : 'Not synced yet') : x.li ? 'Loading…' : x.lw ? 'On another computer' : 'None';
    tools.append(fold(x, 'lyrics', 'subs', 'Lyrics', lySum, () => lyricsSection(x)));
    tools.append(fold(x, 'bg', 'image', 'Background', x.f != null ? 'Frame at ' + fmt(x.f) : 'Stream thumbnail', () => {
      const box = el('div');
      const bg = el('div', 'bgrow');
      const prev = el('div', 'bgprev');
      prev.style.backgroundImage = IMG[x.k] ? 'url("' + IMG[x.k] + '")' : 'url("https://i.ytimg.com/vi/' + x.v + '/mqdefault.jpg")';
      const bgText = el('div', 'bgtext', x.f != null ? 'A frame from ' + fmt(x.f) + (IMG[x.k] ? '' : ' (grabbed when it plays on this computer)') : 'The stream\'s thumbnail. Pause on any moment and use it instead.');
      bg.append(prev, bgText);
      const bgBtns = el('div', 'acts');
      bgBtns.append(tbtn('act', 'image', 'Use current frame', async () => {
        const v = V();
        if (!v || x.v !== vidNow()) { say('Open this song\'s stream first, then pause on the frame you like.'); return; }
        if (adOn()) { say(AD_WAIT); return; }
        const url = grabFrame();
        if (!url) { say('Could not grab this frame. Let the video play for a moment and try again.'); return; }
        x.f = r1(v.currentTime); await put(x); await saveImg(x, url);
        say('Background set to the frame at ' + fmt(x.f) + '.'); draw();
      }));
      if (x.f != null) bgBtns.append(tbtn('act', 'restore', 'Use thumbnail', async () => { delete x.f; await put(x); await dropImg(x); say('Background reset to the stream thumbnail.'); draw(); }));
      box.append(bg, bgBtns); return box;
    }));
    tools.append(fold(x, 'share', 'link', 'Share', 'Link that opens and loops this song', () => {
      const box = el('div', 'acts');
      box.append(tbtn('act', 'link', 'Copy link', async () => { try { await navigator.clipboard.writeText(link(x)); say('Link for ' + x.n + ' copied.'); } catch (err) { say('Could not copy the link.'); } }));
      return box;
    }));
    card.append(tools);
    return card;
  };

  const drawSongs = () => {
    if (creating) {
      const c = el('div', 'newsong');
      const top = el('div', 'nshead'); top.append(el('b', '', 'New song'), el('span', 'grow'), ibtn('close', 'Cancel new song', () => cancelCreate(), 'sm'));
      const step = (n, done, text) => { const d = el('div', 'nsstep' + (done ? ' done' : '')); d.append(el('span', 'nsnum', done ? '✓' : String(n)), el('span', '', text)); return d; };
      createNow = el('span', 'nsnow');
      const len = mark != null && markE != null && markE > mark ? fmt(markE - mark) + ' long' : null;
      const show = el('div', 'nstimes');
      const cell = (lab, t) => { const d = el('div', 'nstime' + (t != null ? ' set' : '')); d.append(el('span', 'nslab', lab), el('b', '', t != null ? fmt(t) : '—')); return d; };
      show.append(cell('Start', mark), cell('End', markE), el('div', 'nslen', len || ''));
      const marks = el('div', 'marks');
      marks.append(tbtn('pill', 'markIn', 'Mark start', markStart), tbtn('pill', 'markOut', 'Mark end', markEnd), tbtn('pill full', 'movie', 'Full video', markFull));
      marks.children[0].title = 'Set the start to where the video is now (shortcut: [)';
      marks.children[1].title = 'Set the end to where the video is now (shortcut: ])';
      marks.children[2].title = 'Start at 0:00 and end at the end of the video';
      const save = tbtn('pill primary wide', 'check', 'Save', saveMarked);
      save.disabled = !(mark != null && markE != null && markE > mark);
      const foot = el('div', 'nsfoot'); foot.append('Video is at ', createNow, ' · keys [ and ] mark start and end');
      c.append(top, show, marks, save, foot);
      scroll.append(c);
      updateCreateNow();
    } else if (vidNow() && !selecting) {
      const add = tbtn('newbtn', 'plus', 'New song', () => startCreate()); add.title = 'Add a song from this stream (shortcut: [)';
      scroll.append(add);
    }
    const every = Object.values(S), qv = norm(songQuery.trim());
    const songs = qv ? every.filter(x => norm(x.n).includes(qv) || norm(x.t).includes(qv)) : every;
    if (!creating && (every.length > 8 || songQuery)) scroll.append(searchBox(songQuery, 'Search songs and streams', v => { songQuery = v; }));
    if (!songs.length && every.length) { scroll.append(empty('search', 'No songs match “' + songQuery.trim() + '”.')); return; }
    if (!songs.length) { endSelect(); if (!creating) scroll.append(empty('note', vidNow() ? 'No songs yet. Press New song to save part of this video, or the whole video as one song.' : 'No songs yet. Open a stream to start.')); return; }
    const here = vidNow(), groups = {};
    songs.forEach(x => { (groups[x.v] = groups[x.v] || []).push(x); });
    const order = Object.keys(groups).sort((a, b) => (a === here ? -1 : b === here ? 1 : (groups[a][0].t || '').localeCompare(groups[b][0].t || '')));
    const allKeys = order.flatMap(v => groups[v].slice().sort((a, b) => a.s - b.s).map(x => x.k));   // stream by stream, fewer stream switches
    if (!creating) {
      const bar = el('div', 'allbar');
      if (selecting) {
        bar.append(el('span', 'selhint', 'Tap songs to select them'), el('span', 'grow'),
          tbtn('chip', selecting.size === allKeys.length ? 'boxOff' : 'boxOn', selecting.size === allKeys.length ? 'Select none' : 'Select all', () => {
            if (selecting.size === allKeys.length) selecting.clear(); else allKeys.forEach(k => selecting.add(k)); draw(); }));
      } else {
        const nm = qv ? 'Search “' + songQuery.trim() + '”' : 'All songs';
        bar.append(tbtn('chip', 'play', qv ? 'Play ' + allKeys.length + (allKeys.length === 1 ? ' result' : ' results') : 'Play all', () => playList(allKeys, { sh: false, r: 1, g: 0 }, nm)),
          tbtn('chip', 'shuffle', qv ? 'Shuffle results' : 'Shuffle all', () => { const mine = here && groups[here] ? groups[here] : null;   // start with a song on this stream: no switch first
            playList(allKeys, { sh: true, r: 1, g: 0 }, nm, null, mine ? mine[Math.floor(Math.random() * mine.length)].k : null); }),
          el('span', 'grow'),
          tbtn('chip', 'boxOn', 'Select', () => { selecting = new Set(); pickSel = false; pickStream = null; openSong = null; chooserFor = null; draw(); }));
      }
      scroll.append(bar);
    }
    order.forEach(v => {
      const list = groups[v].sort((a, b) => a.s - b.s);
      const t = (list.find(x => x.t) || {}).t || 'Video ' + v;
      const g = el('div', 'group');
      const gh = el('div', 'ghead');
      const isC = collapsed.has(v) && !qv;          // searching opens every stream with matches
      const tog = () => { if (isC) collapsed.delete(v); else collapsed.add(v); draw(); };
      const title = el('div', 'gtitle'); title.title = t;
      if (v === here) title.append(el('span', 'here', 'Now watching'));
      title.append(t);
      title.onclick = tog;
      gh.append(ibtn(isC ? 'right' : 'down', isC ? 'Show songs' : 'Hide songs', tog, 'sm'), title, el('span', 'badge', String(list.length)));
      if (selecting) {
        const n = list.filter(x => selecting.has(x.k)).length, all = n === list.length;
        const b = ibtn(all ? 'boxOn' : n ? 'boxPart' : 'boxOff', (all ? 'Unselect' : 'Select') + ' all songs from this stream', () => {
          list.forEach(x => all ? selecting.delete(x.k) : selecting.add(x.k)); draw(); }, 'sm selbox');
        b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', all ? 'true' : n ? 'mixed' : 'false');
        gh.append(b);
      } else {
        const pk = ibtn('plAdd', 'Add all songs from this stream to a playlist', () => { pickStream = pickStream === v ? null : v; pickQuery = ''; draw(); }, 'sm' + (pickStream === v ? ' on' : ''));
        pk.setAttribute('aria-expanded', String(pickStream === v));
        gh.append(pk, ibtn('play', 'Play all songs from this stream', () => playList(list.map(x => x.k), { sh: false, r: 1, g: 0 }, t), 'sm'));
      }
      g.append(gh);
      if (pickStream === v && !selecting) g.append(playlistPicker(list.map(x => x.k)));
      if (!isC) list.forEach(x => g.append(songRow(x)));
      scroll.append(g);
    });
    if (selecting) {
      [...selecting].forEach(k => { if (!S[k]) selecting.delete(k); });
      const sb = el('div', 'selbar');
      const n = selecting.size;
      if (pickSel && n) sb.append(playlistPicker([...selecting], endSelect));
      const row = el('div', 'selrow');
      const add = tbtn('act primary', 'plAdd', 'Add to playlist', () => { pickSel = !pickSel; pickQuery = ''; draw(); });
      add.disabled = !n;
      row.append(el('span', 'selcount', n ? n + ' selected' : 'None selected'), el('span', 'grow'), add,
        tbtn('act', 'close', 'Cancel', () => { endSelect(); draw(); }));
      sb.append(row);
      scroll.append(sb);
    }
  };

  const drawPlaylists = () => {
    if (!PL.find(p => p.k === ui.pl)) ui.pl = PL.length ? PL[0].k : null;
    const p = PL.find(y => y.k === ui.pl);
    const top = el('div', 'plhead');
    if (PL.length) {
      const sel = el('select'); sel.setAttribute('aria-label', 'Choose playlist');
      PL.forEach(y => { const o = el('option', '', y.n + '  (' + y.list.filter(k => S[k]).length + ')'); o.value = y.k; if (y.k === ui.pl) o.selected = true; sel.append(o); });
      sel.onchange = () => { ui.pl = sel.value; saveUi(); draw(); };
      top.append(sel);
    }
    top.append(ibtn('plus', 'New playlist', async () => {
      const n = prompt('Name the new playlist', 'Playlist ' + (PL.length + 1)); if (!n || !n.trim()) return;
      const y = await addPlaylist(n.trim()); ui.pl = y.k; saveUi(); draw();
    }));
    if (p) top.append(
      ibtn('share', 'Share playlist', async () => {
        if (!p.list.some(k => S[k])) { say('Add some songs before sharing.'); return; }
        try { await navigator.clipboard.writeText(await shareLink(p)); say('Link to "' + p.n + '" copied. Anyone with Saine Wave can add it; without it, the link opens the first song.'); }
        catch (err) { say('Could not copy the link.'); }
      }),
      ibtn('edit', 'Rename playlist', async () => { const n = prompt('Rename playlist', p.n); if (n && n.trim()) { p.n = n.trim(); await put(p); draw(); } }),
      ibtn('trash', 'Delete playlist', async () => { if (!confirm('Delete the playlist ' + p.n + '? The songs stay saved.')) return; if (P && P.plk === p.k) stop('Stopped.'); PL = PL.filter(y => y !== p); await sync.remove(p.k); draw(); }, 'danger'));
    scroll.append(top);
    if (!p) { scroll.append(empty('queue', 'No playlists yet. Press + to make one, or use Add to playlist on a song.')); return; }
    const opts = el('div', 'opts');
    const cyc = (field, vals, nm, label) => tbtn('chip' + (p[field] !== vals[0] ? ' on' : ''), nm, label(p[field]), async () => { const i = vals.indexOf(p[field]); p[field] = vals[(i + 1) % vals.length]; await put(p); draw(); });
    opts.append(
      tbtn('chip' + (p.sh ? ' on' : ''), 'shuffle', p.sh ? 'Shuffle on' : 'Shuffle off', async () => { p.sh = !p.sh; await put(p); draw(); }),
      cyc('r', [1, 2, 3], 'loop', v => 'Play each ' + v + '×'),
      cyc('g', [0, 2, 5], 'timer', v => v ? v + 's gap' : 'No gap'));
    const allSongs = p.list.map(k => S[k]).filter(Boolean), pq = norm(plQuery.trim());
    const songs = pq ? allSongs.filter(x => norm(x.n).includes(pq) || norm(x.t).includes(pq)) : allSongs;
    opts.append(el('span', 'grow'), tbtn('chip' + (plEdit ? ' on' : ''), plEdit ? 'check' : 'edit', plEdit ? 'Done' : 'Edit list', () => { plEdit = !plEdit; draw(); }));
    scroll.append(opts, tbtn('playall', 'play', 'Play ' + p.n, () => playList(p.list, p, p.n, p.k)));
    if (!allSongs.length) { scroll.append(empty('plAdd', 'This playlist is empty. On the Songs tab, open a song\'s options and choose Add to playlist.')); return; }
    if (allSongs.length > 10 || plQuery) scroll.append(searchBox(plQuery, 'Search this playlist', v => { plQuery = v; }));
    if (!songs.length) { scroll.append(empty('search', 'No songs in ' + p.n + ' match “' + plQuery.trim() + '”.')); return; }
    if (pq && plEdit) scroll.append(el('div', 'setnote', 'Clear the search to drag songs into a new order.'));
    // save a new order of the shown songs (songs that no longer exist keep their place at the end)
    const reorder = async (keys, moved) => {
      const before = [...p.list];
      p.list = [...keys, ...p.list.filter(k => !keys.includes(k))];
      if (p.list.join() === before.join()) return;
      await put(p);
      say('Moved ' + moved.n + '.', async () => { p.list = before; await put(p); });
      draw();
    };
    const list = el('div', 'pllist');
    songs.forEach((x, i) => {
      const extra = []; let lead = null;
      if (plEdit) {
        const h = el('button', 'ib sm draghandle'); h.append(icon('grip'));
        h.setAttribute('aria-label', 'Move ' + x.n + ' (drag, or use the arrow keys)'); h.title = 'Drag to move';
        h.onkeydown = ev => {                         // keyboard: arrow keys move the song
          const d = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0; if (!d) return;
          ev.preventDefault(); const j = i + d; if (j < 0 || j >= songs.length) return;
          const keys = songs.map(y => y.k); [keys[i], keys[j]] = [keys[j], keys[i]];
          keepFocus = { k: x.k, until: Date.now() + 1500 }; reorder(keys, x);
        };
        h.onpointerdown = ev => startDrag(ev, h, list, x, reorder);
        const rm = ibtn('close', 'Remove ' + x.n + ' from this playlist', async () => {
          const at = p.list.indexOf(x.k); p.list = p.list.filter(k => k !== x.k); await put(p);
          say('Removed ' + x.n + ' from ' + p.n + '.', async () => { if (!p.list.includes(x.k)) p.list.splice(at, 0, x.k); await put(p); say('Put back.'); });
          draw();
        }, 'sm rmx');
        rm.title = 'Remove from this playlist (the song stays saved)';
        extra.push(rm);
        if (!pq) lead = h;                          // no dragging while the list is filtered
      }
      list.append(songRow(x, { num: allSongs.indexOf(x) + 1, lead, onPlay: () => playList(p.list, p, p.n, p.k, x.k), pl: extra }));
    });
    scroll.append(list);
    if (keepFocus && Date.now() < keepFocus.until) {      // keep the keyboard on the moved song's handle, even across redraws
      const g = list.querySelector('.song[data-k="' + keepFocus.k + '"] .draghandle'); if (g) setTimeout(() => g.focus(), 0);
    } else keepFocus = null;
  };

  const toggle = show => {
    const open = show == null ? panel.classList.contains('hidden') : show;
    if (open && !welcomed && !incoming && ui.tab !== 'welcome') { ui.tab = 'welcome'; ui.min = false; }
    panel.classList.toggle('hidden', !open);
    if (open) { (document.fullscreenElement || document.body).append(host); draw(); }
  };
  const isOpen = () => !panel.classList.contains('hidden');

  const addPlayerButton = () => {
    const ctl = q('.ytp-right-controls');
    if (!ctl || ctl.querySelector('.saine-wave-btn')) return;
    const b = el('button', 'ytp-button saine-wave-btn');
    b.title = 'Saine Wave ( \\ )'; b.setAttribute('aria-label', 'Saine Wave');
    b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;vertical-align:top';
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('width', '28'); s.setAttribute('height', '28');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M5 16c2.2-6.5 4.4-6.5 6.6 0s4.4 6.5 6.6 0 4.4-6.5 6.6 0');
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#eef3f8'); p.setAttribute('stroke-width', '2.6'); p.setAttribute('stroke-linecap', 'round');
    s.append(p); b.append(s);
    b.onclick = ev => { ev.stopPropagation(); toggle(); };
    ctl.prepend(b);
  };

  // "Save to Saine Wave" under the video, in YouTube's row of buttons (Like, Share, ...)
  let saveBtn = null;
  const syncSaveBtn = () => {
    if (!saveBtn) return;
    const had = wholeOf(), live = (() => { const v = V(); return v && !Number.isFinite(v.duration); })();
    saveBtn.style.display = live ? 'none' : 'inline-flex';
    const label = had ? 'Saved in Saine Wave (click to open it)' : 'Save to Saine Wave (whole video as one song)';
    saveBtn.title = label; saveBtn.setAttribute('aria-label', label);
    saveBtn.style.background = 'rgba(255,255,255,.1)';
    const mark = saveBtn.querySelector('.sw-mark'), wave = saveBtn.querySelector('.sw-wave');
    mark.setAttribute('stroke', had ? '#F5C84C' : '#A6D8F0'); mark.setAttribute('fill', had ? '#F5C84C' : 'none');
    wave.setAttribute('stroke', had ? '#1E1E24' : '#F2F4F8');
  };
  const addSaveButton = () => {
    if (location.pathname !== '/watch') return;
    const row = q('ytd-watch-metadata #top-level-buttons-computed') || q('#top-level-buttons-computed');
    if (!row) return;
    if (saveBtn && row.contains(saveBtn)) { syncSaveBtn(); return; }
    const b = el('button', 'saine-wave-save'); b.type = 'button';
    b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;margin-left:8px;padding:0;border:0;border-radius:50%;cursor:pointer;background:rgba(255,255,255,.1)';
    // YouTube's Save bookmark with Saine Wave's wave inside; the bookmark fills in once saved
    const s2 = document.createElementNS(NS, 'svg'); s2.setAttribute('viewBox', '0 0 24 24'); s2.setAttribute('width', '24'); s2.setAttribute('height', '24');
    s2.style.cssText = 'display:block;flex:none';
    const mk = (d, cls) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); e.setAttribute('class', cls);
      e.setAttribute('fill', 'none'); e.setAttribute('stroke-width', '2'); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round'); return e; };
    s2.append(mk('M6.5 3.5h11a1 1 0 0 1 1 1v16.2l-6.5-4.3-6.5 4.3V4.5a1 1 0 0 1 1-1z', 'sw-mark'), mk('M8.6 10.6c1-2.9 2.4-2.9 3.4 0s2.4 2.9 3.4 0', 'sw-wave'));
    b.append(s2);
    b.onmouseenter = () => { b.style.filter = 'brightness(1.6)'; }; b.onmouseleave = () => { b.style.filter = ''; };
    b.onclick = ev => { ev.stopPropagation(); saveWhole(); };
    row.append(b); saveBtn = b; syncSaveBtn();
  };

  // ---------- marking ----------
  let mark = null, markE = null, markVid = null;        // start/end marks belong to one video                    // the start mark belongs to one stream
  let creating = false, createNow = null;
  const updateCreateNow = () => { const v = V(); if (createNow && v) createNow.textContent = fmt(v.currentTime); };
  const startCreate = () => {
    if (!vidNow()) { say('Open a stream first.'); return; }
    if (P) stop(null);
    creating = true; mark = markE = null; openSong = null; ui.tab = 'songs'; ui.min = false; say(''); toggle(true); draw();
  };
  const cancelCreate = () => { creating = false; mark = markE = null; say(''); draw(); };
  const markStart = () => {
    const v = V(); if (!v || !vidNow()) { say('Open a video first.'); return; }
    if (adOn()) { creating = true; ui.tab = 'songs'; ui.min = false; toggle(true); draw(); say(AD_WAIT); return; }
    if (P) stop(null);
    if (markVid && markVid !== vidNow()) markE = null;
    creating = true; mark = v.currentTime; markVid = vidNow(); ui.tab = 'songs'; ui.min = false; toggle(true);
    say(markE != null && markE <= mark ? 'The start is after the end. Mark the end again.' : ''); draw();
  };
  const markEnd = () => {
    const v = V(); if (!v || !vidNow()) { say('Open a video first.'); return; }
    if (adOn()) { creating = true; ui.tab = 'songs'; ui.min = false; toggle(true); draw(); say(AD_WAIT); return; }
    if (markVid && markVid !== vidNow()) mark = null;
    creating = true; markE = v.currentTime; markVid = vidNow(); ui.tab = 'songs'; ui.min = false; toggle(true);
    say(mark != null && markE <= mark ? 'The end must be after the start (' + fmt(mark) + ').' : ''); draw();
  };
  const markFull = () => {
    const v = V(); if (!v || !vidNow()) { say('Open a video first.'); return; }
    if (adOn()) { say(AD_WAIT); return; }
    if (!Number.isFinite(v.duration) || !v.duration) { say('This video has no fixed length (it may be live). Mark the start and end instead.'); return; }
    creating = true; mark = 0; markE = Math.floor(v.duration * 10) / 10; markVid = vidNow(); say(''); draw();
  };
  const saveMarked = async () => {
    if (markVid !== vidNow()) { mark = markE = null; say('These marks were made on a different video. Mark them again on this one.'); draw(); return; }
    if (mark == null || markE == null) { say('Mark the start and the end first.'); return; }
    if (markE <= mark) { say('The end must be after the start (' + fmt(mark) + ').'); return; }
    const whole = mark < 1 && (() => { const v = V(); return v && Number.isFinite(v.duration) && Math.abs(markE - v.duration) < 2; })();
    const n = prompt('Name this song', whole ? videoTitle() : 'Song ' + (Object.keys(S).length + 1));
    if (n === null) return;
    const x = await addSong(vidNow(), n.trim() || 'Song', mark, markE, videoTitle());
    mark = markE = null; creating = false; openSong = x.k; ui.tab = 'songs'; toggle(true);
    say('Saved ' + x.n + ' (' + fmt(x.s) + ' → ' + fmt(x.e) + ').', async () => { await deleteSong(x); openSong = null; say('New song removed.'); });
    draw(); syncSaveBtn();
  };

  // the whole video as one song (music videos, covers): 0:00 to the end
  const wholeOf = () => { const v = V(), here = vidNow(); return v && here && Object.values(S).find(x => x.v === here && x.s < 1 && Number.isFinite(v.duration) && Math.abs(x.e - v.duration) < 2); };
  const saveWhole = async () => {
    const v = V(), here = vidNow();
    if (!v || !here) { say('Open a video first.'); return; }
    if (adOn()) { toggle(true); say(AD_WAIT); return; }
    if (!Number.isFinite(v.duration) || !v.duration) { ui.tab = 'songs'; ui.min = false; toggle(true); draw(); say('This video has no fixed length (it may be live). Use New song to mark the start and end.'); return; }
    const had = wholeOf();
    if (had) { openSong = had.k; ui.tab = 'songs'; ui.min = false; toggle(true); draw(); say('This video is already saved as ' + had.n + '.'); return; }
    const n = prompt('Name this song', videoTitle() || 'Song ' + (Object.keys(S).length + 1));
    if (n === null) return;
    const x = await addSong(here, n.trim() || 'Song', 0, Math.floor(v.duration * 10) / 10, videoTitle());
    mark = null; creating = false; openSong = x.k; ui.tab = 'songs'; ui.min = false; toggle(true);
    say('Saved ' + x.n + ' (whole video, ' + fmt(x.e) + ').', async () => { await deleteSong(x); openSong = null; say('Song removed.'); });
    draw(); syncSaveBtn();
  };

  // ---------- playback ----------
  // P = { mode:'one'|'list', list:[song keys], i, rep, r, g, sh, name, plk }
  let P = null, last = -1, waiting = null;
  const PLAY_KEY = 'saineWavePlay';
  const cur = () => P && S[P.list[P.i]];
  const inMix = () => location.pathname === '/watch' && new URLSearchParams(location.search).has('list');   // a YouTube Mix or playlist
  // songs that end at the very end of the video end a little early, so YouTube's Autoplay can't jump in first
  const endOf = (x, v) => Number.isFinite(v.duration) && v.duration > 0 && x.e > v.duration - 0.6 ? Math.max(x.s + 0.5, v.duration - 0.6) : x.e;
  let endedNow = false;
  document.addEventListener('ended', ev => { if (ev.target === V() && P && !waiting) { endedNow = true; tick(); } }, true);
  const seek = (v, t) => { v.currentTime = t; last = t; };
  const whenReady = (fn, tries = 0) => {
    const v = V();
    if (v && v.readyState >= 1 && vidNow() && !q('.ad-showing')) fn(v);    // wait for ads to finish, too
    else if (tries < 480) setTimeout(() => whenReady(fn, tries + 1), 250);  // up to 2 minutes (slow loads, long ads)
  };
  const stop = msg => {
    if (SY) { SY = null; setTimeout(drawSyncBar, 0); }
    P = null; setTimeout(() => updateOverlay(), 0); clearTimeout(waiting); waiting = null;
    sessionStorage.removeItem(PLAY_KEY);
    say(msg || ''); draw();
  };
  const start = () => {
    const x = cur(); if (!x) { nextSong(true); return; }
    const r = P.resume;
    const from = r && r.k === x.k && r.t >= x.s && r.t < x.e - 1 ? r.t : x.s;
    const mix = x.v === vidNow() && inMix();
    if (x.v !== vidNow() || mix) {              // song is in another video (or this one inside a Mix): open it, then carry on
      if (mix) P.note = 'mix';
      sessionStorage.setItem(PLAY_KEY, JSON.stringify(P));
      say(mix ? 'Leaving the YouTube Mix so Saine Wave can loop this song…' : 'Opening ' + x.n + '…');
      location.href = link(x, from);            // opens at the exact second (song start, or where it stopped)
      return;
    }
    delete P.resume;
    draw();                                     // show the song right away, even while the video is still loading
    const note = P.note; delete P.note;
    whenReady(v => { seek(v, from); v.play().catch(() => {}); say(note === 'mix' ? 'Left the YouTube Mix so Saine Wave can loop this song.' : ''); draw(); });
  };
  const playOne = x => { clearTimeout(waiting); waiting = null; P = { mode: 'one', list: [x.k], i: 0, rep: 1, r: 1, g: 0 }; start(); };
  const playList = (keys, o, name, plk, from) => {
    const list = keys.filter(k => S[k]);
    if (!list.length) { say('There are no songs to play.'); return; }
    clearTimeout(waiting); waiting = null;
    if (from && P && P.mode === 'list' && plk && P.plk === plk && P.list.includes(from)) {   // already playing this playlist: jump to the song
      P.i = P.list.indexOf(from); P.rep = 1; delete P.resume; start(); return;
    }
    P = { mode: 'list', list: o.sh ? shuffle([...list]) : [...list], i: 0, rep: 1, r: o.r || 1, g: o.g || 0, sh: !!o.sh, name, plk };
    if (from && P.list.includes(from)) {
      if (P.sh) { P.list = [from, ...P.list.filter(k => k !== from)]; } else P.i = P.list.indexOf(from);   // shuffled: start with it
    }
    if (plk) touchPl(plk);
    start();
  };
  const nextSong = now => {
    if (!P || P.mode !== 'list') return;
    clearTimeout(waiting); waiting = null;
    P.i++; P.rep = 1;
    if (P.i >= P.list.length) { P.i = 0; if (P.sh) shuffle(P.list); }
    if (!now && P.g) {
      const v = V(); if (v) v.pause();
      say('Next song in ' + P.g + ' seconds…'); draw();
      waiting = setTimeout(() => { waiting = null; start(); }, P.g * 1000);
    } else start();
  };
  const finishPlayback = (v, msg) => { v.pause(); seek(v, cur() ? cur().e : v.currentTime); stop(msg); };
  const prevSong = () => {
    if (!P || P.mode !== 'list') return;
    clearTimeout(waiting); waiting = null;
    const v = V(), x = cur();
    if (v && x && v.currentTime - x.s > 3) { seek(v, x.s); return; }   // like a music player: restart, then go back
    P.i = (P.i - 1 + P.list.length) % P.list.length; P.rep = 1; start();
  };

  const autoGrab = () => {
    const v = V(), here = vidNow(); if (!v || !here || v.paused || q('.ad-showing')) return;
    for (const k in S) {
      const x = S[k];
      if (x.v === here && x.f != null && !IMG[k] && Math.abs(v.currentTime - x.f) < 0.6) {
        const url = grabFrame(); if (url) { saveImg(x, url); if (isOpen()) draw(); }
      }
    }
  };
  const tick = () => {
    autoGrab();
    if (previewEnd != null && !P && !adOn()) { const v = V(); if (v && v.currentTime >= previewEnd) { v.pause(); previewEnd = null; say('Preview done.'); } }
    if (creating && isOpen()) updateCreateNow();
    if (!P || waiting) return;
    const v = V(), x = cur();
    if (!v || !x || x.v !== vidNow()) return;   // wrong video still loading
    if (q('.ad-showing')) { updateOverlay(); return; }   // let ads play, hide lyrics meanwhile
    const t = v.currentTime, jumped = Math.abs(t - last) > 2;
    last = t;
    if (t >= x.s && t < x.e) P.at = { k: x.k, t };      // where it is, so Play can continue here after leaving the stream
    if (jumped && (t < x.s - 1 || t > x.e)) { stop('Loop paused because you moved the slider.'); return; }
    const e = endOf(x, v), atEnd = t >= e || endedNow; endedNow = false;
    if (atEnd && SY && SY.k === x.k) { v.pause(); syncFinish(); return; }
    if (atEnd) {
      if (v.ended) setTimeout(() => { if (P && cur() === x) v.play().catch(() => {}); }, 0);   // the video stopped at its end: start it again
      const rp = ui.rp || 'all';
      if (P.mode === 'one') { if (rp === 'off') { finishPlayback(v, 'Finished ' + x.n + '.'); return; } seek(v, x.s); }
      else if (rp === 'one') seek(v, x.s);
      else if (P.rep < P.r) { P.rep++; seek(v, x.s); drawNow(); }
      else if (rp === 'off' && P.i >= P.list.length - 1) { finishPlayback(v, 'Finished ' + P.name + '.'); return; }
      else nextSong(false);
    } else if (t < x.s - 3) seek(v, x.s);
    if (isOpen()) drawBar();
    updateOverlay();
  };

  // ---------- keyboard shortcuts ----------
  // Sync keys are caught by early.js (loaded before YouTube's scripts); it calls in here.
  window.__saineSync = { active: () => !!SY, key: k => { const f = { ' ': syncTap, Spacebar: syncTap, Backspace: syncUndo, Enter: syncFinish, Escape: () => syncCancel() }[k]; if (f) f(); } };
  document.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const act = { '[': markStart, ']': markEnd, '\\': () => toggle() }[ev.key];
    if (!act) return;
    ev.preventDefault(); ev.stopPropagation(); act();
  }, true);

  // ---------- page events ----------
  let ready = false, handled = '';
  const onPage = async () => {
    if (!ready) return;
    addPlayerButton();
    if (handled === location.href) return;
    handled = location.href;
    if (isOpen()) draw();
    const here = vidNow();
    if ((mark != null || markE != null) && markVid !== here) {   // marks made on another video can't be used here
      mark = markE = null; markVid = null;
      if (creating) { say('You opened a different video, so the marks were cleared. Mark them again here.'); if (isOpen()) draw(); }
    }
    if (!here) return;
    let pending = null;                                   // 1) a playlist opened this video
    try { pending = JSON.parse(sessionStorage.getItem(PLAY_KEY) || 'null'); } catch (err) {}
    if (pending) {
      sessionStorage.removeItem(PLAY_KEY);
      P = pending;
      const x = cur();
      if (x && x.v === here) { toggle(true); start(); return; }
      P = null;
    }
    const sp = new URLSearchParams(location.search);
    if (sp.get('swpl')) {                                 // 2a) opened from a shared playlist link
      try {
        const d = await unpackLink(sp.get('swpl'));
        const songs = (d.s || []).map(songIn);
        if (songs.some(Boolean)) { incoming = { name: String(d.n || 'Shared playlist').slice(0, 100), songs, sh: !!d.sh, r: d.r, g: d.g }; ui.min = false; toggle(true); draw(); return; }
        throw new Error('no songs');
      } catch (err) { say('This shared playlist link looks broken.'); }
    }
    // 2b) opened from a song link
    const a = Number(sp.get('ls')), b = Number(sp.get('le'));
    if (sp.get('ls') !== null && b > a) {
      const x = findSong(here, a, b) || await addSong(here, sp.get('ln') || 'Song', a, b, '');
      const got = songIn([here, a, b, '', Number(sp.get('li')) || 0, Number(sp.get('lo')) || 0,
        (sp.get('tt') || '').split('.').filter(Boolean).map(Number), '']);
      if (got && got.li && !x.li && !x.lw && !LY[x.k]) { x.li = got.li; if (got.lo) x.lo = got.lo; if (got.tt) x.tt = got.tt; await put(x); }
      if (!x.t) whenReady(() => { setTimeout(() => { const t = videoTitle(); if (t) { x.t = t; put(x); } }, 1500); });
      toggle(true); playOne(x); return;
    }
    const x = cur();                                      // 3) moved to another video: stop quietly
    if (P && x && x.v !== here) stop(null);
    else if (P && x && inMix()) stop('A YouTube Mix started, so Saine Wave stopped its loop.');   // 4) a Mix took over this video
  };

  chrome.runtime.onMessage.addListener(m => { if (m && m.t === 'toggle') toggle(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'sync') return;
    load().then(() => { if (isOpen()) draw(); });
  });
  document.addEventListener('yt-navigate-finish', () => onPage());
  document.addEventListener('fullscreenchange', () => { if (isOpen()) (document.fullscreenElement || document.body).append(host); });
  addEventListener('resize', () => { if (isOpen()) place(); });
  document.addEventListener('play', syncPP, true); document.addEventListener('pause', syncPP, true);
  setInterval(tick, 200);
  setInterval(() => { addPlayerButton(); addSaveButton(); }, 1500);

  (async () => {
    try { const r = await local.get('ui'); if (r && r.ui) ui = { ...ui, ...r.ui }; } catch (err) {}
    await load();
    try { const r = await local.get('welcomed'); welcomed = !!(r && r.welcomed); } catch (err) {}
    await loadImgs();
    await loadLyrics();
    await loadTr();
    const n = await importOld();
    ready = true;
    if (n) { welcomed = true; local.set({ welcomed: true }).catch(() => {}); ui.tab = 'pl'; saveUi(); toggle(true); say('Imported ' + n + ' song' + (n > 1 ? 's' : '') + ' from your Loop song favorite into "My playlist".'); }
    onPage();
  })();
})();
