/**
 * Markdown reduced to the words, for places that are ONE LINE.
 *
 * A block's prose is markdown. Two things can be done with it and they are
 * not interchangeable:
 *
 *   a BODY     renders it — a fence becomes a code block, a heading a heading
 *   a SUMMARY  strips it — one truncated line, ellipsised
 *
 * Rendering markdown into the summary would be worse than the raw text it
 * replaces: a `#` heading inside a caption, or a fence opened and never
 * closed because the line was cut at 60 characters. Stripping is not a
 * lesser version of rendering; it is the correct transformation for a
 * different job.
 *
 * DELIBERATELY NOT A MARKDOWN PARSER. This drops the syntax a first line
 * actually carries — fences, headings, rules, list bullets, emphasis and link
 * brackets — and leaves everything else alone. A summary is allowed to be
 * approximate; it is not allowed to show `###` to a person.
 */

/** The fenced-block delimiter, built rather than typed, so this file's own
 * source does not contain a bare fence that the harness would count. */
const FENCE = "`".repeat(3);

export function plainSummary(markdown: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(FENCE)) {
      // A fence toggles code. Its CONTENT is dropped from a summary: the
      // first line of a report is prose, and code in a caption is noise.
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Horizontal rules and empty lines carry nothing to a one-line summary.
    if (trimmed.length === 0) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) continue;
    kept.push(trimmed);
  }
  return kept
    .join(" ")
    // Leading heading markers and list bullets, at the start of what was a line.
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/(^|\s)[-*+]\s+/g, "$1")
    .replace(/(^|\s)>\s+/g, "$1")
    // Emphasis and inline code markers, keeping the words.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    // Links: keep the text, drop the target.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
