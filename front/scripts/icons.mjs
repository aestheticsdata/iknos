/**
 * The installed-app icon set, rasterised from `public/icons/app-tile.svg` — IKN-33.
 *
 * There is one drawing, and it is the SVG. Everything below is a mechanical derivation of it, so a
 * change to the master propagates by re-running `pnpm icons` rather than by opening five PNGs.
 * Same reasoning as `contrast.mjs`: a design-system check is worth having as something replayable,
 * not as a thing somebody did once and wrote down in a commit message.
 *
 * ⚠️ The master used to be `favicon.svg`, and is not any more. The browser tab now shows the
 * monochrome mark from the favicon family — no tile, no plate, bleeding to the edges of the grid,
 * ink that follows the browser chrome — and that artwork cannot feed this script: there is no
 * `rx="7"` corner to open to 9, and a transparent glyph is not a legal maskable icon, which
 * contractually needs an opaque full-bleed tile Android may crop to any silhouette.
 *
 * So the old dark-tile drawing stayed, renamed to what it now is: the master for the *installed
 * app* icons, which are a different surface from the tab. Whether they follow the tab onto the new
 * mark is an open design question — it cannot be answered without deciding what, if anything, sits
 * behind a glyph that was drawn to have nothing behind it.
 *
 * Two derivations exist, and both are string edits on the master rather than a second drawing:
 *
 * * **the tile radius** — 7/32 as drawn, 9/32 in the app icons. The tighter corner was for reading
 *   next to browser chrome; these are read as a tile.
 * * **the render size** — librsvg rasterises at the SVG's own `width`/`height`, so the target size
 *   is written into the markup. Rendering at 32 and letting `resize()` scale up would hand back a
 *   32px bitmap blown up to 512, which is the one thing a vector master exists to avoid.
 *
 * Both edits assert that they matched. A master reformatted by an editor would otherwise be
 * silently rendered at 32px with the wrong corner, and nothing would look wrong until an icon
 * cache somewhere served the result for a week.
 *
 * No `.ico` is written any more. `src/app/favicon.ico` was a Next file convention, which means Next
 * emitted its `<link>` ahead of everything `metadata.icons` declares, by presence alone — so while
 * it existed, Safari and any bare `GET /favicon.ico` kept serving the old ring however the SVG was
 * declared. Rasterising it here would have put it straight back on the next run.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const here = import.meta.url;
const master = readFileSync(new URL("../public/icons/app-tile.svg", here), "utf8");

/**
 * A string edit that refuses to apply to markup it does not recognise.
 *
 * The test is on the pattern matching, not on the string changing. A "did anything change" guard
 * would read a substitution of a value for itself as a failure, and the radius edit has been
 * exactly that in the past — the assertion has to be that the markup was recognised, not that it
 * moved.
 */
const sub = (svg, pattern, replacement, what) => {
  if (!pattern.test(svg)) throw new Error(`favicon.svg no longer matches the ${what} pattern`);
  return svg.replace(pattern, replacement);
};

/** The master at a given pixel size, with the tile corner it wants. `radius` is in master units. */
const variant = ({ size, radius }) => {
  let svg = sub(master, /width="32" height="32"/, `width="${size}" height="${size}"`, "size");
  svg = sub(svg, /rx="7"/, `rx="${radius}"`, "tile radius");
  return Buffer.from(svg);
};

const render = (options) => sharp(variant(options)).png({ compressionLevel: 9 }).toBuffer();

const write = (path, data) => {
  const target = new URL(path, here);
  writeFileSync(target, data);
  console.log(`${path.replace("../", "")}  ${(data.length / 1024).toFixed(1)} kB`);
};

mkdirSync(new URL("../public/icons/", here), { recursive: true });

/**
 * The app icons open the corner to 9/32 — the master's 7/32 was for reading against browser chrome,
 * these are read as a tile.
 *
 * They live under `public/` rather than as `src/app/icon.png`, which is the file convention and
 * looks like the obvious home. Declaring any `metadata.icons.icon` — and the favicon SVGs have to
 * be declared, they have no convention — makes Next drop the convention's `<link>` for `icon.png`
 * and emit only what was declared, so the convention would leave a route serving a file nothing
 * points at. Public paths are also what `site.webmanifest` needs: it names URLs, and cannot name a
 * hashed one.
 */
write("../public/icons/icon-512.png", await render({ size: 512, radius: 9 }));
write("../public/icons/icon-192.png", await render({ size: 192, radius: 9 }));

/**
 * The maskable variant: a square tile, and the glyph pulled 64px in from every edge.
 *
 * Android crops a maskable icon to whatever silhouette the launcher uses — circle, squircle, teardrop
 * — so the corners are not ours to round and the safe zone is the middle 80%. The glyph is rendered
 * at 384 with a square tile of its own and dropped onto a canvas of the same colour, which is why the
 * seam does not show.
 */
const MASKABLE_MARGIN = 64;
const maskable = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: "#111820",
  },
})
  .composite([
    {
      input: await render({ size: 512 - MASKABLE_MARGIN * 2, radius: 0 }),
      top: MASKABLE_MARGIN,
      left: MASKABLE_MARGIN,
    },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();
write("../public/icons/icon-512-maskable.png", maskable);
