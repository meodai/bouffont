// The page: every title is written by bouffont (Iosevka, one preset each), plus the
// figures. The playground at the bottom is demo/main.js.
import { presets } from '../src/index.js';
import { pool } from './pool.js';
import { highlightBlocks } from './highlight.js';
// Iosevka subset to Latin (npm run fonts); woff because opentype.js can't read woff2.
import iosevkaUrl from './fonts/iosevka-400-normal.woff?url';
import interUrl from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import playfairUrl from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff?url';
import grechenUrl from '@fontsource/grechen-fuemen/files/grechen-fuemen-latin-400-normal.woff?url';
// The titles are grown from Merriweather.
import merriweatherUrl from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url';

// Every piece grows in the worker pool; the page only places the SVG.
const grow = async (opts, o) => (await pool.render({ seed: 'puff', ...opts }, o)).svg;

function svgEl(markup, label) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const svg = tpl.content.firstElementChild;
  svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
  svg.setAttribute('role', 'img');
  if (label) svg.setAttribute('aria-label', label);
  return svg;
}

// Write a piece into a heading, keeping its text for screen readers.
function place(el, text, markup) {
  const sr = document.createElement('span');
  sr.className = 'sr';
  sr.textContent = text;
  el.replaceChildren(sr, svgEl(markup));
  el.classList.remove('pending');
}

// ── Titles ─────────────────────────────────────────────────────────────────────
// Every title is grown with the settings panel's options (main.js broadcasts them),
// each with its own text. New settings cancel the titles that haven't started yet.
let titleOptions = { preset: 'throwup' }, titleFont = merriweatherUrl, titleRun, titleTimer;

// The titles' effects sit further inside the edge than in the playground (+0.2 stems).
const INSET = { shine: 0.26, shade: 0.16, inline: 0.3 }; // the library's defaults
function forTitles(options) {
  if (!options.effects?.length) return options;
  const effects = options.effects.map((e) => {
    const [name, opts = {}] = Array.isArray(e) ? e : [e, {}];
    return name in INSET ? [name, { ...opts, inset: (opts.inset ?? INSET[name]) + 0.2 }] : e;
  });
  return { ...options, effects };
}

function titles() {
  titleRun?.abort();
  const run = (titleRun = new AbortController());
  return Promise.all([...document.querySelectorAll('[data-puff]')].map(async (el) => {
    const text = (el.dataset.text ??= el.textContent.trim());
    if (!el.querySelector('svg')) el.classList.add('pending');
    try {
      const markup = await grow({ ...forTitles(titleOptions), text, font: titleFont }, { signal: run.signal });
      if (!run.signal.aborted) place(el, text, markup);
    } catch {
      // aborted by newer settings, or half-typed options in the playground code
    }
  }));
}

addEventListener('bouffont:settings', (e) => {
  titleOptions = e.detail.options;
  titleFont = e.detail.fontUrl;
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => (titles(), favicon()), 120);
});

// The favicon: "ff" grown with the same settings, filled in the page colour with black
// outlines, on a transparent background.
let faviconRun = 0;
async function favicon() {
  const run = ++faviconRun;
  let markup;
  try {
    markup = await grow({ ...forTitles(titleOptions), text: 'ff', font: titleFont });
  } catch {
    return;
  }
  if (run !== faviconRun) return;
  // The page colour (--bg) as plain rgb, read back from a painted pixel: safe in any
  // favicon, whatever colour syntax the CSS uses.
  const paint = document.createElement('canvas').getContext('2d');
  paint.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff';
  paint.fillRect(0, 0, 1, 1);
  const [r, g, b] = paint.getImageData(0, 0, 1, 1).data;
  const fill = `rgb(${r} ${g} ${b})`;
  const icon = markup
    .replace(/(data-part="fill"[^>]*?)fill="[^"]*"/g, `$1fill="${fill}"`)
    // Square, so it fills the tab icon without being stretched.
    .replace(/\swidth="[^"]*"\sheight="[^"]*"/, ' width="64" height="64" preserveAspectRatio="xMidYMid meet"');
  document.querySelector('link[rel="icon"]').href = `data:image/svg+xml,${encodeURIComponent(icon)}`;
}

