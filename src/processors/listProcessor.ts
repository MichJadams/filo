import { MarkdownRenderChild, TFile } from "obsidian";
import type FiloPlugin from "../main";
import { Task, TaskStatus } from "../types";
import { applyQuery, ListQuery, parseQuery, resolveWindow, TimeWindow } from "../dsl/filter";
import { computeTotal, computeTotalInRange, formatDuration } from "../store/timeBlock";

export const STATUS_ICON: Record<TaskStatus, string> = {
  undone: "○",
  "in-progress": "◐",
  done: "●",
};

// Status toggle cycle: undone -> in-progress -> done -> undone.
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  undone: "in-progress",
  "in-progress": "done",
  done: "undone",
};

/** Local today as YYYY-MM-DD (vault timezone), for overdue checks. */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Human label for a window, e.g. "today", "on 2026-08-19", "2026-08-01 → 2026-08-25". */
function describeWindow(w: TimeWindow, today: string): string {
  if (w.from !== w.to) return `${w.from} → ${w.to}`;
  if (w.from === today) return "today";
  return `on ${w.from}`;
}

/** Local midnight of a `YYYY-MM-DD`, in ms. */
function dayStartMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * A window's half-open millisecond bounds: local midnight of `from` up to local
 * midnight of the day AFTER `to`, so the last day is included whole.
 */
function windowBounds(w: TimeWindow): { fromMs: number; toMs: number } {
  return { fromMs: dayStartMs(w.from), toMs: dayStartMs(w.to) + 86_400_000 };
}

/**
 * Renders a ```t-list block.
 *
 * Lifecycle: as a MarkdownRenderChild, the store subscription (registered via
 * `register`) and the 1s tick interval (registered via `registerInterval`) are
 * BOTH torn down automatically when the block unloads — no leaked timers.
 *
 *  - subscription -> full re-render whenever any task file changes;
 *  - interval     -> cheap per-second text update of running rows only.
 */
export class ListWidget extends MarkdownRenderChild {
  private plugin: FiloPlugin;
  private query: ListQuery;

  /** time cell element per task id, so the tick can update them in place. */
  private timeEls = new Map<string, HTMLElement>();
  /** tasks currently running, recomputed each render. */
  private runningTasks: Task[] = [];
  /** Time shown per task id, so the footer can be re-summed on each tick. */
  private rowMs = new Map<string, number>();
  /** Footer total, present only when the query has a `time:` window. */
  private totalEl: HTMLElement | null = null;
  /** Millisecond bounds of the query's window; null when it has none. */
  private bounds: { fromMs: number; toMs: number } | null = null;
  /** Monotonic render token; guards against interleaved async renders. */
  private renderSeq = 0;

  constructor(plugin: FiloPlugin, containerEl: HTMLElement, source: string) {
    super(containerEl);
    this.plugin = plugin;
    this.query = parseQuery(source);
  }

  onload(): void {
    this.register(this.plugin.store.subscribe(() => void this.render()));
    this.registerInterval(window.setInterval(() => this.tick(), 1000));
    void this.render();
  }

  /** Live-update only the running rows (and the total they feed). */
  private tick(): void {
    if (!this.runningTasks.length) return;
    const cap = this.plugin.getTimerCapMs();
    const now = Date.now();
    for (const t of this.runningTasks) {
      const el = this.timeEls.get(t.id);
      if (!el) continue;
      const { ms, flagged } = this.timeFor(t, cap, now);
      el.setText(formatDuration(ms));
      el.toggleClass("filo-flagged", flagged);
      this.rowMs.set(t.id, ms);
    }
    this.updateTotal();
  }

  /**
   * A task's tracked time: the whole history, or just the query's window when
   * it has one. The single place the window is applied, so rows, the sort and
   * the total can't drift apart.
   */
  private timeFor(task: Task, cap: number, now: number = Date.now()) {
    return this.bounds
      ? computeTotalInRange(task.sessions, cap, this.bounds.fromMs, this.bounds.toMs, now)
      : computeTotal(task.sessions, cap, now);
  }

  private updateTotal(): void {
    if (!this.totalEl) return;
    let sum = 0;
    for (const ms of this.rowMs.values()) sum += ms;
    this.totalEl.setText(formatDuration(sum));
  }

