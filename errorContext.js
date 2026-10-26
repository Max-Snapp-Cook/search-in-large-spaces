// These are candidate locations, not source positions supplied by the compiler.
export function sourceContext(source, errors) {
  const lines = source.split(/\r?\n/);
  const contexts = [];
  const seenTokens = new Set();
  for (const error of [...new Set(errors)]) {
    if (contexts.length >= 5) break;
    const match = error.match(/Unexpected syntax '(.+?)' in /)
      || error.match(/Couldn't find (?:ludeme class for )?token '(.+?)'/)
      || error.match(/Could not match string '(.+?)'/);
    if (!match) continue;
    const token = match[1].replace(/\.\.\.$/, "");
    if (!token || seenTokens.has(token)) continue;
    seenTokens.add(token);
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(token)) matches.push(i);
    }
    contexts.push({
      error, token, locationType: "candidate text match; not a compiler source location",
      totalMatches: matches.length, truncated: matches.length > 5,
      candidates: matches.slice(0, 5).map((i) => ({
        line: i + 1,
        excerpt: lines.slice(Math.max(0, i - 3), i + 4)
          .map((line, offset) => `${Math.max(0, i - 3) + offset + 1}: ${line}`).join("\n").slice(0, 3000),
      })),
    });
  }
  return contexts;
}
