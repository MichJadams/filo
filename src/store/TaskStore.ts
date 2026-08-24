import { App, TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import {
  SubtreeNode,
  Task,
  TaskInput,
  TaskPatch,
  TaskStatus,
} from "../types";
import { generateTaskId } from "./id";
import { computeTotal, parseSessions, writeSessions } from "./timeBlock";
import { appendLogEntry, lastFireBetween, localDate, logSectionTemplate } from "./recurrence";

/**
 * Bridge to plugin-level state that the store needs but should not own:
 * settings (folder, cap) and the persisted single active-timer id.
 */
export interface FiloDataAccess {
  getTasksFolder(): string;
  getTimerCapMs(): number;
  getActiveTaskId(): string | null;
  setActiveTaskId(id: string | null): Promise<void>;
}

/** Matches the leading YAML frontmatter block. */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

const STATUSES: TaskStatus[] = ["undone", "in-progress", "done"];

/**
 * Flatten a title onto a single line so it can sit after `# ` without the tail
 * spilling out of the heading. Falls back to "Untitled" for a blank title.
 */
function headingLine(title: string): string {
  const flat = (title ?? "").replace(/\s+/g, " ").trim();
  return flat || "Untitled";
}

export class TaskStore {
  private app: App;
  private data: FiloDataAccess;

  /**
   * Cached full scan of the tasks folder. `parent` is the only stored
   * relationship, so children/subtrees are derived from this list at read
   * time. The cache is dropped (set to null) whenever a file in the tasks
   * folder changes; the next read re-scans lazily.
   */
  private cache: Task[] | null = null;

  /** Re-render subscribers (list/add widgets). */
  private subscribers = new Set<() => void>();

  constructor(app: App, data: FiloDataAccess) {
    this.app = app;
    this.data = data;
  }

  // --- change notification -------------------------------------------------

  /** Subscribe to store changes; returns an unsubscribe function. */
  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private notify(): void {
    this.subscribers.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error("[Filo] subscriber error", e);
      }
    });
  }

  /**
   * Invalidate the cache and re-render. Only fires when the changed path is
   * inside the tasks folder — vault events elsewhere are ignored so unrelated
   * edits never trigger a rescan.
   */
  handleVaultChange(path: string): void {
    const folder = this.folder();
    if (path === folder || path.startsWith(folder + "/")) {
      this.invalidate();
    }
  }

  /** Force a rescan on next read and notify subscribers. */
  invalidate(): void {
    this.cache = null;
    this.notify();
  }

  // --- folder helpers ------------------------------------------------------

  private folder(): string {
    return normalizePath(this.data.getTasksFolder() || "tasks");
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path).catch(() => {
        /* may already exist due to a race; ignore */
      });
    }
  }

  // --- reading -------------------------------------------------------------

  private coerceDate(v: unknown): string | null {
    // YAML auto-parses `2026-06-30` into a Date, so normalize back to YYYY-MM-DD.
    if (v == null || v === "") return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  private coerceIso(v: unknown): string {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }

  private normalizeStatus(v: unknown): TaskStatus {
    const s = String(v) as TaskStatus;
    return STATUSES.includes(s) ? s : "undone";
  }

  private coerceBool(v: unknown): boolean {
    return v === true || v === "true";
  }

  /**
   * Priority as a finite number, defaulting to 0. Tasks predating the field (or
   * carrying a non-numeric value) read as 0 rather than NaN, so sorting stays
   * well-defined without having to rewrite existing task files.
   */
  private coercePriority(v: unknown): number {
    if (v == null || v === "") return 0;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : 0;
  }

  /** Parse a file's full content into a Task. */
  private parseFile(file: TFile, content: string): Task {
    const m = content.match(FM_RE);
    let fm: Record<string, unknown> = {};
    if (m) {
      try {
        fm = (parseYaml(m[1]) as Record<string, unknown>) ?? {};
      } catch {
        fm = {};
      }
    }

    const rawTags = fm.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t))
      : rawTags != null && rawTags !== ""
      ? [String(rawTags)]
      : [];

    return {
      id: fm.id ? String(fm.id) : file.basename,
      title: fm.title != null ? String(fm.title) : file.basename,
      status: this.normalizeStatus(fm.status),
      parent: fm.parent != null && fm.parent !== "" ? String(fm.parent) : null,
      due: this.coerceDate(fm.due),
      tags,
      priority: this.coercePriority(fm.priority),
      created: this.coerceIso(fm.created),
      sessions: parseSessions(content),
      path: file.path,
      recurring: this.coerceBool(fm.recurring),
      cadence: fm.cadence != null && fm.cadence !== "" ? String(fm.cadence) : null,
      lastReset: fm.lastReset != null && fm.lastReset !== "" ? this.coerceIso(fm.lastReset) : null,
    };
  }

  /** All tasks in the folder (cached). */
  async listTasks(): Promise<Task[]> {
    if (this.cache) return this.cache;

    const folder = this.folder();
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/"));

    const tasks: Task[] = [];
    for (const f of files) {
      const content = await this.app.vault.cachedRead(f);
      const task = this.parseFile(f, content);
      // Only treat files that carry an `id` frontmatter as tasks, so stray
      // notes dropped in the folder don't pollute the list.
      if (content.includes("id:")) tasks.push(task);
    }
    this.cache = tasks;
    return tasks;
  }

  async getTask(id: string): Promise<Task | null> {
    return (await this.listTasks()).find((t) => t.id === id) ?? null;
  }

  /** Resolve the backing TFile for a task id (via cached path). */
  private async fileForId(id: string): Promise<TFile | null> {
    const task = await this.getTask(id);
    if (!task) return null;
    const f = this.app.vault.getAbstractFileByPath(task.path);
    return f instanceof TFile ? f : null;
  }

  // --- writing -------------------------------------------------------------

  async createTask(input: TaskInput): Promise<Task> {
    const folder = this.folder();
    await this.ensureFolder(folder);

    const id = generateTaskId();
    const created = new Date().toISOString();
    const priority = this.coercePriority(input.priority);
    const fm: Record<string, unknown> = {
      id,
      title: input.title,
      status: input.status ?? "undone",
      parent: input.parent ?? null,
      due: input.due ?? null,
      tags: input.tags ?? [],
      priority,
      created,
    };
    // Recurrence fields are only written for recurring tasks, keeping ordinary
    // task frontmatter unchanged. `lastReset` starts at creation so the first
    // reset happens at the first cron boundary after the task was made.
    if (input.recurring) {
      fm.recurring = true;
      fm.cadence = input.cadence ?? "0 0 * * *";
      fm.lastReset = created;
    }

    const body = (input.body ?? "").trim();
    // The filename is the opaque id, so the plain-language title is repeated as
    // an H1 — otherwise a note with hidden properties shows nothing readable.
    const heading = headingLine(input.title);
    // stringifyYaml already terminates with a newline.
    const content =
      `---\n${stringifyYaml(fm)}---\n\n` +
      `# ${heading}\n\n` +
      (body ? body + "\n\n" : "") +
      "```t-time\n```\n" +
      (input.recurring ? "\n" + logSectionTemplate() : "");

    const path = `${folder}/${id}.md`;
    await this.app.vault.create(path, content);
    this.invalidate();

    return {
      id,
      title: input.title,
      status: (input.status ?? "undone") as TaskStatus,
      parent: input.parent ?? null,
      due: input.due ?? null,
      tags: input.tags ?? [],
      priority,
      created,
      sessions: [],
      path,
      recurring: !!input.recurring,
      cadence: input.recurring ? input.cadence ?? "0 0 * * *" : null,
      lastReset: input.recurring ? created : null,
    };
  }

  /**
   * Update frontmatter fields via processFrontMatter (which mutates only the
   * YAML and preserves the body, rather than naive string replacement).
   */
  async updateTask(id: string, patch: TaskPatch): Promise<void> {
    const file = await this.fileForId(id);
    if (!file) throw new Error(`[Filo] task not found: ${id}`);

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (patch.title !== undefined) fm.title = patch.title;
      if (patch.status !== undefined) fm.status = patch.status;
      if (patch.parent !== undefined) fm.parent = patch.parent;
      if (patch.due !== undefined) fm.due = patch.due;
      if (patch.tags !== undefined) fm.tags = patch.tags;
      if (patch.priority !== undefined) fm.priority = patch.priority;
      if (patch.recurring !== undefined) fm.recurring = patch.recurring;
      if (patch.cadence !== undefined) fm.cadence = patch.cadence;
      if (patch.lastReset !== undefined) fm.lastReset = patch.lastReset;
    });
    this.invalidate();
  }

  async setStatus(id: string, status: TaskStatus): Promise<void> {
    await this.updateTask(id, { status });
  }

  /** Set a task's priority. Non-finite input is rejected rather than written. */
  async setPriority(id: string, priority: number): Promise<void> {
    if (!Number.isFinite(priority)) return;
    await this.updateTask(id, { priority });
  }

  // --- recurrence ----------------------------------------------------------

  /**
   * Scan all recurring tasks and reset any whose cadence boundary has elapsed
   * since their `lastReset`. For each reset, the status held at the boundary is
   * appended to the task's recurrence-log table, the status is flipped back to
   * `undone`, and `lastReset` is advanced to the boundary. Returns the number
   * of tasks reset (used for the "load tasks" notice).
   *
   * Only the most recent missed boundary is logged per run; if several periods
   * elapsed between runs, intermediate ones are not back-filled.
   */
  async processRecurring(now: number = Date.now()): Promise<number> {
    const tasks = await this.listTasks();
    let count = 0;

    for (const t of tasks) {
      if (!t.recurring || !t.cadence) continue;

      const afterRaw = Date.parse(t.lastReset ?? t.created);
      const afterMs = isNaN(afterRaw) ? 0 : afterRaw;
      const fireMs = lastFireBetween(t.cadence, afterMs, now);
      if (fireMs == null) continue;

      const file = await this.fileForId(t.id);
      if (!file) continue;

      const statusAtBoundary = t.status;
      const dateStr = localDate(new Date(fireMs));

      // Append the period's outcome to the log table, then reset the task.
      await this.app.vault.process(file, (content) =>
        appendLogEntry(content, dateStr, statusAtBoundary)
      );
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.status = "undone";
        fm.lastReset = new Date(fireMs).toISOString();
      });
      count++;
    }

    if (count) this.invalidate();
    return count;
  }

  // --- tree ----------------------------------------------------------------

  async getChildren(id: string): Promise<Task[]> {
    return (await this.listTasks()).filter((t) => t.parent === id);
  }

  /**
   * Flatten the subtree rooted at `rootId` (depth-first), annotating each node
   * with its depth. A `visited` set guards against accidental parent cycles.
   */
  async getSubtree(rootId: string): Promise<SubtreeNode[]> {
    const all = await this.listTasks();
    const root = all.find((t) => t.id === rootId);
    if (!root) return [];

    const byParent = new Map<string | null, Task[]>();
    for (const t of all) {
      const arr = byParent.get(t.parent) ?? [];
      arr.push(t);
      byParent.set(t.parent, arr);
    }

    const out: SubtreeNode[] = [];
    const visited = new Set<string>();
    const walk = (task: Task, depth: number) => {
      if (visited.has(task.id)) return;
      visited.add(task.id);
      out.push({ task, depth });
      for (const child of byParent.get(task.id) ?? []) walk(child, depth + 1);
    };
    walk(root, 0);
    return out;
  }

  // --- timers --------------------------------------------------------------

  /**
   * Start the timer for `id`. Enforces a single global active timer by first
   * stopping whichever task is currently active. The active id is persisted by
   * the plugin so it survives reloads.
   */
  async startTimer(id: string): Promise<void> {
    const active = this.data.getActiveTaskId();
    if (active && active !== id) await this.stopTimer(active);

    const file = await this.fileForId(id);
    if (!file) throw new Error(`[Filo] task not found: ${id}`);

    const now = new Date().toISOString();
    await this.app.vault.process(file, (content) => {
      const sessions = parseSessions(content);
      // Idempotent: don't open a second session if one is already running.
      if (!sessions.some((s) => s.stop === null)) {
        sessions.push({ start: now, stop: null });
      }
      return writeSessions(content, sessions);
    });

    await this.data.setActiveTaskId(id);
    this.invalidate();
  }

  /** Stop the timer for `id` by closing its open session with the current time. */
  async stopTimer(id: string): Promise<void> {
    const file = await this.fileForId(id);
    if (!file) return;

    const now = new Date().toISOString();
    await this.app.vault.process(file, (content) => {
      const sessions = parseSessions(content);
      for (let i = sessions.length - 1; i >= 0; i--) {
        if (sessions[i].stop === null) {
          sessions[i].stop = now;
          break;
        }
      }
      return writeSessions(content, sessions);
    });

    if (this.data.getActiveTaskId() === id) await this.data.setActiveTaskId(null);
    this.invalidate();
  }

  /** Total tracked milliseconds for a task (running session capped per settings). */
  async totalTime(id: string): Promise<number> {
    const task = await this.getTask(id);
    if (!task) return 0;
    return computeTotal(task.sessions, this.data.getTimerCapMs()).ms;
  }
}