  private async render(): Promise<void> {
    const seq = ++this.renderSeq;
    const cap = this.plugin.getTimerCapMs();
    const today = todayStr();
    const all = await this.plugin.store.listTasks();
    // If another render started while we awaited, abort: only the latest render
    // is allowed to touch the DOM, so rows can never be appended twice.
    if (seq !== this.renderSeq) return;

    const window = this.query.time ? resolveWindow(this.query.time, today) : null;
    this.bounds = window ? windowBounds(window) : null;

    const tasks = applyQuery(all, this.query, {
      totalTime: (t) => this.timeFor(t, cap).ms,
      today,
    });

    const el = this.containerEl;
    el.empty();
    el.addClass("filo-list");
    this.timeEls.clear();
    this.rowMs.clear();
    this.runningTasks = [];
    this.totalEl = null;

    // Rendered before the empty/error branches so the button is reachable even
    // when nothing matches the query.
    this.renderToolbar(el);

    if (this.query.errors.length) {
      el.createEl("div", {
        cls: "filo-error",
        text: "Query problems: " + this.query.errors.join("; "),
      });
    }

    if (!tasks.length) {
      el.createEl("div", {
        cls: "filo-empty",
        text: window ? `No tracked time ${describeWindow(window, today)}.` : "No matching tasks.",
      });
      return;
    }

    if (this.query.group === "parent") {
      const titleById = new Map(all.map((t) => [t.id, t.title]));
      const groups = new Map<string | null, Task[]>();
      for (const t of tasks) {
        const arr = groups.get(t.parent) ?? [];
        arr.push(t);
        groups.set(t.parent, arr);
      }
      for (const [pid, group] of groups) {
        const header = pid ? titleById.get(pid) ?? pid : "(no parent)";
        el.createEl("div", { cls: "filo-group-header", text: header });
        const rows = el.createDiv({ cls: "filo-rows" });
        for (const t of group) this.renderRow(rows, t, cap, today);
      }
    } else if (this.query.group === "none") {
      // Flat list: rows follow the sort order exactly, with no tree nesting —
      // the only layout in which e.g. `sort: priority desc` is globally ordered
      // rather than ordered per sibling group.
      const rows = el.createDiv({ cls: "filo-rows" });
      for (const t of tasks) this.renderRow(rows, t, cap, today);
    } else {
      const rows = el.createDiv({ cls: "filo-rows" });
      this.renderTree(rows, tasks, cap, today);
    }

    // The answer to "how long did I work": only meaningful against a window, so
    // ordinary lists are left as they were.
    if (window) {
      const footer = el.createDiv({ cls: "filo-total" });
      footer.createSpan({
        cls: "filo-total-label",
        text: `Total ${describeWindow(window, today)}`,
      });
      this.totalEl = footer.createSpan({ cls: "filo-total-value" });
      this.updateTotal();
    }
  }

  /**
   * Block toolbar. Runs the same recurrence pass as the "Load tasks" command,
   * which is otherwise only triggered at plugin load — so a long-running
   * Obsidian session never resets a due recurring task on its own.
   */
  private renderToolbar(container: HTMLElement): void {
    const bar = container.createDiv({ cls: "filo-toolbar" });
    const btn = bar.createEl("button", {
      cls: "filo-load-tasks",
      text: "⟳ Load tasks",
      attr: { "aria-label": "Process recurring tasks now" },
    });
    btn.addEventListener("click", () => {
      btn.disabled = true;
      // A reset invalidates the store, which re-renders this block and replaces
      // the button; only re-enable if this element survived (nothing was due).
      void this.plugin.runProcessRecurring(true).finally(() => {
        if (btn.isConnected) btn.disabled = false;
      });
    });
  }

  /**
   * Render the matched tasks as a nested tree: children sit (indented) beneath
   * their parent. Sibling order follows the filtered/sorted order. A matched
   * task whose parent is NOT in the result set becomes a top-level root, so
   * filtered-out parents don't hide their matching children.
   */
  private renderTree(container: HTMLElement, matched: Task[], cap: number, today: string): void {
    const inSet = new Set(matched.map((t) => t.id));
    const childrenByParent = new Map<string | null, Task[]>();
    for (const t of matched) {
      const parent = t.parent && inSet.has(t.parent) ? t.parent : null;
      const arr = childrenByParent.get(parent) ?? [];
      arr.push(t);
      childrenByParent.set(parent, arr);
    }

    const visited = new Set<string>(); // guard against parent cycles
    const walk = (task: Task, depth: number) => {
      if (visited.has(task.id)) return;
      visited.add(task.id);
      this.renderRow(container, task, cap, today, depth);
      for (const child of childrenByParent.get(task.id) ?? []) walk(child, depth + 1);
    };
    for (const root of childrenByParent.get(null) ?? []) walk(root, 0);
  }

