import { TaskStatus } from "../types";

/**
 * Minimal cron support + a markdown "recurrence log" table, used to make a task
 * repeat on a cadence while reusing the SAME markdown file.
 *
 * A recurring task carries three extra frontmatter fields:
 *   - `recurring: true`
 *   - `cadence: "0 0 * * *"`  — a standard 5-field cron expression
 *   - `lastReset: <ISO>`      — boundary of the period the task is currently in
 *
 * When a cron boundary has elapsed since `lastReset`, the task is "reset": the
 * status it had at the boundary is appended to the log table (so you can see
 * which days you completed it), the status is flipped back to `undone`, and
 * `lastReset` is advanced to that boundary.
 */

// --- cron ------------------------------------------------------------------

interface CronField {
  /** `*` — matches every value. */
  star: boolean;
  /** Allowed values when not `*`. */
  values: Set<number>;
}

export interface CronParsed {
  minute: CronField;
  hour: CronField;
  dom: CronField; // day of month, 1-31
  month: CronField; // 1-12
  dow: CronField; // day of week, 0-6 (0 = Sunday)
}

// Parse one cron field. Supports `*`, a single value, ranges (a-b), steps
// (a-b/s and the */s form), and comma-separated lists of those.
function parseField(field: string, min: number, max: number): CronField | null {
  if (field === "*") return { star: true, values: new Set() };

  const values = new Set<number>();
  for (const part of field.split(",")) {
    let step = 1;
    let range = part;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      step = parseInt(part.slice(slash + 1), 10);
      range = part.slice(0, slash);
    }

    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = parseInt(a, 10);
      hi = parseInt(b, 10);
    } else {
      lo = hi = parseInt(range, 10);
    }

    if (isNaN(lo) || isNaN(hi) || isNaN(step) || step < 1 || lo < min || hi > max) {
      return null;
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { star: false, values };
}

/** Parse a standard 5-field cron expression; returns null when invalid. */
export function parseCron(expr: string): CronParsed | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;

  const minute = parseField(f[0], 0, 59);
  const hour = parseField(f[1], 0, 23);
  const dom = parseField(f[2], 1, 31);
  const month = parseField(f[3], 1, 12);
  const dow = parseField(f[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;

  // Cron allows 7 as Sunday; normalize it to 0.
  if (!dow.star && dow.values.has(7)) dow.values.add(0);
  return { minute, hour, dom, month, dow };
}

function fieldMatch(f: CronField, v: number): boolean {
  return f.star || f.values.has(v);
}

/**
 * Does `date` (interpreted in local/vault time) satisfy the cron expression?
 *
 * Day-of-month and day-of-week follow standard cron semantics: when BOTH are
 * restricted, the date matches if EITHER matches; otherwise both must match.
 */
export function cronMatches(p: CronParsed, date: Date): boolean {
  if (!fieldMatch(p.minute, date.getMinutes())) return false;
  if (!fieldMatch(p.hour, date.getHours())) return false;
  if (!fieldMatch(p.month, date.getMonth() + 1)) return false;

  const domOk = fieldMatch(p.dom, date.getDate());
  const dowOk = fieldMatch(p.dow, date.getDay());
  if (!p.dom.star && !p.dow.star) return domOk || dowOk;
  return domOk && dowOk;
}

/** Cap the backward scan so a far-past `lastReset` can't spin forever (~2 years of minutes). */
const SCAN_MINUTE_CAP = 366 * 2 * 24 * 60;

/**
 * Latest cron firing time in the half-open interval `(afterMs, nowMs]`, or null
 * if the cron never fired in that window. Scans minute-by-minute backward from
 * `now`, which is plenty fast for the occasional "load tasks" run.
 */
export function lastFireBetween(
  cron: string,
  afterMs: number,
  nowMs: number
): number | null {
  const parsed = parseCron(cron);
  if (!parsed) return null;

  let t = Math.floor(nowMs / 60000) * 60000; // truncate to the minute
  let i = 0;
  while (t > afterMs && i < SCAN_MINUTE_CAP) {
    if (cronMatches(parsed, new Date(t))) return t;
    t -= 60000;
    i++;
  }
  return null;
}

// --- cron presets (for the create-task UI) ---------------------------------

export interface CadencePreset {
  key: string;
  label: string;
  cron: string;
}

export const CADENCE_PRESETS: CadencePreset[] = [
  { key: "daily", label: "Daily (midnight)", cron: "0 0 * * *" },
  { key: "weekdays", label: "Weekdays (Mon–Fri)", cron: "0 0 * * 1-5" },
  { key: "weekly", label: "Weekly (Monday)", cron: "0 0 * * 1" },
  { key: "monthly", label: "Monthly (1st)", cron: "0 0 1 * *" },
];

// --- recurrence log table --------------------------------------------------

/** Marker comment that anchors the log table so edits elsewhere don't confuse it. */
const LOG_MARKER = "<!-- filo-log -->";

/** Local date as YYYY-MM-DD (vault timezone). */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A fresh, empty "Recurrence log" section (heading + marker + table header). */
export function logSectionTemplate(): string {
  return `## Recurrence log\n\n${LOG_MARKER}\n\n| Date | Status |\n| --- | --- |\n`;
}

/**
 * Return a copy of `content` with one row appended to the recurrence log table.
 * Creates the whole section if no marker is present yet, so it's safe to call on
 * a task that was never set up with a log.
 */
/**
 * Return a copy of `content` with every logged period removed, keeping the
 * section and its table header.
 *
 * Used when copying a task: the log records what happened to the *original*, so
 * the copy has to start with an empty one. Content with no log is returned
 * untouched.
 */
export function clearLogEntries(content: string): string {
  const lines = content.split("\n");
  const markerIdx = lines.findIndex((l) => l.trim() === LOG_MARKER);
  if (markerIdx === -1) return content;

  // Same walk as appendLogEntry: the contiguous table region after the marker.
  let first = -1;
  let last = -1;
  for (let i = markerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "") {
      if (last !== -1) break;
      continue;
    }
    if (t.startsWith("|")) {
      if (first === -1) first = i;
      last = i;
      continue;
    }
    break;
  }

  // Keep the two header rows (the column names and the `| --- |` rule).
  if (first === -1 || last < first + 2) return content;
  lines.splice(first + 2, last - (first + 1));
  return lines.join("\n");
}

export function appendLogEntry(
  content: string,
  date: string,
  status: TaskStatus
): string {
  const row = `| ${date} | ${status} |`;
  const lines = content.split("\n");
  const markerIdx = lines.findIndex((l) => l.trim() === LOG_MARKER);

  if (markerIdx === -1) {
    const base = content.replace(/\s*$/, "");
    return base + "\n\n" + logSectionTemplate() + row + "\n";
  }

  // Walk forward from the marker to the last contiguous table row, tolerating a
  // blank line between marker and table.
  let lastTableLine = -1;
  for (let i = markerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "") {
      if (lastTableLine !== -1) break; // blank line ends the table
      continue;
    }
    if (t.startsWith("|")) {
      lastTableLine = i;
      continue;
    }
    break; // any other content ends the table region
  }

  if (lastTableLine === -1) {
    lines.splice(markerIdx + 1, 0, "", "| Date | Status |", "| --- | --- |", row);
  } else {
    lines.splice(lastTableLine + 1, 0, row);
  }
  return lines.join("\n");
}
