import { bouffontLive, loadFont, presets, envelopes, obstructions, geom } from "../src/index.js";
import { pool } from "./pool.js";
import iosevkaUrl from "./fonts/iosevka-400-normal.woff?url";
import { highlightCode } from "./highlight.js";
import { dial } from "./dial.js";
import { alignIcon, envelopeIcon, obstructionIcon, orderIcon, repeatIcon, richOptions } from "./icons.js";

const files = {
  ...import.meta.glob(
    [
      "../node_modules/@fontsource/*/files/*-latin-400-normal.woff",
      "!../node_modules/@fontsource/iosevka/files/*",
    ],
    {
      query: "?url",
      import: "default",
      eager: true,
    },
  ),
  // Iosevka, the site's own font, as a small Latin subset (npm run fonts).
  "../node_modules/@fontsource/iosevka/files/iosevka-latin-400-normal.woff":
    iosevkaUrl,
};
const SKIP = ["Archivo Black"];
const FIRST = ["Inter"]; // the default
const rank = (name) => FIRST.indexOf(name) + 1 || 99;
const fontFile = (path) => path.split("/").pop();
const fonts = Object.fromEntries(
  Object.entries(files)
    .map(([path, url]) => [
      path
        .match(/@fontsource\/([^/]+)\//)[1]
        .replace(/(^|-)(\w)/g, (_, d, c) => (d ? " " : "") + c.toUpperCase()),
      { url, file: fontFile(path) },
    ])
    .filter(([name]) => !SKIP.includes(name))
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)),
);
const $ = (id) => document.getElementById(id);

// Dropdowns with an icon per option (customizable selects; plain names elsewhere).
// Fonts are named in their own face; presets show an "a" grown in that preset.
$("font").innerHTML = richOptions(Object.keys(fonts).map((value) => ({ value, style: `font-family: 'bf ${value}', ui-monospace, monospace` })));
$("preset").innerHTML = richOptions(Object.keys(presets).map((value) => ({ value })));
$("envelope").innerHTML = richOptions(["(preset)", "none", ...Object.keys(envelopes)].map((value) => ({ value, icon: envelopeIcon(value) })));
$("obstructions").innerHTML = richOptions(["none", ...Object.keys(obstructions)].map((value) => ({ value, icon: obstructionIcon(value) })));
$("align").innerHTML = richOptions(["middle", "bottom", "top", "both"].map((value) => ({ value, icon: alignIcon(value) })));
$("order").innerHTML = richOptions(Object.entries({ ltr: "normal", rtl: "reverse", center: "center", edges: "edges", random: "random" })
  .map(([value, label]) => ({ value, label, icon: orderIcon(value) })));
$("playMode").innerHTML = richOptions(["zigzag", "loop"].map((value) => ({ value, icon: repeatIcon(value) })));
// The light as a dial (it drives the hidden #light slider).
const lightDial = dial($("light"));

// Each font's own face, for its option (loaded when the page is idle).
(window.requestIdleCallback ?? setTimeout)(() => {
  for (const [name, { url }] of Object.entries(fonts)) {
    new FontFace(`bf ${name}`, `url(${url})`).load().then((face) => document.fonts.add(face), () => {});
  }
});
// The preset icons: a small "a" in each preset, grown in the worker pool.
(window.requestIdleCallback ?? setTimeout)(() => {
  for (const preset of Object.keys(presets)) {
    pool.render({ text: "a", preset, seed: "puff", font: fonts[fontName].url }).then(({ svg }) => {
      const slot = $("preset").querySelector(`option[value="${CSS.escape(preset)}"] .opt-icon`);
      if (slot) slot.innerHTML = svg;
    }, () => {});
  }
});

// ── State ────────────────────────────────────────────────────────────────────────
// What the code panel shows: the preset's full recipe (editable, on top) and the
// options passed to bouffont(): text, seed, the spread recipe and your changes.
// Defaults match the page titles: Merriweather, throwup.
let fontName = fonts.Merriweather ? "Merriweather" : Object.keys(fonts)[0];
let presetName = Object.keys(presets)[0];
let recipe = structuredClone(presets[presetName]);
let overrides = { text: "sale petit\nbouffont", seed: "puff" };
const NESTED = ["render", "structure"];

