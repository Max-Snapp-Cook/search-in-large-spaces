<!-- style guide for style5.jpg; images 30a8d7487fdbc101; edit freely, delete this file to describe the image again -->
# Neon Arcade Blueprint

## Palette
- **#04142E — Deep background:** page edges, vignette, recessed text panels.
- **#092C67 — Surface base:** board field, cards, dialogs.
- **#075FC4 — Raised surface:** panel gradients, headers,hovered cells.
- **#0094F6 — Electric blue:** frames, tracks, primary buttons, active dividers.
- **#06101D — Outline ink:** nearly black navy for outlines, hard shadows, and text on bright fills.
- **#F4FBFF — Primary light:** main text, icon highlights, selection keylines.
- **#8DB9DE — Secondary light:** secondary text, disabled icons, background grids; use at 6–18% opacity for decoration.
- **#00DFFC — Neon cyan:** focus edges, emissive details, neutral glows.
- **Player 1: #00DFFC cyan.**
- **Player 2: #8CFF00 lime.**
- **Player 3: #FF3DBE hot pink.**
- **Player 4: #FFD43B amber.**
- All player colors work on #092C67; use #06101D for text/icons placed inside their bright fills. Pair each color with a distinct silhouette or pattern—solid, stripes, dots, chevrons—so ownership never depends on hue alone.

## Shapes and Line Work
- Favor crisp vector geometry: rectangles, stepped edges, 45° chamfers, diamonds, and concentric frames. Avoid bubbly curves and pill-shaped controls.
- Keep corners sharp or nearly sharp: panels 0–2px radius; cards and buttons 2–4px; optionally replace corners with 6–10px chamfers.
- At 1× UI scale, use **2px strokes for icons and small panels, 3px for cards, and 4px for major pieces**. Use #06101D, square caps, and miter joins.
- Give important pieces a double treatment: thick ink outline plus a 1px light or cyan edge on the top/left. Leave background ornament unoutlined.
- Build any block-style display lettering on a modular grid, but keep normal UI text conventionally typeset and highly legible.

## Shading, Texture, and Shadows
- Keep objects predominantly flat, with at most **three tones: base fill, darker lower/right plane, and narrow light edge**. Use hard cel-shaded transitions rather than airbrushed modeling.
- Page background: radial-gradient(ellipse at 50% 40%, #075FC4 0%, #092C67 58%, #04142E 100%). Add only a restrained central #0094F6 glow where more energy is needed.
- Cards and panels: linear-gradient(180deg, #075FC4 0%, #092C67 78%); brighten the top edge with a 1px inset highlight.
- Panel shadow: box-shadow: 0 4px 0 #06101D, 0 0 18px rgba(0,223,252,.18), inset 0 1px 0 rgba(244,251,255,.16).
- For SVG glow, duplicate the shape behind the source, apply feGaussianBlur with stdDeviation="3", set opacity around .45, then place the crisp source above it. Reserve glow for active or emissive elements.
- Use sparse digital texture: 32–48px grids and oversized rectangular outlines at 6–10% opacity, plus optional radial beams at 3–5% white. **No paper grain, noise, scratches, or realistic material texture.**

## Typography
- **Display/screen titles:** Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif; uppercase, weight 900, line-height .9–1, letter-spacing .01–.03em.
- Display lettering may use a vertical two-stop fill, light at top and 20–25% darker below, with a 3px ink stroke and optional thin light outer keyline. Do not outline body text.
- **UI and card text:** system-ui, "Segoe UI", "Trebuchet MS", Tahoma, Arial, sans-serif; weight 600–700 for labels and 400–600 for rules text.
- **Counters and numerical stats:** "Consolas", "Menlo", "Courier New", monospace; use tabular numerals where supported.
- Use 14–16px for normal UI, 13–15px for card rules, and 11–12px uppercase for short labels. Avoid tiny pixel text and web-font dependencies.

## Mood and Ornament
- Aim for **high-energy, competitive, technological, and playful**: luminous color over deep blue, with precise blueprint-like structure.
- Frames should be thin and architectural: double keylines, clipped corners, short bracket marks, stepped strips, and occasional concentric-square motifs.
- Icons belong on a 24px grid, using simple filled silhouettes, 2px ink outlines, and no more than two interior tones.
- Keep detail **low to medium**. Concentrate ornament around outer frames and headers; leave cells, rules text, and piece silhouettes visually quiet.
- Avoid realistic illustration, ornate filigree, grunge, wood/metal simulation, and excessive simultaneous glows.

## Applying the Style
- **Board:** Use a #092C67 field inside a 12–16px inset frame. Draw minor grid lines at 1px and 12–18% opacity; define major zones with 2px #0094F6 lines. Keep playable cells mostly flat and reserve gradients for the surrounding field.
- **Pieces/tokens:** Use bold, simple silhouettes readable at 24–32px. Fill with the player color, add a 3–4px ink outline, one hard darker side plane, and a narrow top-left highlight. Use a 0 3px 0 #06101D hard shadow rather than a soft floating shadow.
- **Cards:** Use a 5:7 proportion, 3px ink border, 1px electric-blue inset line, and 4px maximum corner radius. Place the title in a compact header band, rules on a dark recessed plate, and costs/stats in small square badges. Keep interior illustration geometric and iconic.
- **Buttons:** Minimum 40px height, 16px horizontal padding, uppercase labels, 2px ink border, and a 3–4px hard bottom shadow. Primary buttons use #00DFFC with ink text; secondary buttons use #075FC4 with light text. On press, translateY(2px) and reduce the bottom shadow. Disabled buttons lose glow and use #8DB9DE at roughly 45% opacity.
- **Hover/focus:** Add a 2px #F4FBFF keyline and restrained cyan glow; never rely on brightness alone.
- **Selection:** Use a persistent 3px light outer ring, 4–6px cyan glow, and at most a 1.03 scale increase. Raise selected cards by 4px rather than recoloring their contents.
- **Legal moves:** Mark destinations with #8CFF00 corner brackets or a 2px outline, 10–14% translucent fill, and a small central diamond. Optional pulse: opacity .65–1 over 1.2 seconds; disable pulsing for reduced motion.
- **Last move:** Use #FFD43B origin/destination brackets and, where useful, a 2px connecting trace. Keep it visible until the next move; do not recolor the moved piece.
- Never communicate a state through hue alone, and allow only one highlighted element to pulse at a time.
