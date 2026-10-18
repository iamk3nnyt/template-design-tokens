#!/usr/bin/env node
// Design-token pipeline. design-tokens.json is the source of truth.
//   node scripts/tokens.mjs build          write the CSS (@theme + type-* utilities) and TS outputs
//   node scripts/tokens.mjs check          validate, fail on stale outputs and on values that bypass tokens
//   node scripts/tokens.mjs figma          print the Figma state this file implies (JSON)
//   node scripts/tokens.mjs figma-script [--apply]
//                                          print a Figma Plugin API script for the Figma MCP `use_figma`
//                                          tool: dry run by default (returns the diff), --apply writes
//   node scripts/tokens.mjs figma-export-script
//                                          print a read-only Plugin API script that returns the Figma side as JSON
//   node scripts/tokens.mjs pull <figma-state.json> [--write]
//                                          diff that JSON against design-tokens.json; --write updates the file
//   node scripts/tokens.mjs map            Figma variable/style name → CSS var / Tailwind utility (for implementing designs)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(root, "design-tokens.json");
const REM_PX = 16;
const MD_BREAKPOINT = "48rem";
const PILL = 9999;

const tokens = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const config = tokens.$config;
const entries = (obj = {}) => Object.entries(obj).filter(([k]) => !k.startsWith("$"));

// ---- validation ------------------------------------------------------------
function validate() {
  const errors = [];
  const hex = /^#[0-9a-f]{6}$/i;
  const name = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  for (const [k, v] of entries(tokens.primitives)) if (!hex.test(v)) errors.push(`primitives.${k}: "${v}" is not #rrggbb`);
  for (const [k, t] of entries(tokens.color)) {
    if (!name.test(k)) errors.push(`color.${k}: use kebab-case`);
    if (!t.figma) errors.push(`color.${k}: missing "figma" name`);
    if (!tokens.primitives[t.value]) errors.push(`color.${k}: unknown primitive "${t.value}"`);
    if (t.alpha !== undefined && !(t.alpha >= 0 && t.alpha <= 1)) errors.push(`color.${k}: alpha must be 0–1`);
  }
  for (const [k, v] of entries(tokens.radius)) if (typeof v !== "number" || v < 0) errors.push(`radius.${k}: must be a px number`);
  for (const [k, t] of entries(tokens.shadow)) {
    if (!t.figma) errors.push(`shadow.${k}: missing "figma" name`);
    for (const l of t.layers ?? []) if (!resolveHex(l.color)) errors.push(`shadow.${k}: unknown colour "${l.color}"`);
  }
  for (const [k, t] of entries(tokens.type)) {
    if (!t.figma) errors.push(`type.${k}: missing "figma" name`);
    for (const f of ["size", "line", "weight"]) if (typeof t[f] !== "number") errors.push(`type.${k}: "${f}" must be a number`);
  }
  const figmaNames = entries(tokens.color).map(([, t]) => t.figma);
  for (const dup of figmaNames.filter((n, i) => figmaNames.indexOf(n) !== i)) errors.push(`color: figma name "${dup}" used twice`);
  return errors;
}

// ---- CSS / TS generation ---------------------------------------------------
const resolveHex = (ref) => (ref?.startsWith("#") ? ref : tokens.primitives[ref]);
const rgba = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
};
const rem = (px) => `${px / REM_PX}rem`;
const colorValue = (t) => (t.alpha === undefined ? resolveHex(t.value) : rgba(resolveHex(t.value), t.alpha));
const shadowValue = (t) => t.layers.map((l) => `${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${rgba(resolveHex(l.color), l.alpha ?? 1)}`).join(", ");

function typeUtility([key, t]) {
  const lines = [`  font-size: ${rem(t.size)};`, `  line-height: ${rem(t.line)};`, `  font-weight: ${t.weight};`];
  if (t.tracking) lines.push(`  letter-spacing: ${t.tracking}em;`);
  if (t.uppercase) lines.push("  text-transform: uppercase;");
  if (t.tabular) lines.push("  font-variant-numeric: tabular-nums;");
  // Phones only: on wider screens hyphens:auto splits words that would fit.
  if (t.hyphenate) lines.push("  overflow-wrap: break-word;", `  @media (width < ${MD_BREAKPOINT}) {\n    hyphens: auto;\n  }`);
  for (const decl of t.css ?? []) lines.push(`  ${decl}`);
  if (t.md) lines.push(`  @media (width >= ${MD_BREAKPOINT}) {\n    font-size: ${rem(t.md.size)};\n    line-height: ${rem(t.md.line)};\n  }`);
  return `/* ${config.figma.typePrefix}${t.figma} */\n@utility type-${key} {\n${lines.join("\n")}\n}`;
}