// Library defaults for options a recipe may leave out.
const DEFAULTS = {
  align: "middle",
  lineHeight: 1,
  overgrow: 0,
  density: 0,
  repel: false,
  knit: 0,
  smooth: 0,
  tracking: 0,
};
const RENDER_DEFAULTS = { order: "ltr", curves: 0, fair: 0, ink: 0, inner: 0.5 };
const GAP_INK = 0.4; // the gap lines switch turns them on at this width (stems)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const asObj = (v) => (v && typeof v === "object" ? v : {});

function effective() {
  const e = { ...recipe, ...overrides };
  for (const k of NESTED)
    if (overrides[k]) e[k] = { ...asObj(recipe[k]), ...overrides[k] };
  return e;
}
const value = (key) => effective()[key] ?? DEFAULTS[key];
const renderValue = (key) => effective().render?.[key] ?? RENDER_DEFAULTS[key];

function set(key, v) {
  if (same(v, recipe[key] ?? DEFAULTS[key])) delete overrides[key];
  else overrides[key] = v;
}
function setNested(group, key, v, defaults = {}) {
  const o = { ...(overrides[group] ?? {}) };
  if (same(v, asObj(recipe[group])[key] ?? defaults[key])) delete o[key];
  else o[key] = v;
  if (Object.keys(o).length) overrides[group] = o;
  else delete overrides[group];
}
const setRender = (key, v) => setNested("render", key, v, RENDER_DEFAULTS);
const follow = () => asObj(effective().structure).follow ?? 0;
const skeletonOn = () => effective().structure !== false;
// Follow thickness drives the skeleton pen, so it only applies with the skeleton on.
const setFollow = (v) => {
  if (skeletonOn()) setNested("structure", "follow", v || undefined);
};

// ── Code panel ───────────────────────────────────────────────────────────────────
const str = (s) =>
  `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : str(k));
function toJs(v, indent = "") {
  if (typeof v === "string") return str(v);
  if (v == null || typeof v !== "object") return String(v);
  const inner = indent + "  ";
  const parts = Array.isArray(v)
    ? v.map((x) => toJs(x, inner))
    : Object.entries(v).map(([k, x]) => `${key(k)}: ${toJs(x, inner)}`);
  const open = Array.isArray(v) ? "[" : "{",
    close = Array.isArray(v) ? "]" : "}";
  const line = Array.isArray(v)
    ? `[${parts.join(", ")}]`
    : `{ ${parts.join(", ")} }`;
  if (!parts.length) return open + close;
  if (line.length + indent.length < 76 && !line.includes("\n")) return line;
  return `${open}\n${parts.map((p) => inner + p).join(",\n")},\n${indent}${close}`;
}
const varName = () =>
  /^[A-Za-z_$][\w$]*$/.test(presetName) ? presetName : "recipe";

function code() {
  const name = varName();
  const { text, seed, ...rest } = overrides;
  const body = [
    `text: ${str(text ?? "")}`,
    "font",
    `seed: ${toJs(seed ?? 1)}`,
    `...${name}`,
    ...Object.entries(rest).map(([k, v]) =>
      NESTED.includes(k) &&
      recipe[k] &&
      typeof recipe[k] === "object" &&
      v &&
      typeof v === "object"
        ? `${key(k)}: { ...${name}.${k}, ${toJs(v).replace(/^\{ ?|\s*\}$/g, "")} }`
        : `${key(k)}: ${toJs(v, "  ")}`,
    ),
  ];
  return `import { bouffont, loadFont } from 'bouffont';

const font = await loadFont('fonts/${fonts[fontName].file}'); // ${fontName}

// The ${presetName} preset in full (same as presets.${presetName}): edit it freely.
const ${name} = ${toJs(recipe)};

const piece = bouffont({
${body.map((l) => `  ${l},`).join("\n")}
});

