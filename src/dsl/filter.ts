import { Task, TaskStatus } from "../types";

export type SortField = "due" | "created" | "title" | "time" | "priority";

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
  /** Total tracked time for a task, used by `sort: time`. */
  totalTime: (t: Task) => number;
  /** Today as YYYY-MM-DD, used by `overdue` and date comparisons. */
  today: string;
}

/** Filter + sort tasks per the parsed query. Date strings compare lexically (YYYY-MM-DD is chronological). */
export function applyQuery(tasks: Task[], q: ListQuery, ctx: QueryCtx): Task[] {
  let out = tasks.filter((t) => {
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
