import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveStyle, listStyles, styleMessages, formatStyle, noStyle, styleCachePath, imageDigest, readCachedGuide, writeCachedGuide,
} from "../src/style.js";

async function stylesDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "styles-"));
  await fs.writeFile(path.join(dir, "castle.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(path.join(dir, "Neon City.JPG"), "jpg");
  await fs.writeFile(path.join(dir, "notes.txt"), "not an image");
  return dir;
}

test("resolveStyle finds images by name, with or without extension, and lists choices on a miss", async () => {
  const dir = await stylesDir();
  assert.deepEqual(await resolveStyle(undefined, dir), []);
  assert.deepEqual(await resolveStyle("", dir), []);
  assert.deepEqual(await resolveStyle("castle", dir), [path.join(dir, "castle.png")]);
  assert.deepEqual(await resolveStyle(" castle.png , Neon City.JPG ", dir),
    [path.join(dir, "castle.png"), path.join(dir, "Neon City.JPG")]);
  assert.deepEqual(await resolveStyle(path.join(dir, "castle.png"), "/nonexistent"), [path.join(dir, "castle.png")]);
  await assert.rejects(resolveStyle("forest", dir), /no image named "forest".*Available: Neon City\.JPG, castle\.png/);
  await assert.rejects(resolveStyle("notes.txt", dir), /not a supported image/);
  assert.deepEqual(await listStyles(dir), ["Neon City.JPG", "castle.png"]);
  assert.deepEqual(await listStyles(path.join(dir, "missing")), []);
});

test("resolveStyle accepts a style.md from an earlier run", async () => {
  const dir = await stylesDir();
  const md = path.join(dir, "style.md");
  await fs.writeFile(md, "- Palette: #000");
  assert.deepEqual(await resolveStyle(md, "/nonexistent"), [md]);
});

test("styleMessages sends every image as a data URL with style-only instructions", async () => {
  const dir = await stylesDir();
  const [system, human] = await styleMessages([path.join(dir, "castle.png"), path.join(dir, "Neon City.JPG")]);
  assert.match(system.content, /art director/);
  const [text, ...images] = human.content;
  assert.match(text.text, /blend them/);
  assert.match(text.text, /not the image's subject/);
  assert.deepEqual(images.map((i) => i.image_url.url), [
    `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`,
    `data:image/jpeg;base64,${Buffer.from("jpg").toString("base64")}`,
  ]);
});

test("formatStyle wraps the guide and falls back when empty", () => {
  assert.equal(formatStyle("", ["a.png"]), noStyle);
  const text = formatStyle("- Palette: #123456", ["/x/castle.png"]);
  assert.match(text, /from castle\.png/);
  assert.match(text, /do not load or embed any image files/);
  assert.match(text, /#123456$/);
});

test("a style guide is saved next to its image and reused only for the same image", async () => {
  const dir = await stylesDir();
  const png = path.join(dir, "castle.png");
  const jpg = path.join(dir, "Neon City.JPG");
  const cache = styleCachePath([png]);
  assert.equal(cache, path.join(dir, "castle.md"));
  assert.equal(styleCachePath([png, jpg]), path.join(dir, "castle+Neon City.md"));

  const digest = await imageDigest([png]);
  assert.equal(await readCachedGuide(cache, digest), null);
  await writeCachedGuide(cache, digest, [png], "- Palette: #123456\n");
  assert.equal(await readCachedGuide(cache, digest), "- Palette: #123456");
  assert.match(await fs.readFile(cache, "utf8"), /^<!-- style guide for castle\.png; images [0-9a-f]{16};/);

  // Hand edits below the header are kept.
  await fs.appendFile(cache, "- Borders: thick\n");
  assert.equal(await readCachedGuide(cache, digest), "- Palette: #123456\n- Borders: thick");

  // Replacing the image makes the saved guide stale.
  await fs.writeFile(png, "a different picture");
  assert.equal(await readCachedGuide(cache, await imageDigest([png])), null);

  // The cached .md is not offered as an image, and STYLE=castle still finds the image.
  assert.deepEqual(await listStyles(dir), ["Neon City.JPG", "castle.png"]);
  assert.deepEqual(await resolveStyle("castle", dir), [png]);
});
