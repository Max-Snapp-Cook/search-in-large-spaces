<!-- style guide for style1.jpeg; images 38c5426c2274ede2; edit freely, delete this file to describe the image again -->
## Visual direction
- Warm, cheerful, low-resolution pixel art with chunky silhouettes, hand-placed texture, and sunlit top/left lighting.
- Keep environments and illustrations richly detailed; keep cards, controls, and interaction states comparatively quiet.
- Favor a handcrafted 16-bit character over smooth vector art, glossy UI, or realism.

## Core palette
- **#F2C14E** — golden ochre; main background and open board surfaces.
- **#D99A3D** — shaded ochre; tile variation, recessed areas, and warm shadow planes.
- **#7FBD3F** — fresh green; secondary regions and positive decorative accents.
- **#2F6B3B** — deep green; dark regional shading and patterned borders.
- **#C65A3A** — terracotta; primary accent, headers, and last-move markers.
- **#9A5B32** — warm timber; frames, button bevels, and secondary surfaces.
- **#5A3828** — dark umber; deep frame edges, pressed states, and material shadows.
- **#2A2530** — near-black plum; principal outlines and dark text.
- **#FFF0C2** — parchment cream; card faces, light text, icons, and highlights.
- **#70B8C8** — clear cyan-blue; cool counteraccent, selection, and keyboard focus.

## Player colors
- **Player 1: #145DA0** — lapis blue; pair with a circle emblem.
- **Player 2: #C62F3B** — crimson; pair with a triangle emblem.
- **Player 3: #6F3FA0** — royal purple; pair with a square emblem.
- **Player 4: #008C72** — jade teal; pair with a diamond emblem.
- Give every piece a **1–2 logical-pixel #2A2530 outline** and repeat its emblem on tokens, card ownership marks, and score displays. Never rely on hue alone.

## Shapes and line work
- Work on a **16 px logical tile grid**; make board cells 32–48 logical pixels and scale the finished scene by an integer **2×–4×**.
- Build UI from rectangles with **0 radius or 1–2 px stair-stepped cut corners**. Avoid pills and large CSS border radii.
- Construct organic silhouettes from stepped pixel clusters, not smooth Bézier curves. Keep irregularity deliberate rather than randomly jagged.
- Use **1 logical px** for internal detail and **2 logical px** for major silhouettes, cards, and panel perimeters.
- Outline with **#2A2530** or **#5A3828**, never pure black. Use selective outlines: strongest underneath and on the lower/right edge.
- Keep SVG coordinates integral and use **shape-rendering: crispEdges**; use **image-rendering: pixelated** for scaled raster assets.

## Shading and texture
- Use flat color with **2–3 hard tonal steps per material**. Light comes from the upper left; place the darkest step on the lower right.
- Use no gradients, blur, airbrushing, or glossy highlights. Indicate volume with pixel clusters and short stepped bands.
- Suggest materials economically: parallel broken lines for timber, staggered blocks for masonry, and clustered speckles for ground or foliage-like surfaces.
- Restrict dithering to material transitions and small patches. Keep random speckling below roughly **5–8% of a surface**, and leave at least **70% of each playable cell visually calm**.
- Prefer repeatable SVG pattern tiles over noise or turbulence filters.
- At **3× display scale**, use card/panel shadows such as **box-shadow: 6px 6px 0 rgba(42,37,48,.28)** and button shadows such as **box-shadow: 0 3px 0 #5A3828**. Always use zero blur.
- Token ground shadows should be small, stepped shapes offset **1–2 logical pixels down/right**, not soft ellipses.

## Typography
- Use compact, squared, monospaced lettering for titles, values, and short labels: **font-family: Consolas, "Lucida Console", Monaco, "Courier New", monospace**.
- Make headings bold, short, and optionally uppercase, with **letter-spacing: .04em**. Avoid long uppercase rules text.
- For longer instructions, use **font-family: Verdana, Geneva, sans-serif** at **14–16 px**, line-height **1.35–1.45**. Keep interface labels at least **12 CSS px**.
- Use **#2A2530 on #FFF0C2** for primary reading. Use cream text only on dark umber or near-black surfaces.
- Place text on solid plates, never directly over dense texture. Use a single hard pixel shadow for large display headings only.

## Mood and ornament
- Aim for sunny, tactile, lightly whimsical, and welcoming—not grim, luxurious, or futuristic.
- Frame major panels with a **2 px dark outer edge, 1 px timber band, and 1 px warm top/left highlight**. Tiny square corner pegs may punctuate large frames.
- Draw icons on a **16×16 logical grid**, using filled silhouettes, one dark outline, and two or three tones. Avoid thin line-art icons.
- Use small diamonds, dots, chevrons, and short sprig-like clusters as ornament. Keep decoration below roughly **10% of card area**.
- Concentrate detail in board margins and illustration windows; leave rules text, values, and click targets unobstructed.

## Applying the style
- **Board:** Support any grid, track, or region topology. Use ochre as the quiet base, two-tone patches for variation, and green or terracotta sparingly for major zones. Separate cells with broken or dotted 1 px marks rather than a heavy modern grid; give the whole board a substantial timber-style frame.
- **Pieces and tokens:** Build on **16×16 or 24×24 grids** with recognizable silhouettes at a glance. Use the player color on at least the base or outer ring, add the player emblem in cream, and finish with a hard ground shadow.
- **Cards:** Use a cream face, 2 px dark outline, 1 px timber inset, and stepped corners. Reserve the upper **45–55%** for pixel illustration or a large icon; keep rules below on untextured cream. Put cost/value in one compact framed badge.
- **Buttons:** Use squared or clipped corners, a dark umber face, timber top/left bevel, and cream label. Add a terracotta stripe to the primary action. Hover brightens one tonal step; pressing moves the face down **1 logical pixel** and reduces its lower shadow.
- **Card selection:** Raise the card **1–2 logical pixels** and expose more hard shadow; do not smoothly scale it or add a glow.

## Interaction highlights
- **Hover:** Add a 1 logical-pixel cream inset edge; keep the underlying artwork unchanged.
- **Selected:** Add a **2 px #70B8C8 outline** with a 1 px dark outer keyline and pronounced corner ticks. Lift the selected piece by 1 logical pixel.
- **Legal moves:** Place a small **cream diamond with a dark outline** at each legal destination. Avoid flooding entire cells with translucent color.
- **Last move:** Mark origin and destination with **terracotta L-shaped corner brackets**; optionally connect them with a sparse dark-edged dotted path. Keep this static until the next move.
- **Keyboard focus:** Add a second cream outline outside the cyan selection/focus ring so it remains visible on every surface.
- Snap state changes between pixel positions. Avoid neon glows, soft pulses, blurred overlays, and fractional-pixel movement.
