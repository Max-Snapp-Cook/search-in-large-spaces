# search-in-large-spaces

Generates playable board games from a one-line idea. Gemini designs the rules and writes the
game as JavaScript, a headless validator checks it and feeds errors back for repair, and the
result is a small website: open `index.html` and play.

```powershell
cd html-gen
npm install
npm run gen -- "a two-player capture game on a hexagonal board"
```

Put `GEMINI_API_KEY` in `.env` (here or in `html-gen/`). See [`html-gen/README.md`](html-gen/README.md)
for the game format, validation, computer opponents, and settings.