function generate() {
  const header = "/* GENERATED from design-tokens.json by scripts/tokens.mjs. Do not edit. */";
  const theme = [
    entries(tokens.font).map(([k, f]) => `  --font-${k}: ${f.stack};`).join("\n"),
    entries(tokens.color).map(([k, t]) => `  --color-${k}: ${colorValue(t)}; /* ${t.figma} */`).join("\n"),
    entries(tokens.radius).map(([k, v]) => `  --radius-${k}: ${v >= PILL ? `${PILL}px` : rem(v)};`).join("\n"),
    entries(tokens.shadow).map(([k, t]) => `  --shadow-${k}: ${shadowValue(t)}; /* ${config.figma.shadowPrefix}${t.figma} */`).join("\n"),
  ].filter(Boolean).join("\n\n");
  const css = `${header}\n\n@theme {\n${theme}\n}\n\n${entries(tokens.type).map(typeUtility).join("\n\n")}\n`;
  const colors = Object.fromEntries(entries(tokens.color).map(([k, t]) => [k, colorValue(t)]));
  const ts = `// GENERATED from design-tokens.json by scripts/tokens.mjs. Do not edit.\n// Literal values for code that can't use CSS variables (canvas, charts, map markers, emails).\n\nexport const color = ${JSON.stringify(colors, null, 2)} as const;\n`;
  return { [config.css]: css, ...(config.ts ? { [config.ts]: ts } : {}) };
}

// ---- lint: values that bypass the tokens ----------------------------------
const RULES = [
  ["hex colour", /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/],
  ["Tailwind palette colour", /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|divide|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|green|blue|yellow|amber|orange|emerald|teal|cyan|sky|indigo|violet|purple|pink|rose|black|white)\b/],
  ["opacity on a colour", /\b(?:bg|text|border|ring|outline)-[a-z-]+\/\d+\b/],
  ["arbitrary colour", /\[(?:#|rgb|hsl|oklch)[^\]]*\]/],
  ["non-token radius", /\brounded(?:-[a-z]{1,2})?-(?:none|sm|md|lg|xl|2xl|3xl|\[[^\]]+\])/],
  ["non-token shadow", /\bshadow-(?:xs|md|xl|2xl|inner|\[[^\]]+\])/],
  ["raw text size", /\btext-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]+\])(?![\w-])/],
  ["raw leading/tracking", /\b(?:leading|tracking)-(?:\d+|none|tight|snug|normal|relaxed|loose|tighter|wide|wider|widest|\[[^\]]+\])/],
  // font-medium stays allowed: inline emphasis inside body text.
  ["raw font weight", /\bfont-(?:thin|light|semibold|bold|extrabold|black)\b/],
];
const CODE = /\.(tsx|ts|jsx|js|mdx)$/;
const generatedFiles = () => new Set([config.css, config.ts].filter(Boolean).map((p) => path.normalize(p)));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(p);
    return CODE.test(e.name) ? [p] : [];
  });
}

function lint() {
  const problems = [];
  const allowHex = new Set((config.allowHex ?? []).map((p) => path.normalize(p)));
  const generated = generatedFiles();
  for (const file of config.scan.flatMap((d) => walk(path.join(root, d)))) {
    const rel = path.relative(root, file);
    if (generated.has(rel)) continue;
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/tokens-ignore-line/.test(line)) return;
      for (const [label, re] of RULES) {
        if (label === "hex colour" && allowHex.has(rel)) continue;
        const m = line.match(re);
        if (m) problems.push(`${rel}:${i + 1}  ${label}: ${m[0]}`);
      }
    });
  }
  return problems;
}