// ── Figures ────────────────────────────────────────────────────────────────────
function figure(markup, caption) {
  const fig = document.createElement('figure');
  fig.append(svgEl(markup, caption));
  if (caption) {
    const cap = document.createElement('figcaption');
    cap.textContent = caption;
    fig.append(cap);
  }
  return fig;
}

async function fonts() {
  const el = document.querySelector('[data-fonts]');
  const list = [['Inter', interUrl], ['Playfair Display', playfairUrl], ['Grechen Fuemen', grechenUrl]];
  const pieces = await Promise.all(list.map(([, font]) => grow({ text: 'Hand', font, preset: 'throwup' })));
  el.append(...pieces.map((markup, i) => figure(markup, list[i][0])));
}

const ABOUT = {
  throwup: 'One fat, even swell; letters overlap in a stack.',
  bubbles: 'Circles packed along each letter, grown and merged into lumps.',
  bubble: 'Letters grow until they lock together, wrapped in one outline.',
  block: 'A square pen, heavy blocks with cut corners, filling a rectangle.',
  simple: 'Edges at 0, 45 and 90 degrees only.',
  crowd: 'The font’s own outlines, swollen, packed tight and split into shared seams.',
  candy: 'Glossy and chubby: swollen, smoothed, packed tight, with depth, inline and shine.',
  marquee: 'An arched sign: knitted, pressed into seams, with an inline and a shine.',
  coral: 'Differential line growth: the outline wrinkles as it grows.',
  frost: 'Diffusion-limited aggregation: particles freeze onto the letters.',
};

function presetList() {
  const el = document.querySelector('[data-presets]');
  for (const name of Object.keys(presets)) {
    const sec = document.createElement('section');
    // Each preset's name, written in that preset (not following the settings).
    const h3 = document.createElement('h3');
    h3.className = 'preset-name pending';
    h3.dataset.preset = name;
    h3.textContent = name;
    // Clicking a preset's name picks it in the settings (the playground and titles follow).
    h3.tabIndex = 0;
    h3.setAttribute('role', 'button');
    h3.title = `use ${name}`;
    const pick = () => {
      const select = document.getElementById('preset');
      select.value = name;
      select.dispatchEvent(new Event('change'));
    };
    h3.addEventListener('click', pick);
    h3.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      pick();
    });
    const p = document.createElement('p');
    p.textContent = ABOUT[name] ?? '';
    sec.append(h3, p);
    el.append(sec);
  }
}

function samples() {
  return Promise.all([...document.querySelectorAll('[data-preset]')].map(async (el) => {
    const name = el.dataset.preset;
    place(el, name, await grow({ text: name, preset: name, font: merriweatherUrl }));
  }));
}

// Every part is yours: per-letter fills ink up in a wave; hovering pins a letter.
async function parts() {
  const el = document.querySelector('[data-parts]');
  // Letters pressed into each other, so it reads as one word.
  const piece = await pool.render({ text: 'bouffont', font: iosevkaUrl, seed: 'puff', preset: 'bubbles', tracking: -0.6, effects: [['inline', {}], ['shine', {}]] });
  const { svg, letters } = piece.dom();
  svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'bouffont, letters inking up one after another');
  letters.forEach(({ group, fill, lines }, i) => {
    const delay = i * 140;
    for (const part of [group, fill, lines]) part?.style.setProperty('animation-delay', `${delay}ms`);
    // The effects: take the letter's movement out, replay it 70 ms later (+ the ink).
    for (const part of group.querySelectorAll('[data-part="inline"], [data-part="shine"]')) {
      part.style.setProperty('animation-delay', `${delay}ms, ${delay + 70}ms, ${delay}ms`);
    }
    group.addEventListener('pointerenter', () => group.classList.toggle('inked'));
  });
  el.replaceChildren(svg);
  // The jump: 12% of each letter's height, as a length (its effects move half of it).
  for (const { group } of letters) group.style.setProperty('--lift', `${group.getBBox().height * 0.12}px`);
}

