<!-- style guide for style3.jpg; images b38ce107f57dc466; edit freely, delete this file to describe the image again -->
## Palette

- **#1D1647 — Midnight indigo:** page background, deepest shadows, primary outlines, dark text on light buttons.
- **#2A1749 — Dark plum:** board, card, dialog, and toolbar surfaces.
- **#5A2D86 — Muted purple:** secondary panels, grid lines, disabled controls, recessed areas.
- **#793CC0 — Electric violet:** principal accent surfaces, decorative fields, secondary buttons.
- **#BA72ED — Bright lilac:** top/left bevels, secondary labels, inactive icons, edge highlights.
- **#D94F88 — Berry pink:** category bands, ornamental accents, special-card details.
- **#F47D8E — Coral:** warm emphasis, last-move traces, destructive or urgent actions.
- **#FFA783 — Apricot:** warm light planes, hover accents, gradient highlights.
- **#FFE896 — Pale gold:** selection, important values, costs, primary-button fill.
- **#FFF4C7 — Warm cream:** primary text, icon glints, brightest edge pixels.

**Player colors**

- **Player 1 — #55E6E6 cyan:** pixel-circle emblem; single-dot texture.
- **Player 2 — #FFD166 amber:** stepped-triangle emblem; horizontal-stripe texture.
- **Player 3 — #F45B9B hot pink:** pixel-square emblem; diagonal-hatch texture.
- **Player 4 — #A6E66D lime:** stepped-diamond emblem; crosshatch texture.
- Pair every color with its emblem and texture; never make ownership depend on hue alone.

## Shapes and Line Work

- Use chunky pixel art: author icons on **16×16, 24×24, or 32×32 grids**, then scale only by integer factors. At the standard 2× scale, one art pixel equals **2 CSS px**.
- Favor orthogonal silhouettes, clipped corners, stepped diagonals, and small clusters of irregular pixels. Avoid smooth curves and rounded “app UI” pills.
- Use `shape-rendering="crispEdges"` for SVG and `image-rendering: pixelated` for raster assets. Keep positions and translations on whole pixels.
- Cards and panels have **square or 4–8 px chamfered corners**, not large border radii.
- Use **2 px outlines** on small icons and **4 px outlines** on tokens, cards, and major controls, normally in **#1D1647**.
- Outline important foreground objects selectively; background ornament should remain lower contrast and mostly unoutlined.
- Light comes from the upper left: thin lilac or cream top/left edges, dark plum bottom/right edges.

## Shading and Texture

- Use **2–4 hard-edged tones per object**, with pixel-cluster cel shading rather than airbrushing. Keep cards and controls largely flat for readability.
- Reserve smooth color transition for the distant page backdrop: `linear-gradient(180deg, #1D1647 0%, #793CC0 45%, #D94F88 75%, #FFA783 100%)`.
- Break gradient transitions with sparse **4×4 ordered dithering**, checker pixels, short dashes, and clustered speckles. Keep texture opacity around **8–16%**.
- Concentrate texture in the backdrop, frame, and card-art windows. Keep board cells, rules text, and icon interiors quiet.
- Use hard offset shadows: `box-shadow: 4px 4px 0 #1D1647`; raised cards may use `6px 6px 0 #1D1647`. Avoid blurred drop shadows.
- Add only occasional one- or two-pixel cream glints. Avoid gloss, realistic materials, full-screen noise, and continuous grain over text.

## Typography

- Use a local monospace stack for titles, buttons, labels, and values: `ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "Liberation Mono", monospace`.
- Use a highly legible local stack for longer rules text: `system-ui, -apple-system, "Segoe UI", Arial, sans-serif`.
- Titles are **700 weight, uppercase**, with `letter-spacing: 0.06em`; use 24–32 px for screen titles and 18–20 px for card titles.
- Keep body text at least **16 px**, with approximately **1.45 line-height**. Use tabular numerals for scores, costs, and counters.
- Primary text is **#FFF4C7**; secondary labels are **#BA72ED**; important values are **#FFE896**.
- A heading may use `text-shadow: 2px 2px 0 #1D1647`. Do not pixelate, outline, or shadow paragraphs.

## Mood and Ornament

- Aim for a **dreamlike, luminous twilight arcade** mood: deep plum UI surfaces against saturated violet, coral, apricot, and gold.
- Frames use two nested stepped bands, corner brackets, tiny notches, and occasional broken dithered strips.
- Decorate with four-point sparkles, diamonds, chevrons, short stepped arcs, and compact pixel bursts. Avoid detailed filigree or realistic ornament.
- Icons are filled pixel silhouettes with one interior highlight, not thin line icons or emoji.
- Keep ornament to roughly **10–15% of a panel’s area**, concentrated at edges. The playable center should read immediately.

## Applying the Style

**Board**

- Place a low-texture **#2A1749** playing surface inside a 4 px indigo outline and a 2 px lilac top/left bevel; add an 8 px hard shadow.
- Use **2 px #5A2D86 grid or track lines**, with stronger violet lines only for major regions. Keep cells broad and visually calm.
- Put dither and bright gradient color around the board perimeter, not beneath pieces or labels.

**Pieces and tokens**

- Use compact 24×24 or 32×32 artwork displayed at an integer scale, typically **48×48 or 64×64 CSS px**.
- Give every token a 4 px dark silhouette, a player-color body, a small upper-left highlight, and a darker lower-right cluster.
- Make player emblems readable at token center; use different silhouettes as well as different textures.

**Cards**

- Use a dark plum body, chamfered corners, a violet or berry category strip, cream title, and gold cost badge.
- Keep rules areas flat and spacious. Restrict miniature artwork to a separate window with 2–4-tone shading and sparse dithering.
- On hover, raise the card with `transform: translate(-2px, -2px)` and increase the hard shadow; do not use a soft floating animation.

**Buttons**

- Primary: **#FFE896 fill, #1D1647 text**, apricot pressed state, cream hover edge.
- Secondary: **#793CC0 fill, #FFF4C7 text**, lilac hover edge.
- Use uppercase labels and clipped corners. Pressed buttons move **2 px down/right** while their shadow contracts.

**Selection, legal moves, and last move**

- **Hover/focus:** 2 px lilac inset outline; keyboard focus also receives a dark separation ring.
- **Selected:** solid **4 px #FFE896 outline**, four cream corner brackets, and a 2–4 px lift.
- **Legal moves:** cyan **2 px dotted inset outline** plus a central stepped diamond; show a small “place” or “move” glyph where space permits.
- **Last move:** persistent **4 px #F47D8E route or trace**, with an open square at the origin and a filled square at the destination. Do not flood the whole cell.
- Use short, one-shot motion of **100–160 ms with `steps(2, end)`** for moves and deals; avoid continuous pulsing and respect reduced-motion settings.
