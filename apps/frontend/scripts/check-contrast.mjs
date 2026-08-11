#!/usr/bin/env node
/**
 * Measures every canonical token pairing in styles/tokens.css against WCAG
 * thresholds, in BOTH :root and .dark. Exits non-zero on any failure.
 *
 * This is the only place colour is measured. Spec §6 requires that no value
 * be estimated; running this is what discharges that requirement.
 *
 *   node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../src/styles/tokens.css"), "utf8");

/** Pull `--name: value;` declarations out of one top-level block. */
function readBlock(selector) {
  const re = new RegExp(
    `^${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)^\\}`,
    "m",
  );
  const m = css.match(re);
  if (!m) throw new Error(`block not found in tokens.css: ${selector}`);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    out[k] = v.trim();
  }
  return out;
}

// .dark only remaps layer 2, so it inherits every layer-1 primitive from :root.
const THEMES = {
  light: readBlock(":root"),
  dark: { ...readBlock(":root"), ...readBlock(".dark") },
};

/** Follow var(--x) chains to a literal value. */
function deref(name, scope, seen = new Set()) {
  let v = scope[name];
  if (v === undefined) throw new Error(`undefined token: ${name}`);
  while (v.startsWith("var(")) {
    const ref = v.slice(4, v.lastIndexOf(")")).trim();
    if (seen.has(ref)) throw new Error(`cyclic token reference at ${ref}`);
    seen.add(ref);
    v = scope[ref];
    if (v === undefined) throw new Error(`undefined token: ${ref} (via ${name})`);
  }
  return v;
}

/** Opaque hsl() -> linear [r,g,b] in 0..1. Throws on alpha or non-hsl. */
function toRgb(name, scope) {
  const v = deref(name, scope);
  const m = v.match(
    /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+))?\s*\)$/,
  );
  if (!m) throw new Error(`${name}: not a plain hsl() colour -> ${v}`);
  if (m[4] !== undefined) {
    throw new Error(`${name}: has alpha, cannot be measured standalone -> ${v}`);
  }
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const luminance = (rgb) =>
  rgb
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);

function ratio(fg, bg, scope) {
  const [hi, lo] = [luminance(toRgb(fg, scope)), luminance(toRgb(bg, scope))].sort(
    (a, b) => b - a,
  );
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5; // body text
const UI = 3.0; // focus rings, meaningful boundaries

/** [foreground, background, threshold] */
const PAIRS = [
  ["--text", "--surface", TEXT],
  ["--text", "--surface-raised", TEXT],
  ["--text", "--surface-sunken", TEXT],
  ["--text", "--surface-overlay", TEXT],
  ["--text", "--surface-hover", TEXT],
  ["--text-muted", "--surface", TEXT],
  ["--text-muted", "--surface-raised", TEXT],
  ["--text-muted", "--surface-sunken", TEXT],
  ["--text-muted", "--surface-overlay", TEXT],
  ["--text-subtle", "--surface", TEXT],
  ["--text-subtle", "--surface-raised", TEXT],
  ["--text-subtle", "--surface-overlay", TEXT],
  ["--text-on-brand", "--brand", TEXT],
  ["--text-on-brand", "--brand-hover", TEXT],
  ["--text-on-danger", "--danger", TEXT],
  ["--brand-text", "--surface", TEXT],
  ["--brand-text", "--surface-raised", TEXT],
  ["--danger", "--surface-raised", TEXT],
  ["--warning", "--surface-raised", TEXT],
  ["--success", "--surface-raised", TEXT],
  ["--focus", "--surface", UI],
  ["--focus", "--surface-raised", UI],
  ["--border-strong", "--surface", UI],
  ["--border-strong", "--surface-sunken", UI],
  // Sebuah input berlatar --surface-sunken duduk DI DALAM kartu
  // (--surface-raised). Batasnya harus terbaca terhadap KEDUA sisi, jadi
  // pasangan ini sama wajibnya dengan pasangan --surface-sunken di atas.
  ["--border-strong", "--surface-raised", UI],
];

/**
 * Reported, never failed.
 *
 * --brand on --surface-raised measures 2.20:1 in dark — a blue primary button
 * sitting on a raised card has almost no boundary against it. That is NOT a
 * WCAG failure: 1.4.11 exempts a filled control that is identifiable by its
 * label, and --text-on-brand on --brand passes in both themes (6.17 light /
 * 4.72 dark). Asserting 3:1 here would force the brand hue to change to
 * satisfy a rule that does not apply.
 *
 * It is recorded because the weakness is real. If any design ever relies on
 * that edge rather than on the label — a brand-filled chip with no text, an
 * icon-only primary — this is the number to revisit first.
 */
const REPORTED = [["--brand", "--surface-raised"]];

/**
 * Documented exclusions — pairings the design forbids. Reported, never failed.
 * A ban exists precisely because these do NOT meet threshold.
 */
const FORBIDDEN = [
  ["--text-subtle", "--surface-sunken"],
  ["--text-subtle", "--surface-hover"],
];

/**
 * Tokens that must exist and resolve to an opaque colour, but carry no WCAG
 * minimum. --border-subtle is a decorative in-card hairline: WCAG sets no
 * threshold for it, and forcing 3:1 would make it not subtle.
 */
const MUST_EXIST = ["--border", "--border-subtle"];

let failures = 0;

for (const [theme, scope] of Object.entries(THEMES)) {
  console.log(`\n${theme.toUpperCase()}`);

  for (const name of MUST_EXIST) {
    try {
      toRgb(name, scope);
      console.log(`  ok    ${name} defined`);
    } catch (err) {
      console.log(`  FAIL  ${name} — ${err.message}`);
      failures++;
    }
  }

  for (const [fg, bg, min] of PAIRS) {
    let r;
    try {
      r = ratio(fg, bg, scope);
    } catch (err) {
      console.log(`  FAIL  ${fg} on ${bg} — ${err.message}`);
      failures++;
      continue;
    }
    const pass = r >= min;
    if (!pass) failures++;
    console.log(
      `  ${pass ? "ok  " : "FAIL"}  ${r.toFixed(2)} (min ${min})  ${fg} on ${bg}`,
    );
  }

  for (const [fg, bg] of FORBIDDEN) {
    try {
      console.log(
        `  note  ${ratio(fg, bg, scope).toFixed(2)}  ${fg} on ${bg} — FORBIDDEN by design`,
      );
    } catch (err) {
      console.log(`  note  ${fg} on ${bg} — ${err.message}`);
    }
  }

  for (const [fg, bg] of REPORTED) {
    try {
      console.log(
        `  note  ${ratio(fg, bg, scope).toFixed(2)}  ${fg} on ${bg} — recorded, no threshold`,
      );
    } catch (err) {
      console.log(`  note  ${fg} on ${bg} — ${err.message}`);
    }
  }
}

console.log(
  failures === 0
    ? "\nAll measured pairings pass.\n"
    : `\n${failures} failure(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