// Words in the text are controls: they set the playground's settings (so the
// playground and every title regrow) and follow the settings panel in turn.
//   role="radio"  data-control="preset" data-value="block"     one of many
//   role="switch" data-control="repel" data-on="on" data-off="off"   on / off
//   <select data-mirror="font">                                  a dropdown
// Size a select to its chosen option where `field-sizing: content` isn't supported.
function fitSelect(sel) {
  if (CSS.supports('field-sizing', 'content')) return;
  const probe = document.createElement('span');
  const cs = getComputedStyle(sel);
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`;
  probe.textContent = sel.selectedOptions[0]?.textContent ?? '';
  document.body.append(probe);
  sel.style.width = `calc(${probe.getBoundingClientRect().width}px + 1em)`;
  probe.remove();
}

function toggles() {
  const $ = (id) => document.getElementById(id);
  const set = (id, value) => {
    const el = $(id);
    el.value = value;
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
  };
  const words = [...document.querySelectorAll('[data-toggles] .toggle')];
  const mirrors = [...document.querySelectorAll('[data-mirror]')];
  const sync = () => {
    for (const w of words) {
      const value = $(w.dataset.control).value;
      const on = w.dataset.value != null ? value === w.dataset.value : String(Number(value) || value) !== String(Number(w.dataset.off) || w.dataset.off);
      w.setAttribute('aria-checked', on);
      w.toggleAttribute('aria-disabled', $(w.dataset.control).disabled);
    }
    for (const m of mirrors) {
      const src = $(m.dataset.mirror);
      if (m.options.length !== src.options.length) m.innerHTML = src.innerHTML; // filled late
      m.value = src.value;
      fitSelect(m);
    }
  };
  const act = (e) => {
    const w = e.target.closest('.toggle');
    if (!w || $(w.dataset.control).disabled) return; // the setting has no effect right now
    if (e.type === 'keydown') {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
    }
    if (w.dataset.value != null) set(w.dataset.control, w.dataset.value);
    else set(w.dataset.control, w.getAttribute('aria-checked') === 'true' ? w.dataset.off : w.dataset.on);
    sync();
  };
  // Spans, not buttons, so the phrases wrap like the words around them.
  for (const p of document.querySelectorAll('[data-toggles]')) {
    p.addEventListener('click', act);
    p.addEventListener('keydown', act);
  }
  for (const m of mirrors) {
    m.addEventListener('change', () => { set(m.dataset.mirror, m.value); sync(); });
    // The playground fills its lists in its own script, maybe after this one ran.
    new MutationObserver(sync).observe($(m.dataset.mirror), { childList: true });
  }
  addEventListener('bouffont:settings', sync);
  sync();
}

async function effectExamples() {
  const el = document.querySelector('[data-effects]');
  const list = ['shine', 'shade', 'depth', 'inline'];
  const pieces = await Promise.all(list.map((e) => grow({ text: 'fx', font: iosevkaUrl, preset: 'throwup', effects: [[e, {}]] })));
  el.append(...pieces.map((markup, i) => figure(markup, list[i])));
}

async function generations() {
  const el = document.querySelector('[data-generations]');
  const steps = [0, 0.5, 1];
  const pieces = await Promise.all(steps.map((overgrow) => grow({ text: 'grow', font: iosevkaUrl, preset: 'coral', overgrow })));
  el.append(...pieces.map((markup, i) => figure(markup, `keep growing ${steps[i]}`)));
}

highlightBlocks();

// The settings panel drives the titles and the playground. It floats in once the
// playground is in view and stays (like heerich).
const $settings = document.getElementById('settings');
if (matchMedia('(max-width: 800px)').matches) $settings.removeAttribute('open');
const $pgSection = document.querySelector('.pg');
const showSettings = () => {
  if ($pgSection.getBoundingClientRect().top < innerHeight * 0.85) {
    $settings.classList.add('visible');
    removeEventListener('scroll', showSettings);
  }
};

// Titles first (visible at once), then the figures; the pool grows them in parallel.
presetList();
toggles();
const titlesDone = titles();
favicon();
const rest = Promise.all([samples(), parts(), fonts(), generations(), effectExamples()]);
await titlesDone;
// Only now does the page have its real height.
addEventListener('scroll', showSettings, { passive: true });
showSettings();
await rest;