// ---- Figma ------------------------------------------------------------------
function figmaSpec() {
  const f = config.figma;
  const hexOf = (ref) => resolveHex(ref);
  return {
    collections: [
      {
        name: f.primitives,
        variables: entries(tokens.primitives).map(([k, v]) => ({ name: k, type: "COLOR", value: v, scopes: [], hidden: true })),
      },
      {
        name: f.color,
        variables: entries(tokens.color).map(([k, t]) => ({
          name: t.figma,
          type: "COLOR",
          alias: t.alpha === undefined ? t.value : undefined, // alpha tokens can't alias: write the resolved value
          value: hexOf(t.value),
          alpha: t.alpha,
          codeSyntax: `var(--color-${k})`,
          scopes: t.figma.startsWith("text/") ? ["TEXT_FILL"] : t.figma.startsWith("border/") ? ["STROKE_COLOR"] : ["ALL_FILLS", "STROKE_COLOR"],
        })),
      },
      {
        name: f.radius,
        variables: entries(tokens.radius).map(([k, v]) => ({ name: `radius/${k}`, type: "FLOAT", value: v, codeSyntax: `var(--radius-${k})`, scopes: ["CORNER_RADIUS"] })),
      },
    ],
    effectStyles: entries(tokens.shadow).map(([k, t]) => ({
      name: `${f.shadowPrefix}${t.figma}`,
      description: `shadow-${k}`,
      layers: t.layers.map((l) => ({ ...l, color: hexOf(l.color), alpha: l.alpha ?? 1 })),
    })),
    textStyles: entries(tokens.type).flatMap(([k, t]) => {
      const family = (tokens.font?.[t.font ?? "sans"] ?? Object.values(tokens.font ?? {})[0])?.family ?? "Inter";
      const base = { family, weight: t.weight, tracking: t.tracking ?? 0, uppercase: !!t.uppercase, description: `type-${k}` };
      // Mobile size is the default; md overrides become a second "<Name> Desktop" style.
      const styles = [{ ...base, name: `${f.typePrefix}${t.figma}`, size: t.size, line: t.line }];
      if (t.md) styles.push({ ...base, name: `${f.typePrefix}${t.figma} Desktop`, size: t.md.size, line: t.md.line });
      return styles;
    }),
  };
}

