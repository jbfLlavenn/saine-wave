// Saine Wave — Japanese to romaji (Hepburn), using kuromoji.js for kanji readings.
(() => {
  const BASE = {
    あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
    さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
    な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
    ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
    ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
    が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
    だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
    ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
    ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa', ゔ: 'vu'
  };
  const PAIRS = {
    しゃ: 'sha', しゅ: 'shu', しょ: 'sho', しぇ: 'she', ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ちぇ: 'che',
    じゃ: 'ja', じゅ: 'ju', じょ: 'jo', じぇ: 'je', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
    ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du',
    うぃ: 'wi', うぇ: 'we', うぉ: 'wo', ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', つぁ: 'tsa', いぇ: 'ye'
  };
  for (const [k, c] of [['き', 'k'], ['に', 'n'], ['ひ', 'h'], ['み', 'm'], ['り', 'r'], ['ぎ', 'g'], ['び', 'b'], ['ぴ', 'p']])
    Object.assign(PAIRS, { [k + 'ゃ']: c + 'ya', [k + 'ゅ']: c + 'yu', [k + 'ょ']: c + 'yo' });

  const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const kanaToRomaji = kana => {
    const s = toHira(kana); let out = '', dbl = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i], two = s.slice(i, i + 2);
      if (c === 'っ') { dbl = true; continue; }
      if (c === 'ー') { const m = out.match(/[aeiou]$/); if (m) out += m[0]; continue; }
      let r = PAIRS[two]; if (r) i++; else r = BASE[c];
      if (r == null) { out += c; dbl = false; continue; }
      if (dbl) { out += r.startsWith('ch') ? 't' : r[0]; dbl = false; }
      out += r;
    }
    return out + (dbl ? '\u0001' : '');            // a trailing small tsu doubles the next word's first consonant
  };
  const hasKana = s => /[぀-ヿ]/.test(s);
  const isJapanese = s => /[぀-ヿ一-鿿]/.test(s);

  // Small words that read better joined to the word before them ("aishiteru", not "aishi te ru").
  const glue = (t, prev) => (t.pos === '助動詞' && prev && /^(動詞|形容詞|助動詞)$/.test(prev.pos)) || (t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && /^[てでば]$/.test(t.surface_form)) ||
    (t.pos === '動詞' && t.pos_detail_1 === '非自立') || t.pos_detail_1 === '接尾';
  const PARTICLE = { は: 'wa', へ: 'e', を: 'o' };
  // Words that songs almost always sing differently from the dictionary's everyday reading.
  // Keep this short: only add a word when the song reading is clearly the norm.
  const SONG_READING = { '身体': 'カラダ' };

  const lineToRomaji = (tokenizer, line) => {
    if (!isJapanese(line)) return line;
    const words = []; let prev = null;
    for (const t of tokenizer.tokenize(line)) {
      const surf = t.surface_form;
      let r;
      if (SONG_READING[surf]) r = kanaToRomaji(SONG_READING[surf]);
      else if (t.pos === '助詞' && PARTICLE[surf]) r = PARTICLE[surf];
      else if (t.reading && t.reading !== '*') r = kanaToRomaji(t.reading);
      else if (hasKana(surf)) r = kanaToRomaji(surf);
      else r = surf;
      if (/^\s+$/.test(surf)) { words.push({ r: ' ', space: true }); continue; }
      if (/^[、。！？!?,.・…「」『』（）()〜~]+$/.test(surf)) { words.push({ r: surf.replace(/[、]/g, ',').replace(/[。]/g, '.').replace(/[！]/g, '!').replace(/[？]/g, '?').replace(/[「」『』]/g, '"').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[〜]/g, '~').replace(/・/g, ' '), punct: true }); continue; }
      const last = words[words.length - 1];
      if (last && /\u0001$/.test(last.r)) last.r = last.r.slice(0, -1) + (/^ch/.test(r) ? 't' : /^[bcdfghjkmprstvz]/.test(r) ? r[0] : '');
      if (last && glue(t, prev) && !last.punct && !last.space) last.r += r;
      else words.push({ r });
      prev = t;
    }
    let out = '';
    for (const w of words) {
      if (w.space) { out = out.replace(/ $/, '') + ' '; continue; }
      if (w.punct) out = out.replace(/ $/, '') + w.r + (/[,.!?)]$/.test(w.r) ? ' ' : '');
      else out += (out && !/[ ("]$/.test(out) ? ' ' : '') + w.r;
    }
    return out.replace(/\u0001/g, '').replace(/\s+/g, ' ').trim();
  };

  let tokenizerP = null;
  const getTokenizer = () => tokenizerP || (tokenizerP = new Promise((res, rej) => {
    kuromoji.builder({ dicPath: chrome.runtime.getURL('dict/') }).build((err, tk) => (err ? (tokenizerP = null, rej(err)) : res(tk)));
  }));

  window.__saineRomaji = { kanaToRomaji, lineToRomaji, isJapanese, getTokenizer };
})();
