import { MarkdownView, Menu, Notice, setIcon } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import { computeTotal, formatDuration } from "../store/timeBlock";
import { openTaskCanvas } from "../canvas/canvasImport";

/** A task is running if any of its sessions has no stop time. */
function isRunning(task: Task): boolean {
  return task.sessions.some((s) => s.stop === null);
}

interface ViewRecord {
  taskId: string;
  timerEl: HTMLElement;
  parentEl: HTMLElement;
  childEl: HTMLElement;
  canvasEl: HTMLElement;
}

/**
 * Adds in-file task controls to the top action bar of any open task note:
 *   - a start/stop timer toggle,
 *   - "go to parent task" (shown when the task has a parent),
 *   - "go to child task" (shown when the task has children; opens the only
 *     child, or pops a menu to pick among several),
 *   - "open task canvas" (builds/refreshes the task's canvas and opens it).
 *
 * Works in both reading and editing modes and stays in sync with task changes.
 * One MarkdownView can show different files over its lifetime, so records are
 * keyed by view and re-created when the view's underlying task changes.
 */
export class FileTimerManager {
  private plugin: FiloPlugin;
  private records = new Map<MarkdownView, ViewRecord>();

  constructor(plugin: FiloPlugin) {
    this.plugin = plugin;
  }

  /** Re-sync controls across all open markdown leaves. */
  async update(): Promise<void> {
    const tasks = await this.plugin.store.listTasks();
    const byPath = new Map(tasks.map((t) => [t.path, t]));
    const byId = new Map(tasks.map((t) => [t.id, t]));

    const live = new Set<MarkdownView>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      live.add(view);

      const task = view.file ? byPath.get(view.file.path) : undefined;
      const rec = this.records.get(view);

      if (!task) {
        if (rec) this.removeRecord(view, rec);
        continue;
      }

      const activeRec = rec && rec.taskId === task.id ? rec : this.replaceRecord(view, rec, task);
      const hasParent = !!task.parent && byId.has(task.parent);
      const childCount = tasks.reduce((n, t) => (t.parent === task.id ? n + 1 : n), 0);
      this.refresh(activeRec, task, hasParent, childCount);
    }

    for (const view of Array.from(this.records.keys())) {
      if (!live.has(view)) this.records.delete(view);
    }
  }

  private replaceRecord(
    view: MarkdownView,
    rec: ViewRecord | undefined,
    task: Task
  ): ViewRecord {
    if (rec) this.removeRecord(view, rec);
    return this.addControls(view, task);
  }

  private addControls(view: MarkdownView, task: Task): ViewRecord {
    // Task id is captured here; live state (running/parent/children) is always
    // re-read at click time so the buttons act on current data.
    const timerEl = view.addAction("play", "Filo timer", () => void this.toggleTimer(task.id));
    timerEl.addClass("filo-file-timer");

    const parentEl = view.addAction("corner-left-up", "Filo: go to parent task", () =>
      void this.goToParent(task.id)
    );
    parentEl.addClass("filo-nav-parent");

    const childEl = view.addAction("corner-down-right", "Filo: go to child task", (evt) =>
      void this.goToChild(task.id, evt)
    );
    childEl.addClass("filo-nav-child");

    const canvasEl = view.addAction("layout-dashboard", "Filo: open task canvas", () =>
      void this.openCanvas(task.id)
    );
    canvasEl.addClass("filo-nav-canvas");

    const rec: ViewRecord = { taskId: task.id, timerEl, parentEl, childEl, canvasEl };
    this.records.set(view, rec);
    return rec;
  }

  private removeRecord(view: MarkdownView, rec: ViewRecord): void {
    this.removeEls(rec);
    this.records.delete(view);
  }

  private removeEls(rec: ViewRecord): void {
    rec.timerEl.remove();
    rec.parentEl.remove();
    rec.childEl.remove();
    rec.canvasEl.remove();
  }

  private async toggleTimer(taskId: string): Promise<void> {
    const task = await this.plugin.store.getTask(taskId);
    if (!task) return;
    if (isRunning(task)) await this.plugin.store.stopTimer(taskId);
    else await this.plugin.store.startTimer(taskId);
  }

  private async goToParent(taskId: string): Promise<void> {
    const task = await this.plugin.store.getTask(taskId);
    if (!task?.parent) return;
    const parent = await this.plugin.store.getTask(task.parent);
    if (parent) await this.plugin.openTaskFile(parent);
  }

  private async goToChild(taskId: string, evt: MouseEvent): Promise<void> {
    const children = await this.plugin.store.getChildren(taskId);
    if (!children.length) return;
    if (children.length === 1) {
      await this.plugin.openTaskFile(children[0]);
      return;
    }
    // Multiple children: let the user pick from a menu at the cursor.
    const menu = new Menu();
    for (const child of children.slice().sort((a, b) => a.title.localeCompare(b.title))) {
      menu.addItem((item) =>
        item
          .setTitle(child.title)
          .setIcon("circle")
          .onClick(() => void this.plugin.openTaskFile(child))
      );
    }
    menu.showAtMouseEvent(evt);
  }

  /**
   * Write the task's canvas (task note + its whole subtree) and open it. The
   * canvas is refreshed on every press, so the button doubles as "sync this
   * board with the task tree".
   */
  private async openCanvas(taskId: string): Promise<void> {
    try {
      await openTaskCanvas(this.plugin, taskId);
    } catch (e) {
      console.error("[Filo] failed to open task canvas", e);
      new Notice("Filo: failed to open task canvas");
    }
  }

  private refresh(rec: ViewRecord, task: Task, hasParent: boolean, childCount: number): void {
    const running = isRunning(task);
    setIcon(rec.timerEl, running ? "square" : "play");
    const { ms } = computeTotal(task.sessions, this.plugin.getTimerCapMs());
    rec.timerEl.setAttribute(
      "aria-label",
      `Filo: ${running ? "Stop" : "Start"} timer (${formatDuration(ms)})`
    );
    rec.timerEl.toggleClass("filo-running", running);

    // Parent/child buttons appear only when there's somewhere to navigate.
    rec.parentEl.style.display = hasParent ? "" : "none";
    rec.childEl.style.display = childCount > 0 ? "" : "none";
    rec.childEl.setAttribute(
      "aria-label",
      childCount === 1 ? "Filo: go to child task" : `Filo: go to child task (${childCount})`
    );
  }

  /** Remove all controls (called on plugin unload). */
  destroy(): void {
    for (const rec of this.records.values()) this.removeEls(rec);
    this.records.clear();
  }
}