// Runs inside Figma via use_figma (top-level await/return, no IIFE). Idempotent: matches by name.
const PLUGIN_BODY = String.raw`
const WEIGHT_STYLES = { 100: ["Thin"], 200: ["ExtraLight", "Extra Light"], 300: ["Light"], 400: ["Regular"], 500: ["Medium"], 600: ["SemiBold", "Semi Bold"], 700: ["Bold"], 800: ["ExtraBold", "Extra Bold"], 900: ["Black"] };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }; };
const same = (a, b) => Math.abs(a - b) < 0.002;
const sameColor = (a, b) => a && b && same(a.r, b.r) && same(a.g, b.g) && same(a.b, b.b) && same(a.a ?? 1, b.a ?? 1);
const changes = [];
const ids = { created: [], updated: [] };

const existing = await figma.variables.getLocalVariableCollectionsAsync();
const allVars = await figma.variables.getLocalVariablesAsync();
const byCollection = new Map();
for (const spec of SPEC.collections) {
  let col = existing.find((c) => c.name === spec.name);
  if (!col) { changes.push("+ collection " + spec.name); if (APPLY) { col = figma.variables.createVariableCollection(spec.name); ids.created.push(col.id); } }
  byCollection.set(spec.name, col);
}
const findVar = (col, name) => col && allVars.find((v) => v.variableCollectionId === col.id && v.name === name);
const primitives = byCollection.get(SPEC.collections[0].name);

for (const spec of SPEC.collections) {
  const col = byCollection.get(spec.name);
  for (const t of spec.variables) {
    let v = findVar(col, t.name);
    const label = spec.name + " / " + t.name;
    const isNew = !v;
    if (isNew) { changes.push("+ " + label); if (!APPLY) continue; v = figma.variables.createVariable(t.name, col, t.type); ids.created.push(v.id); allVars.push(v); }
    const log = (msg) => { if (!isNew) changes.push(msg); };
    const mode = col.defaultModeId;
    const cur = v.valuesByMode[mode];
    let want;
    if (t.alias) {
      const target = findVar(primitives, t.alias);
      if (target) want = figma.variables.createVariableAlias(target);
    }
    if (!want) want = t.type === "COLOR" ? { ...rgb(t.value), a: t.alpha ?? 1 } : t.value;
    const differs = want.type === "VARIABLE_ALIAS" ? !(cur && cur.type === "VARIABLE_ALIAS" && cur.id === want.id)
      : t.type === "COLOR" ? !sameColor(cur, want) : cur !== want;
    if (differs) { log("~ " + label + " value"); if (APPLY) { v.setValueForMode(mode, want); if (!isNew) ids.updated.push(v.id); } }
    if (APPLY) {
      v.scopes = t.scopes;
      if (t.hidden !== undefined) v.hiddenFromPublishing = t.hidden;
      if (t.codeSyntax && v.codeSyntax.WEB !== t.codeSyntax) { v.setVariableCodeSyntax("WEB", t.codeSyntax); log("~ " + label + " codeSyntax"); }
    } else if (t.codeSyntax && v.codeSyntax.WEB !== t.codeSyntax) log("~ " + label + " codeSyntax");
  }
}

const effects = await figma.getLocalEffectStylesAsync();
for (const s of SPEC.effectStyles) {
  let st = effects.find((e) => e.name === s.name);
  const want = s.layers.map((l) => ({ type: "DROP_SHADOW", color: { ...rgb(l.color), a: l.alpha }, offset: { x: l.x, y: l.y }, radius: l.blur, spread: l.spread, visible: true, blendMode: "NORMAL" }));
  const differs = !st || JSON.stringify(st.effects.map((e) => [e.offset.x, e.offset.y, e.radius, e.spread, +e.color.a.toFixed(3)])) !== JSON.stringify(want.map((e) => [e.offset.x, e.offset.y, e.radius, e.spread, +e.color.a.toFixed(3)]));
  if (differs) {
    changes.push((st ? "~ " : "+ ") + "effect style " + s.name);
    if (APPLY) { if (!st) { st = figma.createEffectStyle(); st.name = s.name; ids.created.push(st.id); } st.effects = want; st.description = s.description; }
  }
}

const texts = await figma.getLocalTextStylesAsync();
const fonts = await figma.listAvailableFontsAsync();
for (const s of SPEC.textStyles) {
  const style = (WEIGHT_STYLES[s.weight] || []).find((c) => fonts.some((f) => f.fontName.family === s.family && f.fontName.style === c));
  if (!style) { changes.push("! font " + s.family + " " + s.weight + " not available in Figma, skipped " + s.name); continue; }
  const fontName = { family: s.family, style };
  let st = texts.find((t) => t.name === s.name);
  const differs = !st || st.fontName.family !== s.family || st.fontName.style !== style || st.fontSize !== s.size
    || st.lineHeight.unit !== "PIXELS" || st.lineHeight.value !== s.line || !same(st.letterSpacing.value, s.tracking * 100)
    || (st.textCase === "UPPER") !== s.uppercase;
  if (!differs) continue;
  changes.push((st ? "~ " : "+ ") + "text style " + s.name);
  if (!APPLY) continue;
  await figma.loadFontAsync(fontName);
  if (!st) { st = figma.createTextStyle(); st.name = s.name; ids.created.push(st.id); }
  st.fontName = fontName;
  st.fontSize = s.size;
  st.lineHeight = { unit: "PIXELS", value: s.line };
  st.letterSpacing = { unit: "PERCENT", value: s.tracking * 100 };
  st.textCase = s.uppercase ? "UPPER" : "ORIGINAL";
  st.description = s.description;
  if (!ids.created.includes(st.id)) ids.updated.push(st.id);
}

return { applied: APPLY, changes, ids };
`;

// Read-only: returns the Figma side in a shape `pull` understands.
const EXPORT_BODY = String.raw`
const hex = (c) => "#" + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
const round = (n) => Math.round(n * 1000) / 1000;
const out = { collections: {}, effectStyles: {}, textStyles: {} };
const cols = await figma.variables.getLocalVariableCollectionsAsync();
const vars = await figma.variables.getLocalVariablesAsync();
const byId = new Map(vars.map((v) => [v.id, v]));
for (const c of cols) {
  const bucket = (out.collections[c.name] = {});
  for (const v of vars.filter((x) => x.variableCollectionId === c.id)) {
    const val = v.valuesByMode[c.defaultModeId];
    if (val && val.type === "VARIABLE_ALIAS") {
      const target = byId.get(val.id) || (await figma.variables.getVariableByIdAsync(val.id));
      bucket[v.name] = { type: v.resolvedType, alias: target ? target.name : null };
    } else if (v.resolvedType === "COLOR") bucket[v.name] = { type: "COLOR", value: hex(val), alpha: round(val.a ?? 1) };
    else bucket[v.name] = { type: v.resolvedType, value: val };
  }
}
for (const s of await figma.getLocalEffectStylesAsync()) {
  out.effectStyles[s.name] = s.effects.filter((e) => e.type === "DROP_SHADOW").map((e) => ({ x: e.offset.x, y: e.offset.y, blur: e.radius, spread: e.spread ?? 0, color: hex(e.color), alpha: round(e.color.a) }));
}
for (const s of await figma.getLocalTextStylesAsync()) {
  out.textStyles[s.name] = { family: s.fontName.family, style: s.fontName.style, size: s.fontSize,
    line: s.lineHeight.unit === "PIXELS" ? s.lineHeight.value : null,
    tracking: s.letterSpacing.unit === "PERCENT" ? round(s.letterSpacing.value / 100) : round(s.letterSpacing.value / s.fontSize),
    uppercase: s.textCase === "UPPER" };
}
return out;
`;

