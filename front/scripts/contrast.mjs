/**
 * Contrast gate for the two ramps — the checklist item "contraste vérifié sur les deux surfaces
 * pour les quatre couleurs d'état", turned into something that can be re-run.
 *
 * Values are read out of `styles/tokens/colors.css` rather than copied here, so a token edited
 * without re-checking is caught instead of silently drifting away from a number in a comment.
 *
 * The four state colours are enforced, and so is the ink on each tinted fill — see `FILLS`, which
 * exists because the state-colour loop was never asking about those and one of them was failing.
 * The text ramp is reported but not enforced: `text-dim` is
 * deliberately de-emphasised on both ramps and raising it to 4.5 would flatten a hierarchy the
 * design asked for — that is a design decision, not a lint failure, and it is listed so nobody
 * has to rediscover it.
 */
import { readFileSync } from "node:fs";

const AA_TEXT = 4.5;

const css = readFileSync(new URL("../styles/tokens/colors.css", import.meta.url), "utf8");

const token = (name) => {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token not found: --color-${name}`);
  return match[1];
};

const toLinear = (channel) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const STATES = ["accent", "warn", "error", "info"];
const RAMPS = {
  work: ["work-surface", "work-inset"],
  chassis: ["chassis-deep", "chassis-surface", "chassis-raised"],
};

let failed = 0;

for (const [ramp, backgrounds] of Object.entries(RAMPS)) {
  console.log(`\n${ramp} — state colours (need ${AA_TEXT}:1 as text)`);
  for (const state of STATES) {
    const fg = token(`${ramp}-${state}`);
    // The worst background is the one the eye has least room against, and it is the only one
    // worth asserting: clearing it clears the others by construction.
    const worst = Math.min(...backgrounds.map((bg) => ratio(fg, token(bg))));
    const ok = worst >= AA_TEXT;
    if (!ok) failed++;
    console.log(`  ${`${ramp}-${state}`.padEnd(16)} ${fg}  worst ${worst.toFixed(2)}  ${ok ? "ok" : "FAIL"}`);
  }
}

/**
 * The tinted fills, and the ink each one actually carries — IKN-13.
 *
 * The loop above checks the four state colours against the *ramp's own* backgrounds, which is the
 * right question for text on a card and the wrong one for the service header's pills: those are the
 * one place on the work surface where a state is read as an area, so their ink sits on a tint the
 * gate had never heard of. `work-error` on `work-error-bg` measures 3.98:1 — below the bar, on a
 * pairing nothing was checking, which is exactly how a gate stops being a gate.
 *
 * Listed as pairs rather than derived, because the pairing is a design decision: the ink on a tint
 * is `work-text`, and the hue is carried by the fill and by the dot beside it.
 *
 * Only `work-text` is enforced, deliberately. The dimmed key of a chip is `work-text-dim`, which is
 * below AA on every background in the product and is the same design decision the text ramp below
 * records — a hierarchy the design asked for, not a lint failure. What has to be readable is the
 * value, and the value is `work-text`.
 */
const FILLS = [
  ["work-text", "work-ok-bg"],
  ["work-text", "work-error-bg"],
];

console.log(`\ntinted fills — ink on a state background (need ${AA_TEXT}:1 as text)`);
for (const [ink, fill] of FILLS) {
  const measured = ratio(token(ink), token(fill));
  const ok = measured >= AA_TEXT;
  if (!ok) failed++;
  console.log(`  ${`${ink} on ${fill}`.padEnd(34)} ${measured.toFixed(2)}  ${ok ? "ok" : "FAIL"}`);
}

console.log("\ntext ramp — reported, not enforced (see the note at the top of this file)");
for (const [ramp, backgrounds] of Object.entries(RAMPS)) {
  for (const name of ["text", "text-muted", "text-dim"]) {
    const fg = token(`${ramp}-${name}`);
    const worst = Math.min(...backgrounds.map((bg) => ratio(fg, token(bg))));
    console.log(
      `  ${`${ramp}-${name}`.padEnd(20)} ${fg}  worst ${worst.toFixed(2)}  ${worst >= AA_TEXT ? "ok" : "below AA"}`,
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed} pairing(s) below ${AA_TEXT}:1.`);
  process.exit(1);
}
console.log("\nAll state colours clear AA on both surfaces of their ramp, and on the tints they are used over.");
