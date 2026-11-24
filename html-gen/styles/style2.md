<!-- style guide for style2.jpg; images 8b7cd0bdb7d9405f; edit freely, delete this file to describe the image again -->
## Palette

- **#F0E3C2 — parchment:** page background, board field, generous empty margins.
- **#FAF2DC — chalk ivory:** card faces, labels, negative-space cutouts, protective keylines.
- **#0B0A09 — near-black ink:** primary text, silhouettes, strong icons, main outlines.
- **#302923 — warm charcoal:** secondary marks, fine hatching, inactive icons.
- **#D83B27 — vermilion:** principal accent, selection, important emblems, narrow trim.
- **#A82720 — deep red:** pressed states, last-move trails, darker accent details.
- **#C8B995 — aged sand:** secondary rules, disabled fills, inactive tracks.
- **Player 1:** **#D83B27** vermilion; circular token, solid fill.
- **Player 2:** **#146C68** petrol; square token, two diagonal ivory slashes.
- **Player 3:** **#B77B16** ochre; diamond token, three ivory dots.
- **Player 4:** **#4B4B82** smoky indigo; hexagonal token, ivory crosshatch.
- Use player colors only for ownership—tokens, score pips, and narrow owner stripes. Always retain the unique shape/mark; never communicate ownership or game state by hue alone.

## Shapes and line work

- Combine **large, simple geometric masses** with a few asymmetrical curves, tapered points, forked terminals, and brush-like fringes. Favor one strong silhouette over many small parts.
- Let filled black or red shapes define their own edges; avoid outlining every internal feature. Use ivory cuts and sparse scratches to separate overlapping dark areas.
- At normal UI scale: board/card rules **1.5–2px**, icons **2.5–3px**, emphasis marks **4–6px**. Use round caps/joins for gestural lines and sharp miters for angular ornaments.
- Use restrained rounding: **6–8px** cards, **4–6px** buttons, **10–12px** large panels. Avoid pill buttons and excessively soft, bubbly geometry.
- Keep grids, spacing, and hit areas exact. Confine handmade irregularity to decorative edges, varying them by roughly **1–2% of object size**.
- Draw decorative tapered strokes as filled SVG paths rather than uniform-width lines. Use `vector-effect="non-scaling-stroke"` on structural SVG rules.

## Shading and texture

- Use **flat spot color for roughly 90% of the artwork**. No gradients, bevels, glossy highlights, realistic lighting, or soft airbrushing.
- Create depth through overlap, scale, negative-space cuts, and hard offset shadows—not cel-shaded volume.
- Clip **3–7 short dry-brush scratches** into large black or red fills: ivory or charcoal, **0.5–1.5px**, at **15–35% opacity**. Keep scratches away from small icons and text.
- Add paper grain with one fixed SVG overlay: `feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" seed="8"`, monochrome, `opacity: .035`, `mix-blend-mode: multiply`, `pointer-events: none`.
- For optional print misregistration, duplicate a decorative accent in vermilion and offset it **1–2px down/right**. Never offset text, board geometry, or interaction outlines.
- Cards/panels: `box-shadow: 3px 3px 0 rgba(11,10,9,.18)`. Tokens: `filter: drop-shadow(2px 2px 0 rgba(11,10,9,.2))`. Use no shadow blur.

## Typography

- **Titles and card names:** heavy, condensed, woodblock-poster character; use `Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Narrow", sans-serif`. Uppercase, `letter-spacing: .06em`, `line-height: 1.05`.
- **Rules and interface:** plain, highly legible sans; use `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`. Body copy **15–16px**, line-height **1.4**; labels **12–13px**, weight 600.
- Use `font-variant-numeric: tabular-nums` for costs, scores, and counters.
- Prefer ink on ivory or ivory on ink. Avoid small text directly on vermilion or player colors; place it on an ivory label instead. Do not distress the letterforms.

## Mood and ornament

- Aim for **stark, playful severity**: hand-pulled screen print, folk geometry, slight imperfection, and abundant quiet negative space.
- Frames use a **2px ink rule**, optionally echoed by a **1px vermilion rule offset 2px**. Break or shorten corners rather than drawing ornate continuous borders.
- Limit motifs to concentric rings, clustered dots, diamonds, triangular cuts, short parallel bars, and three-pronged terminals.
- Icons should be solid ink with **one ivory cutout and at most one red accent**, readable at **16–20px**. Avoid thin outline icon sets, emoji, and realistic illustration.
- Keep roughly **60–70% of each surface quiet**; concentrate ornament and texture inside large fills or at one corner.

## Applying the style

- **Board:** parchment field with ivory playable spaces and 1.5–2px ink rules. Reserve solid black or vermilion for major zones and sand for inactive regions. Use a sparse double-rule perimeter and small geometric zone emblems.
- **Pieces/tokens:** simple **32–44px** silhouettes with a **2–2.5px ink outline**, one ivory ownership mark, and a hard 2px shadow. Add a 1px ivory keyline when placed on dark spaces. Avoid detail that disappears below 24px.
- **Cards:** ivory **5:7** faces, 8px radius, 2px ink border, hard 3px shadow. Use a black title band with ivory lettering, one large symbolic icon, short rules text, and a narrow vermilion category stripe. Indicate rank with 1–3 small red diamonds rather than additional colors.
- **Buttons:** primary buttons are ink-filled with ivory text and a 3px vermilion leading edge; secondary buttons are ivory with a 2px ink border. Hover raises them 1px and increases the hard shadow to 4px; active uses `transform: translate(2px,2px)` and removes the shadow. Disabled buttons use sand with charcoal at 55% opacity.
- Keep ornamental asymmetry out of text alignment, card scanning order, and pointer targets.

## Selection and move highlights

- **Selected:** draw a **7px ivory SVG under-stroke** followed by a **4px vermilion top stroke**, plus four small outward triangular ticks. No glow or pulsing is needed.
- **Legal moves:** place a **16px ivory target** with a **2.5px ink ring** and **4px central ink dot** on each destination. On hover, fill the center vermilion while retaining the ring.
- **Last move:** use a **2px deep-red dashed connector**, `stroke-dasharray: 7 5`, over a **5px ivory under-stroke**. Mark the origin with an open diamond and the destination with a solid diamond.
- Draw all state markers above artwork and below labels. Their distinct ring, dot, and diamond vocabularies must remain understandable in grayscale.