  private renderRow(
    container: HTMLElement,
    task: Task,
    cap: number,
    today: string,
    depth = 0
  ): void {
    const { ms, flagged, running } = this.timeFor(task, cap);
    this.rowMs.set(task.id, ms);
    const row = container.createDiv({ cls: "filo-row" });
    // Indent the whole row to nest children beneath their parent.
    if (depth > 0) row.style.paddingLeft = `${4 + depth * 20}px`;

    // Status toggle — cycles undone -> in-progress -> done -> undone.
    const statusBtn = row.createEl("button", {
      cls: `filo-status filo-status-${task.status}`,
      text: STATUS_ICON[task.status],
      attr: { "aria-label": `Status: ${task.status}` },
    });
    statusBtn.addEventListener("click", () => {
      void this.plugin.store.setStatus(task.id, NEXT_STATUS[task.status]);
    });

    // Add-child button — sits immediately right of the status toggle. Reveals
    // an inline form (rendered below the row) that creates a child of THIS task.
    const childBtn = row.createEl("button", {
      cls: "filo-add-child",
      text: "＋",
      attr: { "aria-label": `Add child task to "${task.title}"` },
    });

    // Title — click opens the task file. A recurring task gets a ⟳ marker
    // prefixed inside the title cell (kept inside the cell so the row's grid
    // columns stay aligned whether or not the task recurs).
    const titleEl = row.createDiv({ cls: "filo-title" });
    if (task.recurring) {
      titleEl.createSpan({
        cls: "filo-recurring",
        text: "⟳ ",
        attr: { "aria-label": `Recurring: ${task.cadence ?? ""}` },
      });
    }
    titleEl.createSpan({ text: task.title });
    titleEl.addEventListener("click", () => {
      const f = this.plugin.app.vault.getAbstractFileByPath(task.path);
      if (f instanceof TFile) void this.plugin.app.workspace.getLeaf(false).openFile(f);
    });

    // Priority — editable in place. Committed on blur/Enter (or the spinner
    // arrows, which also fire `change`); Escape restores the stored value.
    // Writing invalidates the store, so the row re-renders from the file after
    // the commit rather than trusting local state.
    const prioEl = row.createEl("input", {
      type: "number",
      cls: "filo-priority",
      attr: {
        step: "1",
        title: "Priority",
        "aria-label": `Priority of "${task.title}": ${task.priority}`,
      },
    });
    // `committed` tracks what this cell has already written, so Enter followed
    // by the blur-driven `change` event doesn't write the same value twice.
    let committed = task.priority;
    prioEl.value = String(committed);
    const commitPriority = () => {
      const raw = prioEl.value.trim();
      // An empty field means "back to the default" rather than NaN.
      const next = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(next) || next === committed) {
        prioEl.value = String(committed);
        return;
      }
      committed = next;
      void this.plugin.store.setPriority(task.id, next);
    };
    prioEl.addEventListener("change", commitPriority);
    prioEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitPriority();
      } else if (e.key === "Escape") {
        prioEl.value = String(committed);
        prioEl.blur();
      }
    });

    // Due date — highlighted if overdue and not done.
    const overdue = !!task.due && task.due < today && task.status !== "done";
    row.createDiv({
      cls: "filo-due" + (overdue ? " filo-overdue" : ""),
      text: task.due ?? "",
    });

    // Tags.
    const tagsEl = row.createDiv({ cls: "filo-tags" });
    for (const tag of task.tags) tagsEl.createEl("span", { cls: "filo-tag", text: tag });

    // Total tracked time (live for running rows).
    const timeEl = row.createDiv({
      cls: "filo-time" + (flagged ? " filo-flagged" : ""),
      text: formatDuration(ms),
    });
    this.timeEls.set(task.id, timeEl);
    if (running) this.runningTasks.push(task);

    // Start/stop button — mutates the TARGET task's file, not this list.
    const timerBtn = row.createEl("button", {
      cls: "filo-timer" + (running ? " filo-running" : ""),
      text: running ? "⏹ Stop" : "▶ Start",
    });
    timerBtn.addEventListener("click", () => {
      if (running) void this.plugin.store.stopTimer(task.id);
      else void this.plugin.store.startTimer(task.id);
    });

    // The inline child-creation form lives just below the row (full width),
    // toggled by the childBtn created next to the status toggle above.
    this.renderChildForm(container, task, childBtn);

    if (flagged) {
      console.warn(
        `[Filo] Task "${task.title}" (${task.id}) has a running session exceeding the ` +
          `${this.plugin.settings.timerCapHours}h cap. Time is capped and flagged.`
      );
    }
  }

  /** Inline, collapsible "new child" form appended after a row. */
  private renderChildForm(container: HTMLElement, task: Task, toggleBtn: HTMLElement): void {
    const form = container.createDiv({ cls: "filo-child-form" });
    const input = form.createEl("input", {
      type: "text",
      cls: "filo-child-input",
      attr: { placeholder: `New child of "${task.title}"…` },
    });
    const create = form.createEl("button", { text: "Create", cls: "filo-child-create" });
    const cancel = form.createEl("button", { text: "Cancel", cls: "filo-child-cancel" });

    const close = () => {
      form.removeClass("is-open");
      input.value = "";
    };
    toggleBtn.addEventListener("click", () => {
      const willOpen = !form.hasClass("is-open");
      form.toggleClass("is-open", willOpen);
      if (willOpen) input.focus();
      else input.value = "";
    });

    const submit = async () => {
      const title = input.value.trim();
      if (!title) return;
      // Parent is THIS task; the store re-renders on create, collapsing the
      // form. Routed through the plugin wrapper so that if this list is viewed
      // from the parent task's own file, the new child opens.
      await this.plugin.createTask({ title, parent: task.id });
    };
    create.addEventListener("click", () => void submit());
    cancel.addEventListener("click", close);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      } else if (e.key === "Escape") {
        close();
      }
    });
  }
}