document.body.innerHTML = piece.svg;
`;
}

// Run the edited code with stand-ins for the library, to read back the recipe object
// and the options passed to bouffont(). A playground on your own machine: plain JS.
const AsyncFunction = (async () => {}).constructor;
async function parseCode(src) {
  const name = varName();
  let opts = null,
    file = null;
  const body =
    src.replace(/^\s*import\s[^;]*;?\s*$/gm, "") +
    `\n;return typeof ${name} === 'undefined' ? undefined : ${name};`;
  const run = new AsyncFunction(
    "bouffont",
    "loadFont",
    "presets",
    "document",
    body,
  );
  const found = await run(
    (o) => {
      opts = o;
      return { svg: "", letters: [] };
    },
    async (f) => {
      file = String(f);
      return "__font__";
    },
    presets,
    { body: {} },
  );
  if (!opts || typeof opts !== "object")
    throw new Error("bouffont() was not called with an options object");
  const base = found && typeof found === "object" ? found : {};
  const { font, text, seed, ...rest } = opts;
  const diff = { text, seed };
  for (const [k, v] of Object.entries(rest)) {
    if (
      NESTED.includes(k) &&
      v &&
      typeof v === "object" &&
      base[k] &&
      typeof base[k] === "object"
    ) {
      const sub = {};
      for (const [sk, sv] of Object.entries(v))
        if (!same(sv, base[k][sk])) sub[sk] = sv;
      if (Object.keys(sub).length) diff[k] = sub;
    } else if (!same(v, base[k])) diff[k] = v;
  }
  const fname =
    file && Object.keys(fonts).find((n) => file.endsWith(fonts[n].file));
  return { recipe: base, overrides: diff, fontName: fname ?? fontName };
}

// ── Controls ⇄ state ─────────────────────────────────────────────────────────────
// Effects: the shine is `effects: [['shine', { angle }]]`.
// Effects, kept in this order (depth is drawn behind the letters anyway); all but
// inline follow the light. Options set in the code panel are kept.
const EFFECTS = ["depth", "shade", "inline", "shine"];
const LIT = ["depth", "shade", "shine"];
const effectOpts = (name) => {
  const e = (effective().effects ?? []).find((x) => (Array.isArray(x) ? x[0] : x?.type ?? x) === name);
  return e ? (Array.isArray(e) ? e[1] ?? {} : typeof e === "string" ? {} : e) : null;
};
const lightAngle = () => LIT.map(effectOpts).find((o) => o?.angle != null)?.angle ?? Number($("light").value);
function setEffect(name, on) {
  const list = EFFECTS.flatMap((n) => {
    // A newly switched-on effect takes the current light and, once set, the inset.
    const setInsetNow = INSET.map(effectOpts).find((o) => o?.inset != null)?.inset;
    const opts = n === name
      ? (on ? { ...(LIT.includes(n) ? { angle: lightAngle() } : {}), ...(INSET.includes(n) && setInsetNow != null ? { inset: setInsetNow } : {}) } : null)
      : effectOpts(n);
    return opts ? [[n, opts]] : [];
  });
  set("effects", list.length ? list : undefined);
}
// Change one effect's options (undefined removes an option).
const setEffectOpts = (name, changes) => {
  const list = EFFECTS.flatMap((n) => {
    let opts = effectOpts(n);
    if (opts && n === name) {
      opts = { ...opts, ...changes };
      for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
    }
    return opts ? [[n, opts]] : [];
  });
  if (list.length) set("effects", list);
};
// Inset: how far inside the edge shine, shade and inline sit; one value for all three
// (until it is set, each keeps its own default).
const INSET = ["shine", "shade", "inline"];
const insetValue = () => INSET.map(effectOpts).find((o) => o?.inset != null)?.inset ?? 0.26;
const setInset = (inset) => {
  const list = EFFECTS.flatMap((n) => {
    const opts = effectOpts(n);
    return opts ? [[n, INSET.includes(n) ? { ...opts, inset } : opts]] : [];
  });
  if (list.length) set("effects", list);
};
const setLight = (angle) => {
  const list = EFFECTS.flatMap((n) => {
    const opts = effectOpts(n);
    return opts ? [[n, LIT.includes(n) ? { ...opts, angle } : opts]] : [];
  });
  if (list.length) set("effects", list);
};

const sliders = {
  lineHeight: {
    get: () => value("lineHeight"),
    set: (v) => set("lineHeight", v),
    fmt: 2,
  },
  tracking: {
    get: () => value("tracking"),
    set: (v) => set("tracking", v),
    fmt: 2,
  },
  overgrow: {
    get: () => value("overgrow"),
    set: (v) => set("overgrow", v),
    fmt: 2,
  },
  density: {
    get: () => value("density"),
    set: (v) => set("density", v),
    fmt: 2,
  },
  follow: { get: follow, set: setFollow, fmt: 1 },
  // How far inside the edge shine, shade and inline sit (stems).
  fxInset: {
    get: () => insetValue(),
    set: (v) => setInset(v),
    fmt: 2,
  },
  // Light direction of the shine (degrees; only with shine on).
  light: {
    get: () => lightAngle(),
    set: (v) => setLight(v),
    fmt: 0,
    pad: 3, // 045, 225: the number keeps its width
  },
  smooth: {
    get: () =>
      typeof value("smooth") === "object"
        ? value("smooth").amount
        : value("smooth"),
    set: (v) => set("smooth", v),
    fmt: 2,
  },
  curves: {
    get: () => renderValue("curves"),
    set: (v) => setRender("curves", v),
    fmt: 2,
    off: "off",
  },
  fair: {
    get: () => renderValue("fair"),
    set: (v) => setRender("fair", v),
    fmt: 2,
  },
};
const showSlider = (id) => {
  const s = sliders[id],
    v = Number($(id).value);
  $(`${id}Out`).textContent = !v && s.off ? s.off : v.toFixed(s.fmt).padStart(s.pad ?? 0, "0");
};

function syncControls() {
  $("text").value = overrides.text ?? "";
  $("seed").value = overrides.seed ?? "";
  $("preset").value = presetName;
  $("font").value = fontName;
  const env = effective().envelope;
  $("envelope").value =
    env == null ? "(preset)" : env === "none" ? "none" : (env.type ?? env);
  $("align").value = value("align");
  const ob = effective().obstructions;
  $("obstructions").value = !ob ? "none" : typeof ob === "string" ? ob : ob.type ?? "none";
  $("repel").value = value("repel") ? "on" : "off";
  $("knit").value = value("knit") ? "0.25" : "0";
  $("gaps").value = renderValue("ink") ? "on" : "off";
  $("inner").value = renderValue("inner") ? "on" : "off";
  for (const n of EFFECTS) $(n).value = effectOpts(n) ? "on" : "off";
  $("perLetter").value = effectOpts("depth")?.merge === false ? "on" : "off";
  $("perLetter").disabled = !effectOpts("depth");
  $("light").disabled = !LIT.some(effectOpts);
  lightDial?.sync();
  $("fxInset").disabled = !INSET.some(effectOpts);
  $("order").value = renderValue("order");
  $("structure").value = skeletonOn() ? "on" : "off";
  $("follow").disabled = !skeletonOn();
  for (const id of Object.keys(sliders)) {
    $(id).value = sliders[id].get() ?? 0;
    showSlider(id);
  }
}

function highlight() {
  // A trailing newline needs a character after it to take up a line.
  $("codeHl").innerHTML = highlightCode($("code").value) + " ";
  syncScroll();
}
const syncScroll = () => {
  $("codeHl").scrollTop = $("code").scrollTop;
  $("codeHl").scrollLeft = $("code").scrollLeft;
};
$("code").addEventListener("scroll", syncScroll);

const writeCode = () => {
  $("code").value = code();
  highlight();
  $("code").classList.remove("error");
  $("codeError").textContent = "";
};

function fromControl(id) {
  const v = $(id).value;
  switch (id) {
    case "text":
      overrides.text = v;
      break;
    case "seed":
      overrides.seed = v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
      break;
    case "preset":
      // A new recipe; the choices made in the panel stay.
      presetName = v;
      recipe = structuredClone(presets[v]);
      syncControls();
      break;
    case "font":
      fontName = v;
      break;
    case "envelope":
      if (v === "(preset)") delete overrides.envelope;
      else overrides.envelope = v === "none" ? "none" : { type: v };
      break;
    case "obstructions":
      set("obstructions", v === "none" ? undefined : { type: v });
      break;
    case "align":
      set("align", v);
      break;
    case "repel":
      set("repel", v === "on");
      break;
    case "knit":
      set("knit", Number(v));
      break;
    // Gap lines (off by default): narrow gaps drawn as one line, or left open (ink 0).
    case "shine":
    case "shade":
    case "depth":
    case "inline":
      setEffect(id, v === "on");
      syncControls();
      break;
    // Depth per letter: each side stacked with its letter instead of one block.
    case "perLetter":
      if (effectOpts("depth")) setEffectOpts("depth", { merge: v === "on" ? false : undefined });
      break;
    // Inner lines: where a letter's swell meets itself across a gap (render.inner).
    case "inner":
      setRender("inner", v === "on" ? (asObj(recipe.render).inner || RENDER_DEFAULTS.inner) : 0);
      break;
    case "gaps":
      setRender("ink", v === "on" ? (asObj(recipe.render).ink || GAP_INK) : 0);
      break;
    case "order":
      setRender("order", v);
      break;
    // Skeleton on: the preset's own structure; off: grow the font's real outlines.
    case "structure":
      if (v === "off") overrides.structure = false;
      // A preset without a skeleton (crowd) gets the usual pen.
      else if (recipe.structure === false) overrides.structure = { pen: 0.15, spacing: 0.3 };
      else delete overrides.structure;
      syncControls();
      break;
    default:
      sliders[id].set(Number(v));
      showSlider(id);
  }
  writeCode();
  schedule();
}

let parsing = 0;
$("code").addEventListener("input", async () => {
  highlight();
  const ticket = ++parsing;
  try {
    const res = await parseCode($("code").value);
    if (ticket !== parsing) return; // a newer edit is already being read
    ({ recipe, overrides, fontName } = res);
    $("code").classList.remove("error");
    $("codeError").textContent = "";
    syncControls();
    schedule();
  } catch (e) {
    $("code").classList.add("error");
    $("codeError").textContent = e.message;
  }
});

// ── Drawing ──────────────────────────────────────────────────────────────────────
let last = "";
let drawing; // the draw in flight; a newer one supersedes it
async function draw() {
  const t0 = performance.now();
  drawing?.abort();
  const run = (drawing = new AbortController());
  try {
    const piece = await pool.render(
      { ...effective(), font: fonts[fontName].url },
      { signal: run.signal, priority: true, letters: true },
    );
    if (run.signal.aborted) return;
    last = piece.svg;
    // On top / repel / knit only act where letters overlap or nearly touch.
    const L = piece.letters;
    let overlap = false;
    for (let i = 0; i < L.length - 1 && !overlap; i++) {
      overlap =
        geom.intersection(
          geom.offset(L[i].shape, piece.metrics.stem * 0.3),
          L[i + 1].shape,
        ).length > 0;
    }
    for (const id of ["order", "repel", "knit"]) {
      $(id).disabled = !overlap && !value("repel") && !value("knit");
      $(id).title = $(id).disabled
        ? "no effect: no letters touch or overlap in this piece (try less letter spacing)"
        : "";
    }
    $("stage").innerHTML = piece.svg;
    $("status").textContent =
      `${(performance.now() - t0).toFixed(0)} ms · stem ${piece.metrics?.stem.toFixed(1)}px`;
  } catch (e) {
    if (e.name !== "AbortError") $("status").textContent = e.message;
  }
}

// ── Timeline ─────────────────────────────────────────────────────────────────────
// Play grows the piece frame by frame (bouffontLive) and records the frames; after
// that they play back, looping or back and forth. Any change of settings starts over.
const FPS = 30, HOLD = 600; // playback speed; pause at the ends (ms)
const fontObjects = {};
const fontObject = (name) => (fontObjects[name] ??= loadFont(fonts[name].url));
const tl = { frames: [], live: null, i: 0, dir: 1, playing: false, holdUntil: 0, lastTick: 0, run: 0, waiting: 0 };
// Frames that are drawn so far, in order (the pool may finish them out of order).
const readyFrames = () => {
  const k = tl.frames.indexOf(null);
  return k === -1 ? tl.frames.length : k;
};

function showFrame(i) {
  if (tl.frames[i] == null) return;
  tl.i = i;
  last = tl.frames[i];
  $("stage").innerHTML = last;
  syncTimeline();
}
function syncTimeline() {
  const n = tl.frames.length, growing = (tl.live && !tl.live.done) || tl.waiting > 0;
  $("frame").max = String(Math.max(0, n - 1));
  $("frame").value = String(tl.i);
  $("frameOut").textContent = n ? `${tl.i + 1}/${n}${growing ? "…" : ""}` : "";
}
function setPlaying(on) {
  tl.playing = on;
  $("play").classList.toggle("playing", on);
  $("play").setAttribute("aria-label", on ? "pause" : "play the growth");
  if (on) requestAnimationFrame(playLoop);
}
function resetTimeline() {
  tl.run++;
  tl.frames = [];
  tl.live = null;
  tl.i = 0;
  tl.dir = 1;
  tl.waiting = 0;
  setPlaying(false);
  syncTimeline();
}
function playLoop(now) {
  if (!tl.playing) return;
  if (tl.live && !tl.live.done) {
    // Still growing: one step per screen frame. Each frame is drawn in the worker pool
    // (repel and all, several at once) and recorded as it comes back.
    if (tl.live.step()) {
      const i = tl.frames.length, run = tl.run;
      tl.frames.push(null);
      tl.waiting++;
      pool.draw(tl.live.frame(), { priority: true }).then(({ svg }) => {
        if (run !== tl.run) return;
        tl.frames[i] = svg;
        tl.waiting--;
        showFrame(readyFrames() - 1);
        if (!tl.waiting && tl.live.done) tl.holdUntil = performance.now() + HOLD;
      }, () => {});
    } else {
      tl.frames.push(tl.live.final().svg); // the exact piece closes the timeline
      if (!tl.waiting) {
        showFrame(tl.frames.length - 1);
        tl.holdUntil = now + HOLD;
      }
    }
    syncTimeline();
  } else if (!tl.waiting && now >= tl.holdUntil && now - tl.lastTick >= 1000 / FPS && tl.frames.length > 1) {
    // Playing back the recording.
    tl.lastTick = now;
    const n = tl.frames.length, zigzag = $("playMode").value === "zigzag";
    let i = tl.i + tl.dir;
    if (i > n - 1 || i < 0) {
      if (zigzag) tl.dir = -tl.dir;
      i = zigzag ? tl.i + tl.dir : 0;
    }
    showFrame(i);
    if (i === n - 1 || (zigzag && i === 0)) tl.holdUntil = now + HOLD;
  }
  requestAnimationFrame(playLoop);
}
$("play").addEventListener("click", async () => {
  if (tl.playing) return setPlaying(false);
  if (!tl.live) {
    const run = tl.run;
    const font = await fontObject(fontName);
    if (run !== tl.run) return; // the settings changed meanwhile
    try {
      tl.live = bouffontLive({ ...effective(), font });
    } catch (e) {
      $("status").textContent = e.message;
      return;
    }
  } else if (tl.live.done && $("playMode").value === "loop" && tl.i === tl.frames.length - 1) {
    showFrame(0); // play again from the start
  }
  setPlaying(true);
});
$("frame").addEventListener("input", () => {
  setPlaying(false);
  if (tl.frames.length) showFrame(Number($("frame").value));
});

let pending;
const schedule = () => {
  resetTimeline();
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(draw);
  broadcast();
};

// The same settings drive the titles on the page (site.js listens).
function broadcast() {
  const { text, ...options } = effective();
  window.dispatchEvent(
    new CustomEvent("bouffont:settings", {
      detail: { options, fontUrl: fonts[fontName].url },
    }),
  );
}

for (const id of ["text", "seed", ...Object.keys(sliders)])
  $(id).addEventListener("input", () => fromControl(id));
for (const id of [
  "font",
  "preset",
  "envelope",
  "align",
  "obstructions",
  "repel",
  "order",
  "knit",
  ...EFFECTS,
  "perLetter",
  "gaps",
  "inner",
  "structure",
])
  $(id).addEventListener("change", () => fromControl(id));
$("shuffle").addEventListener("click", () => {
  $("seed").value = Math.random().toString(36).slice(2, 7);
  fromControl("seed");
});
// Reset: the preset's own recipe and the default settings (text and seed stay).
$("reset").addEventListener("click", () => {
  overrides = { text: overrides.text, seed: overrides.seed };
  fromControl("preset");
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("code").value);
    $("copy").textContent = "copied";
  } catch {
    $("code").select();
    $("copy").textContent = "select + ⌘C";
  }
  setTimeout(() => ($("copy").textContent = "copy"), 1200);
});
$("download").addEventListener("click", (e) => {
  e.preventDefault(); // it sits in the code panel's summary: don't fold it
  // Bake the fill colour the page shows (the playground fills use var(--bg)) into the file.
  // Bake the colours the page shows (fills and shade use the page colour) into the
  // file, as plain rgb so any viewer reads them.
  const rgb = (color) => {
    const paint = document.createElement("canvas").getContext("2d");
    paint.fillStyle = color;
    paint.fillRect(0, 0, 1, 1);
    const [r, g, b] = paint.getImageData(0, 0, 1, 1).data;
    return `rgb(${r} ${g} ${b})`;
  };
  let svg = last;
  for (const part of ["fill", "shade"]) {
    const shown = document.querySelector(`#stage [data-part="${part}"]`);
    if (!shown) continue;
    const color = rgb(getComputedStyle(shown).fill);
    svg = svg.replace(new RegExp(`(data-part="${part}"[^>]*?)fill="[^"]*"`, "g"), `$1fill="${color}"`);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = `${(String(overrides.text) || "piece").replace(/\s+/g, "-")}-${overrides.seed}.svg`;
  a.click();
});

syncControls();
writeCode();
draw();
