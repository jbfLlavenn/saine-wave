// Saine Wave — loads before YouTube's own scripts so that, while you're syncing lyrics,
// Space / Backspace / Enter / Esc reach Saine Wave first and never reach YouTube.
(() => {
  const KEYS = { ' ': 1, Spacebar: 1, Backspace: 1, Enter: 1, Escape: 1 };
  const handler = ev => {
    const sw = window.__saineSync;
    if (!sw || !sw.active() || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!(KEYS[ev.key] || ev.code === 'Space')) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (ev.type === 'keydown' && !ev.repeat) sw.key(ev.code === 'Space' ? ' ' : ev.key);
  };
  for (const type of ['keydown', 'keyup', 'keypress']) addEventListener(type, handler, true);
})();
