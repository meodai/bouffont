// Tiny highlighter for the code on the page and in the playground: comments,
// strings, keywords, numbers, object keys and punctuation, as spans.
const TOKENS = /(\/\/[^\n]*)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(import|from|const|let|var|await|async|return|new|true|false|null|undefined|npm|install)\b|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*:)|([{}[\](),;.:=])/g;
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function highlightCode(src) {
  let out = '', last = 0;
  for (const m of src.matchAll(TOKENS)) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'kw' : m[4] ? 'num' : m[5] ? 'key' : 'pun';
    out += `<span class="t-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

// Highlight static code blocks in place.
export function highlightBlocks(selector = 'pre.code code') {
  for (const el of document.querySelectorAll(selector)) el.innerHTML = highlightCode(el.textContent);
}
