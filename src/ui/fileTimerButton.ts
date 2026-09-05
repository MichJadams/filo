import { MarkdownView, Menu, Notice, setIcon } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import { computeTotal, formatDuration } from "../store/timeBlock";
import { openTaskCanvas } from "../canvas/canvasImport";
import { postTaskToSlack } from "../slack/slackStatus";
import { RenameTaskModal } from "../processors/renameTaskModal";
import { CopyTaskModal } from "../processors/copyTaskModal";

/** A task is running if any of its sessions has no stop time. */
function isRunning(task: Task): boolean {
  return task.sessions.some((s) => s.stop === null);
}

interface ViewRecord {
  taskId: string;
  timerEl: HTMLElement;
  slackEl: HTMLElement;
  renameEl: HTMLElement;
  copyEl: HTMLElement;
  parentEl: HTMLElement;
  childEl: HTMLElement;
  canvasEl: HTMLElement;
}

/**
 * Adds in-file task controls to the top action bar of any open task note:
 *   - a start/stop timer toggle,
 *   - "post as Slack status" (📣, beside the timer),
 *   - "rename task" (✎, rewrites the title property and the H1 together),
 *   - "copy task tree" (⧉, a fresh undone copy of this task and its subtree),
 *   - "go to parent task" (shown when the task has a parent),
 *   - "go to child task" (shown when the task has children; opens the only
 *     child, or pops a menu to pick among several),
 *   - "open task canvas" (builds/refreshes the canvas for the task's whole tree
 *     and opens it; works from any task in the tree, not just its root).
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

    // Sits next to the timer: both answer "what am I working on right now?",
    // one for you and one for everyone else.
    const slackEl = view.addAction("megaphone", "Filo: post as Slack status", () =>
      void this.postSlack(task.id)
    );
    slackEl.addClass("filo-slack-status");

    const renameEl = view.addAction("pencil", "Filo: rename task", () =>
      void this.rename(task.id)
    );
    renameEl.addClass("filo-task-rename");

    const copyEl = view.addAction("copy", "Filo: copy task tree", () =>
      void this.copy(task.id)
    );
    copyEl.addClass("filo-task-copy");

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

    const rec: ViewRecord = {
      taskId: task.id,
      timerEl,
      slackEl,
      renameEl,
      copyEl,
      parentEl,
      childEl,
      canvasEl,
    };
    this.records.set(view, rec);
    return rec;
  }

  private removeRecord(view: MarkdownView, rec: ViewRecord): void {
    this.removeEls(rec);
    this.records.delete(view);
  }

  private removeEls(rec: ViewRecord): void {
    rec.timerEl.remove();
    rec.slackEl.remove();
    rec.renameEl.remove();
    rec.copyEl.remove();
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

  /**
   * Announce this task on Slack as the custom status. Always available (rather
   * than hidden when no token is set) so the missing-token notice is reachable
   * and says what to do about it.
   */
  private async postSlack(taskId: string): Promise<void> {
    const task = await this.plugin.store.getTask(taskId);
    if (!task) return;
    try {
      await postTaskToSlack(this.plugin, task);
    } catch (e) {
      console.error("[Filo] Slack status update failed", e);
      new Notice("Filo: failed to set Slack status");
    }
  }

  /**
   * Rename the task from a prompt pre-filled with its current name. Read live
   * rather than from the captured record, so the prompt can't open on a stale
   * title.
   */
  private async rename(taskId: string): Promise<void> {
    const task = await this.plugin.store.getTask(taskId);
    if (!task) return;
    new RenameTaskModal(this.plugin.app, this.plugin, task).open();
  }

  /**
   * Copy this task and its subtree. The count is resolved here so the dialog can
   * say up front how many notes the copy will write.
   */
  private async copy(taskId: string): Promise<void> {
    const task = await this.plugin.store.getTask(taskId);
    if (!task) return;
    const count = (await this.plugin.store.getSubtree(taskId)).length;
    new CopyTaskModal(this.plugin.app, this.plugin, task, count).open();
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
   * Write the canvas for this task's whole tree and open it. The tree is
   * resolved from its outermost ancestor, so a child opens the same board as
   * the root rather than a partial one of its own subtree. The canvas is
   * refreshed on every press, so the button doubles as "sync this board with
   * the task tree".
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
