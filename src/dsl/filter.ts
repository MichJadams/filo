import { Task, TaskStatus } from "../types";

export type SortField = "due" | "created" | "title" | "time" | "priority";

/**
 * A `time:` window, kept as a *spec* rather than dates because "today" has to be
 * resolved when the block renders, not when it was typed.
 */
export type TimeWindowSpec =
  | { kind: "days"; back: number } // rolling window ending today; 1 = today alone
  | { kind: "on"; date: string }
  | { kind: "between"; from: string; to: string };

/** A resolved window, as inclusive `YYYY-MM-DD` bounds. */
export interface TimeWindow {
  from: string;
  to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shift a `YYYY-MM-DD` by whole days. UTC math, so DST can't move a date. */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * Parse the value of a `time:` line. Returns null (and pushes an error) for
 * anything unrecognized, so a typo shows up in the block instead of silently
 * reporting the wrong span.
 */
export function parseTimeWindow(val: string, errors: string[]): TimeWindowSpec | null {
  const v = val.trim().toLowerCase();

  if (v === "today") return { kind: "days", back: 1 };
  if (v === "yesterday") return { kind: "on", date: "yesterday" };
  if (v === "week") return { kind: "days", back: 7 };
  if (v === "month") return { kind: "days", back: 30 };

  const rel = v.match(/^(\d+)d$/);
  if (rel) {
    const back = Number(rel[1]);
    if (back >= 1) return { kind: "days", back };
    errors.push(`bad time window: ${val}`);
    return null;
  }

  const range = v.split("..").map((x) => x.trim());
  if (range.length === 2) {
    if (DATE_RE.test(range[0]) && DATE_RE.test(range[1])) {
      const [from, to] = range[0] <= range[1] ? range : [range[1], range[0]];
      return { kind: "between", from, to };
    }
    errors.push(`bad time range: ${val}`);
    return null;
  }

  if (DATE_RE.test(v)) return { kind: "on", date: v };

  errors.push(`bad time window: ${val}`);
  return null;
}

/** Turn a spec into concrete inclusive dates, given the caller's local today. */
export function resolveWindow(spec: TimeWindowSpec, today: string): TimeWindow {
  switch (spec.kind) {
    case "days":
      return { from: shiftDate(today, -(spec.back - 1)), to: today };
    case "on": {
      const date = spec.date === "yesterday" ? shiftDate(today, -1) : spec.date;
      return { from: date, to: date };
    }
    case "between":
      return { from: spec.from, to: spec.to };
  }
}

export interface ListQuery {
  /**
   * Status match. `values` is an OR-set (a task matches if its status is any of
   * them); `not: true` inverts the match (a task matches if its status is NONE
   * of them), e.g. `status: !done` to show everything still open.
   */
  status?: { not: boolean; values: TaskStatus[] };
  due?: { kind: "overdue" } | { kind: "cmp"; op: "<" | ">" | "="; date: string };
  /** OR-set of tags (a task matches if it has ANY of these). */
  tags?: string[];
  /**
   * Restricts the list to tasks worked on in this window, and scopes every time
   * figure to it — the row totals, `sort: time`, and the summed footer.
   */
  time?: TimeWindowSpec;
  sort?: { field: SortField; dir: "asc" | "desc" };
  /**
   * `parent` buckets rows under their parent's title; `none` renders one flat
   * list in pure sort order (no tree nesting). Omitted = the default tree.
   */
  group?: "parent" | "none";
  /** Non-fatal parse problems, surfaced to the user above the list. */
  errors: string[];
}

const STATUSES: string[] = ["undone", "in-progress", "done"];
const SORT_FIELDS: string[] = ["due", "created", "title", "time", "priority"];

/**
 * Parse the line-based t-list DSL. Each line is `key: value`. Blank lines and
 * `#` comments are ignored. Unknown keys/values are collected into `errors`
 * rather than throwing, so a typo degrades gracefully.
 */
export function parseQuery(source: string): ListQuery {
  const q: ListQuery = { errors: [] };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const ci = line.indexOf(":");
    if (ci === -1) {
      q.errors.push(`ignored (no ':'): ${line}`);
      continue;
    }
    const key = line.slice(0, ci).trim().toLowerCase();
    const val = line.slice(ci + 1).trim();

    switch (key) {
      case "status": {
        // `!` prefix negates; comma-separated values form an OR-set. So
        // `status: undone, in-progress` and `status: !done` both keep open tasks.
        let rest = val;
        let not = false;
        if (rest.startsWith("!")) {
          not = true;
          rest = rest.slice(1).trim();
        }
        const parts = rest
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const bad = parts.filter((p) => !STATUSES.includes(p));
        if (!parts.length) q.errors.push(`bad status: ${val}`);
        else if (bad.length) q.errors.push(`bad status: ${bad.join(", ")}`);
        else q.status = { not, values: parts as TaskStatus[] };
        break;
      }

      case "due": {
        if (val.toLowerCase() === "overdue") {
          q.due = { kind: "overdue" };
        } else {
          const op = val[0];
          if (op === "<" || op === ">" || op === "=") {
            q.due = { kind: "cmp", op, date: val.slice(1).trim() };
          } else {
            // No operator -> exact match.
            q.due = { kind: "cmp", op: "=", date: val };
          }
        }
        break;
      }

      case "time": {
        const spec = parseTimeWindow(val, q.errors);
        if (spec) q.time = spec;
        break;
      }

      case "tags":
        q.tags = val
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        break;

      case "sort": {
        const [field, dir] = val.split(/\s+/);
        if (SORT_FIELDS.includes(field)) {
          q.sort = { field: field as SortField, dir: dir === "desc" ? "desc" : "asc" };
        } else {
          q.errors.push(`bad sort field: ${field}`);
        }
        break;
      }

      case "group": {
        // `flat` is accepted as a friendlier alias for `none`.
        const g = val.toLowerCase();
        if (g === "parent") q.group = "parent";
        else if (g === "none" || g === "flat") q.group = "none";
        else q.errors.push(`only 'group: parent' or 'group: none' is supported`);
        break;
      }

      default:
        q.errors.push(`unknown key: ${key}`);
    }
  }

