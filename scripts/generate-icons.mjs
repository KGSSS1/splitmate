// Regenerates the PWA icons (public/icons/, src/app/apple-icon.png) from the logo (src/config/brand.ts
// colours). Run with `node scripts/generate-icons.mjs` after changing the logo.
// Uses sharp, which Next.js installs for image optimisation.
import { writeFile } from "node:fs/promises";

import sharp from "sharp";

const GREEN = "#15803d";
const MARK = `<path d="M29 14a18 18 0 0 0 0 36z" fill="#ffffff"/><path d="M35 14a18 18 0 0 1 0 36z" fill="#ffffff" fill-opacity="0.72"/>`;

/** Rounded tile for "any" icons; full-bleed square for maskable and Apple icons (the OS crops them). */
const svg = (rounded) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="${GREEN}"/>${MARK}</svg>`;

const outputs = [
  ["public/icons/icon-192.png", 192, true],
  ["public/icons/icon-512.png", 512, true],
  // The mark spans 36 of 64 units (56%), inside the 80% maskable safe zone.
  ["public/icons/maskable-512.png", 512, false],
  ["src/app/apple-icon.png", 180, false],
];

for (const [path, size, rounded] of outputs) {
  const png = await sharp(Buffer.from(svg(rounded))).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path, png);
  console.log(`${path} ${size}×${size}`);
}
