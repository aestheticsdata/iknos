/**
 * The site's icon set, rasterised from `public/icons/favicon.svg` — IKN-33.
 *
 * There is one drawing, and it is the SVG. Everything below is a mechanical derivation of it, so a
 * change to the master propagates by re-running `pnpm icons` rather than by opening five PNGs.
 * Same reasoning as `contrast.mjs`: a design-system check is worth having as something replayable,
 * not as a thing somebody did once and wrote down in a commit message.
 *
 * Two derivations exist, and both are string edits on the master rather than a second drawing:
 *
 * * **the tile radius** — 7/32 in the favicon, 9/32 in the app icons. The small one is read next to
 *   browser chrome and wants the tighter corner; the large one is read as an app tile.
 * * **the render size** — librsvg rasterises at the SVG's own `width`/`height`, so the target size
 *   is written into the markup. Rendering at 32 and letting `resize()` scale up would hand back a
 *   32px bitmap blown up to 512, which is the one thing a vector master exists to avoid.
 *
 * Both edits assert that they matched. A master reformatted by an editor would otherwise be
 * silently rendered at 32px with the wrong corner, and nothing would look wrong until an icon
 * cache somewhere served the result for a week.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const here = import.meta.url;
const master = readFileSync(new URL("../public/icons/favicon.svg", here), "utf8");

/**
 * A string edit that refuses to apply to markup it does not recognise.
 *
 * The test is on the pattern matching, not on the string changing: the 32px entry of the `.ico` and
 * the favicon's own 7/32 corner both substitute a value for itself, and a "did anything change"
 * guard would call those failures.
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

/**
 * A multi-resolution `.ico`, written by hand — 16 bytes of directory per entry around PNG payloads
 * every browser that still reads `.ico` has understood for fifteen years. The alternative was a
 * dependency whose whole job is this function.
 *
 * The size byte is the literal pixel count (0 would mean 256, which is why nothing here is 256).
 */
const ico = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon, 2 would be cursor
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const directory = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...directory, ...images.map(({ data }) => data)]);
};

const write = (path, data) => {
  const target = new URL(path, here);
  writeFileSync(target, data);
  console.log(`${path.replace("../", "")}  ${(data.length / 1024).toFixed(1)} kB`);
};

mkdirSync(new URL("../public/icons/", here), { recursive: true });

// The favicon keeps the master's 7/32 corner at every size it is served at.
const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(icoSizes.map(async (size) => ({ size, data: await render({ size, radius: 7 }) })));
write("../src/app/favicon.ico", ico(icoImages));

/**
 * The app icons open the corner to 9/32 — the small one is read against browser chrome and wants
 * the tighter corner, these are read as a tile.
 *
 * They live under `public/` rather than as `src/app/icon.png`, which is the file convention and
 * looks like the obvious home. Declaring any `metadata.icons.icon` — and the SVG has to be
 * declared, it has no convention — makes Next drop the convention's `<link>` for `icon.png` and
 * emit only what was declared. `favicon.ico` is special-cased and survives; `icon.png` does not.
 * So the convention would leave a route serving a file nothing points at. Public paths are also
 * what `site.webmanifest` needs: it names URLs, and cannot name a hashed one.
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
