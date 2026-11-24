<!-- style guide for style4.jpeg; images 59f2ad932ae5cf44; edit freely, delete this file to describe the image again -->
## Style direction: sun-washed, timeworn classicism
- Grand, warm, and quietly cinematic: pale mineral surfaces, earthen accents, aged metal, and cool atmospheric shadows.
- Favor shallow carved relief and subtle material variation over flat vector fills or glossy plastic.
- Keep gameplay crisp; confine weathering, haze, and ornament to frames and noninteractive surfaces.

## Palette
- **#B9B7C8 — Haze lavender:** page backdrop and distant decorative panels.
- **#CBBBA0 — Sandstone:** main board and large neutral surfaces.
- **#EEE3CC — Sunlit ivory:** card faces, dialogs, and light token inlays.
- **#8A7C6B — Stone shadow:** recesses, grid shading, and disabled surfaces; not small text.
- **#373235 — Warm charcoal:** primary text, deep outlines, and darkest shadows; use instead of black.
- **#77633F — Aged bronze:** frames, secondary labels, icons, and structural borders.
- **#A65F47 — Terracotta:** section accents, special board zones, and last-move markers.
- **#697052 — Muted olive:** secondary board inlays and quiet decorative patterns.
- **#C2A15B — Antique gold:** primary buttons, important trim, and selected-state support.
- **#F5D9A4 — Sunlight:** upper-left edge glints, hover warmth, and selection rings.

**Player colors**
- **Lapis #245FA8:** ivory circular emblem.
- **Crimson #B13A3A:** ivory diamond emblem.
- **Teal #0F716B:** ivory triangular emblem.
- **Ochre #C68A22:** charcoal square emblem.
- Give every player piece a 2px #373235 outer outline and its unique emblem; never rely on hue alone. Reserve these colors mainly for pieces, ownership marks, and player-status UI.

## Shapes and line work
- Use symmetrical, rectilinear construction with restrained chamfers; organic detail belongs only in texture.
- Corner radii: board **10px**, cards/dialogs **6px**, buttons **4px**, small tags **3px**.
- Cards and panels: **1px #77633F** border plus an inset **1px rgba(238,227,204,.55)** highlight; reserve **2px #373235** outlines for tokens and small interactive silhouettes.
- Build forms from rectangles, circles, hexagons, and 45° chamfers. Avoid bubbly rounding, thin fragile outlines, and irregular hand-drawn contours.
- Board grids: **1px #77633F at 35% opacity**; major divisions: **2px at 65% opacity**. Keep grid contrast below that of pieces.
- Icons use geometric silhouettes on a **24px grid**, with **1.75px strokes**, round joins, and minimal interior detail.

## Shading and texture
- Use shallow directional relief, lit from the upper left: sunlit top/left edges, warm-gray recesses, and cool charcoal lower/right shadows.
- Page backdrop: **radial-gradient(circle at 10% 0%, #F5D9A4 0%, #EEE3CC 22%, #B9B7C8 80%)**. Keep the center quiet so the board dominates.
- Large stone surfaces: **linear-gradient(145deg, #EEE3CC 0%, #CBBBA0 58%, #8A7C6B 145%)**. Keep cards nearly flat for readability.
- Panel shadow: **0 10px 24px rgba(55,50,53,.20), 0 2px 4px rgba(55,50,53,.18)**. Token shadow: **0 3px 0 rgba(55,50,53,.35), 0 6px 10px rgba(55,50,53,.20)**.
- Add restrained bevels with **inset 1px 1px 0 rgba(245,217,164,.55)** and **inset -1px -1px 0 rgba(55,50,53,.22)**. Avoid glossy highlights and deep 3D extrusion.
- SVG grain: **feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3"**, clipped to surfaces at **3–5% opacity** with **mix-blend-mode: multiply**. Never place visible grain over text or icons.
- Optional surface pattern: sparse carved flecks or a low-contrast fret repeat at **4% opacity**. No photographic textures.

## Typography
- Titles: sturdy, inscription-like serif capitals with generous spacing; use **font-family: "Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", serif; font-weight: 600; letter-spacing: .08em**.
- Card rules and longer text: **font-family: Georgia, "Times New Roman", serif**, **15–17px**, **line-height: 1.45**, in **#373235**.
- Counters, compact labels, and buttons: **font-family: "Segoe UI", Tahoma, Geneva, sans-serif; font-weight: 600**. Use tabular numerals for scores and resources.
- Use uppercase only for titles and labels of roughly 12 characters or fewer. Do not use bronze or gold for small body text.
- Keep typography clean and untextured; suggest age through spacing, rules, and frames rather than distressed letterforms.

## Mood and ornament
- Aim for monumental calm, warmth, and restrained age—not clutter, fantasy filigree, or museum reconstruction.
- Frame major panels with an outer **2px #77633F** rule and an inner **1px rgba(245,217,164,.65)** rule, offset **4–6px**.
- Limit ornament to frame corners, title dividers, and card headers: small rosettes, stepped frets, sunburst ticks, or paired geometric leaves.
- Keep at least **85% of each play surface ornament-free**. Decorative motifs should remain visible at full size without competing at board scale.

## Applying the style
- **Board:** present it as a sandstone slab on the hazy backdrop. Use shallow inset cells, subtle value variation, and low-contrast terracotta or olive zone washes. Keep the gameplay plane orthographic; do not perspective-transform labels or hit targets.
- **Pieces and tokens:** use bold **36–52px** silhouettes with a dark outer keyline, a narrow sunlit bevel, and a player-color center. Lighten the upper-left portion by roughly **12%** and darken the lower-right by **20%**. Place the player’s ivory or charcoal emblem centrally.
- **Cards:** use a **5:7** ivory face, **6px** radius, thin bronze border, compact serif title band, generous rules-text area, and one bronze cost medallion. Optional artwork should sit in a recessed rectangular window with no more than one ornamental divider.
- **Buttons:** primary buttons use **#C2A15B** with **#373235** text, a bronze border, and a top-edge ivory glint. Secondary buttons use ivory. Hover brightens toward **#F5D9A4**; pressed state uses **translateY(1px)** and removes the lower shadow.
- **Hover:** add a **1px #F5D9A4** inner edge and lift cards or buttons by at most **2px**. Do not move board cells.
- **Selection:** use **box-shadow: 0 0 0 2px #373235, 0 0 0 5px #F5D9A4, 0 0 18px rgba(245,217,164,.65)**. Add a small gold diamond marker so selection remains identifiable without color perception.
- **Legal moves:** show a **2px dashed #373235** ring, a translucent olive cell wash, and a centered ivory dot. Use terracotta corner brackets plus a distinct capture icon for hostile targets.
- **Last move:** mark origin and destination with terracotta corner chevrons and connect them with a restrained **2px rgba(166,95,71,.65)** route line. Keep this visible until the next move, but below selection and legal-move indicators.
- Use **120–180ms ease-out** transitions for hover and selection; avoid perpetual glow or pulsing. Disable nonessential motion under reduced-motion settings.