  return q;
}

export interface QueryCtx {
  /**
   * Tracked time for a task — scoped to the query's `time:` window when it has
   * one. Drives both `sort: time` and the `time:` filter itself, so the two can
   * never disagree about what "time" means.
   */
  totalTime: (t: Task) => number;
  /** Today as YYYY-MM-DD, used by `overdue` and date comparisons. */
  today: string;
}

/** Filter + sort tasks per the parsed query. Date strings compare lexically (YYYY-MM-DD is chronological). */
export function applyQuery(tasks: Task[], q: ListQuery, ctx: QueryCtx): Task[] {
  let out = tasks.filter((t) => {
    // A window means "what did I work on then", so a task with no time in it
    // isn't part of the answer.
    if (q.time && ctx.totalTime(t) <= 0) return false;

    if (q.status) {
      const inSet = q.status.values.includes(t.status);
      if (q.status.not ? inSet : !inSet) return false;
    }

    if (q.tags && q.tags.length) {
      const lower = t.tags.map((x) => x.toLowerCase());
      if (!q.tags.some((tag) => lower.includes(tag))) return false;
    }

    if (q.due) {
      if (q.due.kind === "overdue") {
        if (!(t.due && t.due < ctx.today && t.status !== "done")) return false;
      } else {
        if (!t.due) return false;
        const cmp = t.due.localeCompare(q.due.date);
        if (q.due.op === "<" && !(cmp < 0)) return false;
        if (q.due.op === ">" && !(cmp > 0)) return false;
        if (q.due.op === "=" && cmp !== 0) return false;
      }
    }
    return true;
  });

  if (q.sort) {
    const { field, dir } = q.sort;
    const mul = dir === "desc" ? -1 : 1;
    out = out.slice().sort((a, b) => {
      let r = 0;
      switch (field) {
        case "title":
          r = a.title.localeCompare(b.title);
          break;
        case "created":
          r = (a.created || "").localeCompare(b.created || "");
          break;
        case "time":
          r = ctx.totalTime(a) - ctx.totalTime(b);
          break;
        case "priority":
          r = a.priority - b.priority;
          break;
        case "due":
          // Tasks without a due date always sort last, regardless of direction.
          if (!a.due && !b.due) r = 0;
          else if (!a.due) return 1;
          else if (!b.due) return -1;
          else r = a.due.localeCompare(b.due);
          break;
      }
      return r * mul;
    });
  }

  return out;
}
