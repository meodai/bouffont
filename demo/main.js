import { presets, envelopes, geom } from "../src/index.js";
import { pool } from "./pool.js";
import iosevkaUrl from "./fonts/iosevka-400-normal.woff?url";
import { highlightCode } from "./highlight.js";

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
const fill = (select, names) =>
  (select.innerHTML = names.map((n) => `<option>${n}</option>`).join(""));

fill($("font"), Object.keys(fonts));
fill($("preset"), Object.keys(presets));
fill($("envelope"), ["(preset)", "none", ...Object.keys(envelopes)]);

// ── State ────────────────────────────────────────────────────────────────────────
// What the code panel shows: the preset's full recipe (editable, on top) and the
// options passed to bouffont(): text, seed, the spread recipe and your changes.
// Defaults match the page titles: Merriweather, throwup.
let fontName = fonts.Merriweather ? "Merriweather" : Object.keys(fonts)[0];
let presetName = Object.keys(presets)[0];
let recipe = structuredClone(presets[presetName]);
let overrides = { text: "salle petit\nbouffont", seed: "puff" };
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
const RENDER_DEFAULTS = { order: "ltr", curves: 0, fair: 0 };
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
  $(`${id}Out`).textContent = !v && s.off ? s.off : v.toFixed(s.fmt);
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
  $("repel").value = value("repel") ? "on" : "off";
  $("knit").value = value("knit") ? "0.25" : "0";
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
    case "align":
      set("align", v);
      break;
    case "repel":
      set("repel", v === "on");
      break;
    case "knit":
      set("knit", Number(v));
      break;
    case "order":
      setRender("order", v);
      break;
    // Skeleton on: the preset's own structure; off: grow the font's real outlines.
    case "structure":
      if (v === "on") delete overrides.structure;
      else overrides.structure = false;
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

let pending;
const schedule = () => {
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
  "repel",
  "order",
  "knit",
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
  const shown = document.querySelector('#stage [data-part="fill"]');
  const fill = shown ? getComputedStyle(shown).fill : null;
  const svg = fill
    ? last.replace(/(data-part="fill"[^>]*?)fill="[^"]*"/g, `$1fill="${fill}"`)
    : last;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = `${(String(overrides.text) || "piece").replace(/\s+/g, "-")}-${overrides.seed}.svg`;
  a.click();
});

syncControls();
writeCode();
draw();