const STYLE_WEIGHTS = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sameNum = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.0015;

// Figma state (from figma-export-script) → edits to design-tokens.json. Never deletes: code-only tokens are reported.
function pull(state) {
  const f = config.figma;
  const next = structuredClone(tokens);
  const edits = [];
  const notes = [];
  const primByHex = () => new Map(entries(next.primitives).map(([k, v]) => [v.toLowerCase(), k]));
  const primitiveFor = (hexValue, suggested) => {
    const found = primByHex().get(hexValue.toLowerCase());
    if (found) return found;
    let name = suggested;
    for (let i = 2; next.primitives[name]; i++) name = `${suggested}-${i}`;
    next.primitives[name] = hexValue.toLowerCase();
    edits.push(`+ primitive ${name} = ${hexValue}`);
    return name;
  };

  const prims = state.collections[f.primitives] ?? {};
  for (const [name, v] of Object.entries(prims)) {
    if (v.type !== "COLOR" || !v.value) continue;
    if (!next.primitives[name]) { next.primitives[name] = v.value; edits.push(`+ primitive ${name} = ${v.value}`); }
    else if (next.primitives[name].toLowerCase() !== v.value.toLowerCase()) { edits.push(`~ primitive ${name}: ${next.primitives[name]} → ${v.value}`); next.primitives[name] = v.value; }
  }
  for (const k of Object.keys(next.primitives)) if (!(k in prims)) notes.push(`primitive ${k} only in code`);

  const colors = state.collections[f.color] ?? {};
  const keyByFigma = new Map(entries(next.color).map(([k, t]) => [t.figma, k]));
  for (const [fname, v] of Object.entries(colors)) {
    let key = keyByFigma.get(fname);
    const value = v.alias ?? primitiveFor(v.value, fname);
    const alpha = v.alias || v.alpha === undefined || sameNum(v.alpha, 1) ? undefined : v.alpha;
    if (!key) {
      key = kebab(fname);
      next.color[key] = { figma: fname, value, ...(alpha !== undefined ? { alpha } : {}) };
      edits.push(`+ color ${key} (${fname}) = ${value}${alpha !== undefined ? ` @${alpha}` : ""}  ← rename the key if --color-${key} isn't the CSS name you want`);
      continue;
    }
    const t = next.color[key];
    if (t.value !== value) { edits.push(`~ color ${key}: ${t.value} → ${value}`); t.value = value; }
    if (!sameNum(t.alpha ?? 1, alpha ?? 1)) { edits.push(`~ color ${key} alpha: ${t.alpha ?? 1} → ${alpha ?? 1}`); if (alpha === undefined) delete t.alpha; else t.alpha = alpha; }
  }
  for (const [k, t] of entries(next.color)) if (!(t.figma in colors)) notes.push(`color ${k} (${t.figma}) only in code`);

  const radii = state.collections[f.radius] ?? {};
  next.radius ??= {};
  for (const [fname, v] of Object.entries(radii)) {
    const key = fname.replace(/^radius\//, "");
    if (typeof v.value !== "number") continue;
    if (next.radius[key] === undefined) { next.radius[key] = v.value; edits.push(`+ radius ${key} = ${v.value}`); }
    else if (next.radius[key] !== v.value) { edits.push(`~ radius ${key}: ${next.radius[key]} → ${v.value}`); next.radius[key] = v.value; }
  }

  next.shadow ??= {};
  const shadowKey = new Map(entries(next.shadow).map(([k, t]) => [t.figma, k]));
  for (const [name, layers] of Object.entries(state.effectStyles ?? {})) {
    if (!name.startsWith(f.shadowPrefix) || !layers.length) continue;
    const fname = name.slice(f.shadowPrefix.length);
    const key = shadowKey.get(fname) ?? kebab(fname);
    const want = layers.map((l) => ({ x: l.x, y: l.y, blur: l.blur, spread: l.spread, color: primitiveFor(l.color, kebab(l.color)), alpha: l.alpha }));
    const cur = next.shadow[key];
    const sig = (ls) => JSON.stringify(ls.map((l) => [l.x, l.y, l.blur, l.spread, resolveHexIn(next, l.color), +(l.alpha ?? 1).toFixed(3)]));
    if (!cur) { next.shadow[key] = { figma: fname, layers: want }; edits.push(`+ shadow ${key}`); }
    else if (sig(cur.layers) !== sig(want)) { cur.layers = want; edits.push(`~ shadow ${key} layers`); }
  }

  next.type ??= {};
  const typeKey = new Map(entries(next.type).map(([k, t]) => [t.figma, k]));
  for (const [name, s] of Object.entries(state.textStyles ?? {})) {
    if (!name.startsWith(f.typePrefix)) continue;
    const desktop = name.endsWith(" Desktop");
    const fname = name.slice(f.typePrefix.length).replace(/ Desktop$/, "");
    const weight = STYLE_WEIGHTS[s.style.toLowerCase().replace(/[\s-]/g, "")];
    if (s.line === null) notes.push(`text style ${name}: line height isn't in px, skipped`);
    let key = typeKey.get(fname);
    if (!key) {
      if (desktop) continue; // handled with its mobile style
      key = kebab(fname);
      next.type[key] = { figma: fname, size: s.size, line: s.line, weight: weight ?? 400, ...(s.tracking ? { tracking: s.tracking } : {}), ...(s.uppercase ? { uppercase: true } : {}) };
      typeKey.set(fname, key);
      edits.push(`+ type ${key} (${name})`);
      continue;
    }
    const t = next.type[key];
    const fam = (tokens.font?.[t.font ?? "sans"] ?? Object.values(tokens.font ?? {})[0])?.family;
    if (fam && s.family !== fam) notes.push(`text style ${name}: font ${s.family} ≠ code ${fam}, change font.*.family by hand`);
    if (desktop) {
      if (!t.md || t.md.size !== s.size || t.md.line !== s.line) { edits.push(`~ type ${key} md: ${t.md ? `${t.md.size}/${t.md.line}` : "none"} → ${s.size}/${s.line}`); t.md = { size: s.size, line: s.line }; }
      continue;
    }
    for (const [field, val] of [["size", s.size], ["line", s.line], ["weight", weight]]) {
      if (val != null && t[field] !== val) { edits.push(`~ type ${key} ${field}: ${t[field]} → ${val}`); t[field] = val; }
    }
    if (!sameNum(t.tracking, s.tracking)) { edits.push(`~ type ${key} tracking: ${t.tracking ?? 0} → ${s.tracking}`); if (s.tracking) t.tracking = s.tracking; else delete t.tracking; }
    if (!!t.uppercase !== s.uppercase) { edits.push(`~ type ${key} uppercase → ${s.uppercase}`); if (s.uppercase) t.uppercase = true; else delete t.uppercase; }
  }
  return { next, edits, notes };
}
const resolveHexIn = (doc, ref) => (ref?.startsWith("#") ? ref.toLowerCase() : doc.primitives[ref]?.toLowerCase());

// JSON with leaf objects on one line, matching the hand-written style of design-tokens.json.
function formatTokens(value, indent = "") {
  const isLeaf = (v) => v && typeof v === "object" && Object.values(v).every((x) => x === null || typeof x !== "object" || (Array.isArray(x) && x.every((y) => typeof y !== "object")));
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x !== "object")) return JSON.stringify(value).replace(/,/g, ", ");
    return `[\n${value.map((v) => `${indent}  ${formatTokens(v, `${indent}  `)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    if (isLeaf(value) && indent.length >= 4) return `{ ${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${Array.isArray(v) ? formatTokens(v) : JSON.stringify(v)}`).join(", ")} }`;
    const fmt = (k, v) => (k === "$config" ? JSON.stringify(v, null, 2).replace(/\n/g, `\n${indent}  `).replace(/\[\n\s*([^\]{]*?)\n\s*\]/g, (_, items) => `[${items.split(/,\n\s*/).join(", ")}]`) : formatTokens(v, `${indent}  `));
    return `{\n${Object.entries(value).map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${fmt(k, v)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

// Figma name → the code to write (for implementing designs). Hex → token for unbound values.
function tokenMap() {
  const f = config.figma;
  const color = Object.fromEntries(entries(tokens.color).map(([k, t]) => [t.figma, { css: `var(--color-${k})`, tailwind: [`text-${k}`, `bg-${k}`, `border-${k}`] }]));
  const radius = Object.fromEntries(entries(tokens.radius).map(([k]) => [`radius/${k}`, { css: `var(--radius-${k})`, tailwind: [`rounded-${k}`] }]));
  const shadow = Object.fromEntries(entries(tokens.shadow).map(([k, t]) => [`${f.shadowPrefix}${t.figma}`, { tailwind: [`shadow-${k}`] }]));
  const type = Object.fromEntries(entries(tokens.type).flatMap(([k, t]) => [[`${f.typePrefix}${t.figma}`, { tailwind: [`type-${k}`] }], ...(t.md ? [[`${f.typePrefix}${t.figma} Desktop`, { tailwind: [`type-${k}`], note: "same utility; the md size applies from 768px" }]] : [])]));
  const byHex = {};
  for (const [k, t] of entries(tokens.color)) (byHex[colorValue(t).toLowerCase()] ??= []).push(k);
  return { color, radius, shadow, type, hexToColorTokens: byHex };
}

function figmaScript(apply) {
  return `// Generated by scripts/tokens.mjs figma-script from design-tokens.json. Run with the Figma MCP use_figma tool.\nconst APPLY = ${apply};\nconst SPEC = ${JSON.stringify(figmaSpec())};\n${PLUGIN_BODY}`;
}

// ---- CLI --------------------------------------------------------------------
const [cmd, ...rest] = process.argv.slice(2);
const errors = validate();
if (errors.length) {
  console.error(`design-tokens.json is invalid:\n${errors.join("\n")}`);
  process.exit(1);
}

if (cmd === "build") {
  for (const [rel, content] of Object.entries(generate())) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
    console.log(`wrote ${rel}`);
  }
} else if (cmd === "check") {
  const stale = Object.entries(generate()).filter(([rel, content]) => {
    const p = path.join(root, rel);
    return !fs.existsSync(p) || fs.readFileSync(p, "utf8") !== content;
  }).map(([rel]) => rel);
  const problems = lint();
  if (stale.length) console.error(`stale generated file(s), run \`node scripts/tokens.mjs build\`: ${stale.join(", ")}`);
  if (problems.length) console.error(`${problems.length} value(s) bypass design-tokens.json (silence one line with a "tokens-ignore-line" comment):\n${problems.join("\n")}`);
  if (stale.length || problems.length) process.exit(1);
  console.log("tokens check ok");
} else if (cmd === "figma") {
  console.log(JSON.stringify(figmaSpec(), null, 2));
} else if (cmd === "figma-export-script") {
  process.stdout.write(`// Generated by scripts/tokens.mjs figma-export-script. Read-only; run with use_figma and save the returned JSON.\n${EXPORT_BODY}`);
} else if (cmd === "pull") {
  const file = rest.find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: tokens.mjs pull <figma-state.json> [--write]"); process.exit(2); }
  const { next, edits, notes } = pull(JSON.parse(fs.readFileSync(file, "utf8")));
  for (const e of edits) console.log(e);
  for (const n of notes) console.log(`note: ${n}`);
  if (!edits.length) console.log("design-tokens.json already matches Figma");
  else if (rest.includes("--write")) {
    fs.writeFileSync(SOURCE, `${formatTokens(next)}\n`);
    console.log(`\nwrote design-tokens.json (${edits.length} edits); now run: node scripts/tokens.mjs build && node scripts/tokens.mjs check`);
  } else console.log(`\n${edits.length} edits (dry run; add --write to apply)`);
} else if (cmd === "map") {
  console.log(JSON.stringify(tokenMap(), null, 2));
} else if (cmd === "figma-script") {
  process.stdout.write(figmaScript(rest.includes("--apply")));
} else {
  console.error("usage: tokens.mjs build | check | map | figma | figma-script [--apply] | figma-export-script | pull <figma-state.json> [--write]");
  process.exit(2);
}
