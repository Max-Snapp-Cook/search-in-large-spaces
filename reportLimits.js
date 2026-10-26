export function clip(text = "", limit = 8000) {
  if (text.length <= limit) return text;
  const marker = "\n...[truncated]...\n";
  const head = Math.floor((limit - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
}

export function compactMessage(text) {
  // Ludii embeds the entire game in HTML after its short error heading.
  const heading = text.match(/^[\s\S]*?<h2>([\s\S]*?)<\/h2>/i);
  if (heading) text = heading[1];
  return clip(text.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ").replace(/&apos;/g, "'").replace(/&amp;/g, "&"), 2000);
}

export function compactReport(result) {
  const fields = [];
  const messages = (items, field) => {
    const compact = items.slice(0, 10).map(compactMessage);
    if (JSON.stringify(compact) !== JSON.stringify(items)) fields.push(field);
    return compact;
  };
  result.errors = messages(result.errors, "errors");
  if (result.compilerReport) {
    const report = { ...result.compilerReport };
    for (const key of ["errors", "warnings", "notes"]) {
      report[key] = messages(report[key] || [], `compilerReport.${key}`);
    }
    const log = report.log || "";
    report.log = clip(log);
    report.logTruncated = Boolean(report.logTruncated || log.length > 8000);
    if (report.logTruncated) fields.push("compilerReport.log");
    result.compilerReport = report;
  }
  if (fields.length) result.compactedFields = fields;
  return result;
}
