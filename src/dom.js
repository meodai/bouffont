// DOM references for a rendered piece: the SVG element plus its fills, outlines and
// lines, overall and per letter. Each call builds new elements from `piece.svg`.
// Works wherever a DOM exists (the browser, or a document from jsdom / happy-dom).
export function toDOM(svg, doc = globalThis.document) {
  if (!doc) throw new Error('bouffont: dom() needs a document (pass one in Node, e.g. from jsdom)');
  const tpl = doc.createElement('template');
  tpl.innerHTML = svg.trim();
  const el = tpl.content.firstElementChild;
  const all = (part, root = el) => [...root.querySelectorAll(`[data-part="${part}"]`)];
  const letters = all('letter').map((group) => ({
    char: group.dataset.char ?? null,
    index: group.dataset.index === 'all' ? 'all' : Number(group.dataset.index),
    group,
    fill: group.querySelector('[data-part="fill"]'),
    outline: group.querySelector('[data-part="outline"]'),
    lines: group.querySelector('[data-part="lines"]'),
    ink: group.querySelector('[data-part="ink"]'),
  }));
  // Letters are drawn in stacking order; list them in text order.
  letters.sort((a, b) => (a.index === 'all' ? 0 : a.index) - (b.index === 'all' ? 0 : b.index));
  const band = el.querySelector('[data-part="band"]');
  const fills = all('fill');
  // The outer outline around the whole piece (render.outline) counts as an outline too.
  const outlines = [...(band ? [band] : []), ...all('outline')];
  const lines = all('lines');
  return {
    svg: el,
    letters,
    fills,
    outlines,
    lines,
    strokes: [...outlines, ...lines], // everything drawn with the pen
    band,
    extras: all('extra'),
  };
}
