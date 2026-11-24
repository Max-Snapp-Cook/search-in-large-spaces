// designNotes.js
// The rules step answers with the rules, then a marker line, then design notes: for each rule, where it
// comes from (new, adapted, or borrowed from a known game), why it was chosen, and which other rules it
// is meant to interact with. The notes are saved as design-notes.md next to rules.md; only the rules go
// on to the code prompts.

export const NOTES_MARKER = "=== DESIGN NOTES ===";

// Matches the marker line, tolerating markdown decoration the model may add (#, **, extra =).
const markerLine = /^[ \t>#*_]*=+[ \t]*DESIGN NOTES[ \t]*=+[ \t*_]*$/im;

// Splits a rules reply into { rules, notes }. notes is null when the model left out the marker.
export function splitDesignNotes(reply) {
  const text = String(reply ?? "");
  const match = markerLine.exec(text);
  if (!match) return { rules: text.trim(), notes: null };
  const rules = text.slice(0, match.index).trim();
  const notes = text.slice(match.index + match[0].length).trim();
  return { rules, notes: notes || null };
}
