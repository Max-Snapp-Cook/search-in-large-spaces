// style.js
// Art style from reference images. STYLE names one or more images in styles/ (or paths to them).
// A vision model describes each image's look as a written style guide, and the code and repair
// prompts follow that guide. The game draws its own art in that style; the images themselves
// are never copied into the game.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const imageTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
// Most vision APIs reject images much larger than this once base64-encoded.
const maxImageBytes = 15 * 1024 * 1024;

export const noStyle = "(none: choose a distinctive visual theme suited to the game)";

// Resolves STYLE ("castle", "castle.png", "a.png,b.jpg", "../art/x.png", or a style.md from an
// earlier run) to files. Bare names are looked up in stylesDir, with or without an extension.
export async function resolveStyle(spec, stylesDir) {
  const names = String(spec ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const files = [];
  for (const name of names) {
    const candidates = [path.resolve(name), path.join(stylesDir, name)];
    if (!path.extname(name)) {
      for (const ext of [...Object.keys(imageTypes), ".md"]) candidates.push(path.join(stylesDir, name + ext));
    }
    let found = null;
    for (const file of candidates) {
      if (await fs.stat(file).then((s) => s.isFile(), () => false)) { found = file; break; }
    }
    if (!found) {
      const available = await listStyles(stylesDir);
      throw new Error(`STYLE: no image named "${name}" in ${stylesDir}. `
        + (available.length ? `Available: ${available.join(", ")}.` : "Put a .png/.jpg/.webp/.gif there first."));
    }
    const ext = path.extname(found).toLowerCase();
    if (!imageTypes[ext] && ext !== ".md") {
      throw new Error(`STYLE: ${found} is not a supported image (${Object.keys(imageTypes).join(", ")}) or a style.md.`);
    }
    files.push(found);
  }
  return files;
}

export async function listStyles(stylesDir) {
  const entries = await fs.readdir(stylesDir).catch(() => []);
  return entries.filter((f) => imageTypes[path.extname(f).toLowerCase()]).sort();
}

// The vision request: instructions plus every image as a data URL.
export async function styleMessages(imageFiles) {
  const images = [];
  for (const file of imageFiles) {
    const data = await fs.readFile(file);
    if (data.length > maxImageBytes) {
      throw new Error(`STYLE: ${file} is ${(data.length / 1e6).toFixed(1)} MB; shrink it below ${maxImageBytes / 1e6} MB.`);
    }
    const type = imageTypes[path.extname(file).toLowerCase()];
    images.push({ type: "image_url", image_url: { url: `data:${type};base64,${data.toString("base64")}` } });
  }
  const several = imageFiles.length > 1 ? "these reference images (blend them into one coherent style)" : "this reference image";
  return [
    new SystemMessage("You are an art director who writes precise style guides that a programmer can reproduce in SVG and CSS."),
    new HumanMessage({
      content: [
        {
          type: "text",
          text: `Study ${several} and write a style guide for drawing a browser board or card game in the same visual style.
Describe the style only, not the image's subject: the game will have its own board, pieces, and cards, and must not
copy or include the image itself.

Cover, concretely:
- Palette: 6 to 10 colors as hex codes, each with its role (background, surfaces, outlines, accents, text), plus
  4 distinct, high-contrast player colors that fit the palette.
- Shapes and line work: geometric or organic, corner rounding, stroke weight and color, outlines or none.
- Shading and texture: flat, gradients, cel shading, grain, patterns, shadows (with CSS/SVG values where possible).
- Typography: font character and CSS font-family stacks using fonts available offline (no web fonts).
- Mood and ornament: borders, frames, icons, decorative motifs, how much detail.
- How to apply it: the board, pieces/tokens, cards, buttons, and highlights for selection, legal moves, and the last move.

Write it as short, specific bullet points under headings. No code blocks.`,
        },
        ...images,
      ],
    }),
  ];
}

// Saved style guides. The first time an image (or a set of images) is described, the guide is saved
// next to it, e.g. styles/style2.jpg -> styles/style2.md, and later runs reuse it instead of asking
// the model again. The file records a hash of the image(s), so replacing an image makes it describe
// the new one. Edit the guide by hand to tweak the style; delete it to have the image described again.
export function styleCachePath(imageFiles) {
  const names = imageFiles.map((f) => path.basename(f, path.extname(f)));
  return path.join(path.dirname(imageFiles[0]), `${names.join("+")}.md`);
}

export async function imageDigest(imageFiles) {
  const hash = createHash("sha256");
  for (const file of imageFiles) hash.update(await fs.readFile(file));
  return hash.digest("hex").slice(0, 16);
}

const cacheHeader = /^<!-- style guide for (.*?); images ([0-9a-f]+);.*?-->\n/;

// Returns the saved guide if it exists and was made from these exact images, else null.
export async function readCachedGuide(cachePath, digest) {
  const text = await fs.readFile(cachePath, "utf8").catch(() => null);
  const match = text?.match(cacheHeader);
  if (!match || match[2] !== digest) return null;
  const guide = text.slice(match[0].length).trim();
  return guide || null;
}

export async function writeCachedGuide(cachePath, digest, imageFiles, guide) {
  const names = imageFiles.map((f) => path.basename(f)).join(", ");
  const header = `<!-- style guide for ${names}; images ${digest}; edit freely, delete this file to describe the image again -->\n`;
  await fs.writeFile(cachePath, `${header}${guide.trim()}\n`);
}

// Formats a style guide for the code prompts.
export function formatStyle(guide, sources) {
  const text = String(guide ?? "").trim();
  if (!text) return noStyle;
  const from = sources?.length ? ` (from ${sources.map((f) => path.basename(f)).join(", ")})` : "";
  return `Follow this art style${from} for every visual: board, pieces, cards, panels, and highlights.
It replaces the contract's "distinctive visual theme" choice; still keep moves and highlights easy to read.
Draw everything yourself in SVG/CSS/canvas; do not load or embed any image files.

${text}`;
}
