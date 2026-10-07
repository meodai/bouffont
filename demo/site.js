// The page: every title is written by bouffont (Iosevka, one preset each), plus the
// figures. The playground at the bottom is demo/main.js.
import { bouffont, loadFont, presets } from '../src/index.js';
import { highlightBlocks } from './highlight.js';
// Iosevka subset to Latin (npm run fonts); woff because opentype.js can't read woff2.
import iosevkaUrl from './fonts/iosevka-400-normal.woff?url';
import interUrl from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import playfairUrl from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff?url';
import grechenUrl from '@fontsource/grechen-fuemen/files/grechen-fuemen-latin-400-normal.woff?url';
// The titles are grown from Merriweather.
import merriweatherUrl from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url';

const fontCache = {};
const font = (url) => (fontCache[url] ??= loadFont(url));
// Let the browser breathe between pieces: each one takes a few to ~100 ms.
const idle = () => new Promise((r) => (window.requestIdleCallback ?? setTimeout)(r));

function svgEl(markup, label) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const svg = tpl.content.firstElementChild;
  svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
  svg.setAttribute('role', 'img');
  if (label) svg.setAttribute('aria-label', label);
  return svg;
}

const piece = async (opts) => bouffont({ font: await font(iosevkaUrl), seed: 'puff', ...opts }).svg;

// ── Titles ─────────────────────────────────────────────────────────────────────
// Every title is grown with the settings panel's options (main.js broadcasts them),
// each with its own text. Redrawn shortly after the settings stop changing.
const TITLE_DEFAULTS = { preset: 'throwup', seed: 'puff' };
let titleOptions = TITLE_DEFAULTS, titleFont = merriweatherUrl, titleRun = 0, titleTimer;

async function titles() {
  const run = ++titleRun;
  for (const el of document.querySelectorAll('[data-puff]')) {
    const text = el.dataset.text ?? el.textContent.trim();
    el.dataset.text = text;
    if (!el.querySelector('svg')) el.classList.add('pending');
    await idle();
    if (run !== titleRun) return; // newer settings arrived: start over with those
    let markup;
    try {
      markup = bouffont({ ...titleOptions, text, font: await font(titleFont) }).svg;
    } catch {
      continue; // e.g. half-typed options in the playground code
    }
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = text;
    el.replaceChildren(sr, svgEl(markup));
    el.classList.remove('pending');
  }
}

addEventListener('bouffont:settings', (e) => {
  titleOptions = e.detail.options;
  titleFont = e.detail.fontUrl;
  clearTimeout(titleTimer);
  titleTimer = setTimeout(titles, 250);
});

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
  for (const [name, url] of [['Inter', interUrl], ['Playfair Display', playfairUrl], ['Grechen Fuemen', grechenUrl]]) {
    await idle();
    const markup = bouffont({ text: 'Hand', font: await font(url), seed: 'puff', preset: 'throwup' }).svg;
    el.append(figure(markup, name));
  }
}

const ABOUT = {
  throwup: 'One fat, even swell; letters overlap in a stack.',
  bubbles: 'Circles packed along each letter, grown and merged into lumps.',
  bubble: 'Letters grow until they lock together, wrapped in one outline.',
  block: 'A square pen, heavy blocks with cut corners, filling a rectangle.',
  simple: 'Edges at 0, 45 and 90 degrees only.',
  coral: 'Differential line growth: the outline wrinkles as it grows.',
  frost: 'Diffusion-limited aggregation: particles freeze onto the letters.',
};

async function presetList() {
  const el = document.querySelector('[data-presets]');
  for (const name of Object.keys(presets)) {
    const sec = document.createElement('section');
    // Each preset's name, written in that preset (not following the settings).
    const h3 = document.createElement('h3');
    h3.className = 'preset-name pending';
    h3.dataset.preset = name;
    h3.textContent = name;
    const p = document.createElement('p');
    p.textContent = ABOUT[name] ?? '';
    sec.append(h3, p);
    el.append(sec);
  }
}

async function samples() {
  for (const el of document.querySelectorAll('[data-preset]')) {
    await idle();
    const name = el.dataset.preset;
    const markup = bouffont({ text: name, preset: name, seed: 'puff', font: await font(merriweatherUrl) }).svg;
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = name;
    el.replaceChildren(sr, svgEl(markup));
    el.classList.remove('pending');
  }
}

// Every part is yours: per-letter fills ink up in a wave; hovering pins a letter.
async function parts() {
  const el = document.querySelector('[data-parts]');
  const piece = bouffont({ text: 'bouffont', font: await font(iosevkaUrl), seed: 'puff', preset: 'bubbles' });
  const { svg, letters } = piece.dom();
  svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'bouffont, letters inking up one after another');
  letters.forEach(({ group, fill, lines }, i) => {
    for (const part of [fill, lines]) part?.style.setProperty('animation-delay', `${i * 140}ms`);
    group.addEventListener('pointerenter', () => group.classList.toggle('inked'));
  });
  el.replaceChildren(svg);
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
  for (const m of mirrors) m.innerHTML = $(m.dataset.mirror).innerHTML;
  const sync = () => {
    for (const w of words) {
      const value = $(w.dataset.control).value;
      const on = w.dataset.value != null ? value === w.dataset.value : String(Number(value) || value) !== String(Number(w.dataset.off) || w.dataset.off);
      w.setAttribute('aria-checked', on);
    }
    for (const m of mirrors) {
      m.value = $(m.dataset.mirror).value;
      fitSelect(m);
    }
  };
  const act = (e) => {
    const w = e.target.closest('.toggle');
    if (!w) return;
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
  for (const m of mirrors) m.addEventListener('change', () => { set(m.dataset.mirror, m.value); sync(); });
  addEventListener('bouffont:settings', sync);
  sync();
}

async function generations() {
  const el = document.querySelector('[data-generations]');
  for (const og of [0, 0.5, 1]) {
    await idle();
    el.append(figure(await piece({ text: 'grow', preset: 'block', overgrow: og }), `keep growing ${og}`));
  }
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

// Titles first (visible at once), then the figures.
await presetList();
await titles();
// Only now does the page have its real height.
addEventListener('scroll', showSettings, { passive: true });
showSettings();
toggles();
await samples();
await parts();
await fonts();
await generations();
