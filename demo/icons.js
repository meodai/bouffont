// Little line icons for the options of the panel's dropdowns (customizable selects).
// Browsers without customizable selects strip them and show the plain names.
import { envelopes } from '../src/index.js';

const W = 22, H = 14;
const svg = (body, w = W, h = H) =>
  `<svg viewBox="-1 -1 ${w + 2} ${h + 2}" width="${w + 2}" height="${h + 2}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const f = (n) => Math.round(n * 10) / 10;

// The envelope's outline, sampled from its profile.
export function envelopeIcon(type) {
  if (type === '(preset)') return svg(''); // blank, so the names line up
  if (type === 'none') return svg(`<rect x="0" y="0" width="${W}" height="${H}" stroke-dasharray="2 2.5"/>`);
  const profile = envelopes[type];
  if (!profile) return '';
  const opts = { minHeight: 0.4, skew: type === 'parallelogram' ? 0.35 : 0 };
  const n = 24, top = [], bottom = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, [t, b] = profile(u, opts);
    const x = u * W * (1 - opts.skew);
    top.push(`${f(x + opts.skew * W * (1 - t))},${f(t * H)}`);
    bottom.push(`${f(x + opts.skew * W * (1 - b))},${f(b * H)}`);
  }
  return svg(`<path d="M${top.join('L')}L${bottom.reverse().join('L')}Z"/>`);
}

// Three letters standing on, hanging from or floating between the lines.
export function alignIcon(mode) {
  const bars = [[2, 6], [9, 3], [16, 5]]; // x, height
  const y = (h) => (mode === 'top' ? 2 : mode === 'bottom' ? H - 2 - h : mode === 'both' ? 2 : (H - h) / 2);
  const len = (h) => (mode === 'both' ? H - 4 : h);
  const body = bars.map(([x, h]) => `<rect x="${x}" y="${f(y(h))}" width="4" height="${f(len(h))}"/>`).join('');
  const line = (yy) => `<path d="M0 ${yy}H${W}"/>`;
  const lines = mode === 'top' ? line(0) : mode === 'bottom' ? line(H) : mode === 'both' ? line(0) + line(H) : '';
  return svg(body + lines);
}

// Three overlapping letters; the one drawn last is on top.
export function orderIcon(order) {
  const seq = { ltr: [0, 1, 2], rtl: [2, 1, 0], center: [0, 2, 1], edges: [1, 0, 2], random: [1, 2, 0] }[order] ?? [0, 1, 2];
  const circles = seq.map((i) => `<circle cx="${5 + i * 6}" cy="${H / 2}" r="5" fill="var(--paper, #fff)"/>`).join('');
  return svg(circles);
}

// Zigzag: back and forth; loop: a circle with its arrowhead along the circle.
export function repeatIcon(mode) {
  if (mode === 'zigzag') {
    return svg(`<path d="M2 ${H / 2}H${W - 2}M${W - 6} ${H / 2 - 4}L${W - 2} ${H / 2}L${W - 6} ${H / 2 + 4}M6 ${H / 2 - 4}L2 ${H / 2}L6 ${H / 2 + 4}"/>`);
  }
  const cx = W / 2, cy = H / 2, r = 5.5, deg = Math.PI / 180;
  const at = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const a0 = -60 * deg, a1 = 240 * deg; // clockwise, leaving a gap at the top
  const [x0, y0] = at(a0), [x1, y1] = at(a1);
  // The arrowhead points along the circle at its end (clockwise tangent).
  const tx = -Math.sin(a1), ty = Math.cos(a1), head = 3.2;
  const wing = (s) => {
    const c = Math.cos(s * 32 * deg), sn = Math.sin(s * 32 * deg);
    return `${f(x1 - head * (tx * c - ty * sn))},${f(y1 - head * (tx * sn + ty * c))}`;
  };
  return svg(`<path d="M${f(x0)},${f(y0)}A${r} ${r} 0 1 1 ${f(x1)},${f(y1)}"/><path d="M${wing(1)}L${f(x1)},${f(y1)}L${wing(-1)}"/>`);
}

/**
 * Options with an icon, for a customizable select. The <button><selectedcontent>
 * opts in (the closed field shows the plain name); older browsers ignore it.
 * items: [{ value, label, icon?, style? }]
 */
export const richOptions = (items) =>
  '<button><selectedcontent></selectedcontent></button>' +
  items.map(({ value, label = value, icon = '', style = '' }) =>
    `<option value="${value}"${style ? ` style="${style}"` : ''}><span class="opt-icon" aria-hidden="true">${icon}</span><span class="opt-label">${label}</span></option>`).join('');
