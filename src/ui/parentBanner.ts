import { App, FuzzySuggestModal, MarkdownView, Menu, Notice, setIcon } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import { byRecentlyModified } from "../store/mtime";

/** Menu icon per status, so a child's state is readable in the dropdown. */
const STATUS_MENU_ICON: Record<Task["status"], string> = {
  undone: "circle",
  "in-progress": "circle-dot",
  done: "check-circle",
};

/** Status toggle cycle, matching the t-list row button. */
const NEXT_STATUS: Record<Task["status"], Task["status"]> = {
  undone: "in-progress",
  "in-progress": "done",
  done: "undone",
};

/** Readable status names for the banner toggle's label and tooltip. */
const STATUS_LABEL: Record<Task["status"], string> = {
  undone: "Undone",
  "in-progress": "In progress",
  done: "Done",
};

/** Every status class the toggle can carry, cleared before the current one is set. */
const STATUS_CLASSES = (Object.keys(STATUS_LABEL) as Task["status"][]).map(
  (s) => `filo-banner-status-${s}`
);

/**
 * One entry in the parent picker. `task === null` is the "clear the parent"
 * row, which is why the list isn't simply `Task[]`.
 */
interface ParentChoice {
  task: Task | null;
  label: string;
}

/** Fuzzy picker over task titles that writes back the chosen task's id. */
class ParentPickerModal extends FuzzySuggestModal<ParentChoice> {
  private choices: ParentChoice[];
  private onChoose: (choice: ParentChoice) => void;

  constructor(app: App, choices: ParentChoice[], onChoose: (choice: ParentChoice) => void) {
    super(app);
    this.choices = choices;
    this.onChoose = onChoose;
    this.setPlaceholder("Search tasks by title…");
  }

  getItems(): ParentChoice[] {
    return this.choices;
  }
  getItemText(choice: ParentChoice): string {
    return choice.label;
  }
  onChooseItem(choice: ParentChoice): void {
    this.onChoose(choice);
  }
}

/** Per-view banner state. Keyed by view, rebuilt when the view's task changes. */
interface BannerRecord {
  taskId: string;
  el: HTMLElement;
  statusEl: HTMLElement;
  statusIconEl: HTMLElement;
  statusTextEl: HTMLElement;
  valueEl: HTMLElement;
  openEl: HTMLElement;
  childrenEl: HTMLElement;
  childCountEl: HTMLElement;
}

/**
 * A banner at the top of every task note showing the parent task's **title**.
 *
 * Obsidian's frontmatter property editor can only show the raw `parent` value —
 * an opaque task id — and offers no plugin hook to relabel it. This banner is
 * the readable counterpart: click it to pick a parent by title, and the id is
 * what actually gets written to frontmatter.
 */
export class ParentBannerManager {
  private plugin: FiloPlugin;
  private records = new Map<MarkdownView, BannerRecord>();

  constructor(plugin: FiloPlugin) {
    this.plugin = plugin;
  }

  /** Re-sync banners across all open markdown leaves. */
  async update(): Promise<void> {
    if (!this.plugin.settings.parentBanner) {
      this.destroy();
      return;
    }

    const tasks = await this.plugin.store.listTasks();
    const byPath = new Map(tasks.map((t) => [t.path, t]));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const byParent = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.parent) continue;
      const arr = byParent.get(t.parent) ?? [];
      arr.push(t);
      byParent.set(t.parent, arr);
    }

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

      const active =
        rec && rec.taskId === task.id ? rec : this.replaceRecord(view, rec, task);
      // Switching between reading and editing mode can swap out the view's
      // content, taking the banner with it; re-attach when that happens.
      if (!active.el.isConnected) view.contentEl.prepend(active.el);
      this.refresh(active, task, byId, byParent.get(task.id) ?? []);
    }

    for (const view of Array.from(this.records.keys())) {
      if (!live.has(view)) this.records.delete(view);
    }
  }

  private replaceRecord(
    view: MarkdownView,
    rec: BannerRecord | undefined,
    task: Task
  ): BannerRecord {
    if (rec) this.removeRecord(view, rec);
    return this.addBanner(view, task);
  }

  private addBanner(view: MarkdownView, task: Task): BannerRecord {
    const el = createDiv({ cls: "filo-parent-banner" });

    // Status toggle — cycles undone -> in-progress -> done -> undone, matching
    // the t-list row button. First in the banner so the task's own state reads
    // before its parent's title.
    const statusEl = el.createEl("button", { cls: "filo-banner-status" });
    const statusIconEl = statusEl.createSpan({ cls: "filo-banner-status-icon" });
    const statusTextEl = statusEl.createSpan({ cls: "filo-banner-status-text" });
    statusEl.addEventListener("click", () => void this.cycleStatus(task.id));

    el.createSpan({ cls: "filo-parent-label", text: "Parent" });

    // The task id is captured here; current data is re-read at click time so
    // the banner acts on the task's live parent, not a stale snapshot.
    const valueEl = el.createEl("button", { cls: "filo-parent-value" });
    valueEl.addEventListener("click", () => void this.openPicker(task.id));

    const openEl = el.createEl("button", { cls: "filo-parent-open" });
    setIcon(openEl, "corner-left-up");
    openEl.setAttribute("aria-label", "Open parent task");
    openEl.addEventListener("click", () => void this.goToParent(task.id));

    const childrenEl = el.createEl("button", { cls: "filo-parent-children" });
    const childIconEl = childrenEl.createSpan({ cls: "filo-parent-children-icon" });
    setIcon(childIconEl, "list-tree");
    const childCountEl = childrenEl.createSpan({ cls: "filo-parent-children-count" });
    childrenEl.addEventListener("click", (evt) => void this.openChildMenu(task.id, evt));

    view.contentEl.prepend(el);

    const rec: BannerRecord = {
      taskId: task.id,
      el,
      statusEl,
      statusIconEl,
      statusTextEl,
      valueEl,
      openEl,
      childrenEl,
      childCountEl,
    };
    this.records.set(view, rec);
    return rec;
  }

  private removeRecord(view: MarkdownView, rec: BannerRecord): void {
    rec.el.remove();
    this.records.delete(view);
  }

  private refresh(
    rec: BannerRecord,
    task: Task,
    byId: Map<string, Task>,
    children: Task[]
  ): void {
    const parent = task.parent ? byId.get(task.parent) : undefined;

    // Status toggle: icon + label show the current status, the class carries the
    // color, and the tooltip names what a click will do next.
    rec.statusEl.removeClass(...STATUS_CLASSES);
    rec.statusEl.addClass(`filo-banner-status-${task.status}`);
    rec.statusIconEl.empty();
    setIcon(rec.statusIconEl, STATUS_MENU_ICON[task.status]);
    rec.statusTextEl.setText(STATUS_LABEL[task.status]);
    rec.statusEl.setAttribute(
      "aria-label",
      `Status: ${STATUS_LABEL[task.status]} — click to mark ` +
        STATUS_LABEL[NEXT_STATUS[task.status]].toLowerCase()
    );

    if (parent) {
      rec.valueEl.setText(parent.title);
      rec.valueEl.removeClass("filo-parent-none", "filo-parent-broken");
      rec.valueEl.setAttribute("aria-label", "Change parent task");
    } else if (task.parent) {
      // Frontmatter points at an id no task has — surface it rather than
      // silently rendering "no parent", since the raw id is the clue needed
      // to fix it.
      rec.valueEl.setText(`⚠ missing task ${task.parent}`);
      rec.valueEl.removeClass("filo-parent-none");
      rec.valueEl.addClass("filo-parent-broken");
      rec.valueEl.setAttribute("aria-label", "Change parent task");
    } else {
      rec.valueEl.setText("Set parent…");
      rec.valueEl.removeClass("filo-parent-broken");
      rec.valueEl.addClass("filo-parent-none");
      rec.valueEl.setAttribute("aria-label", "Set parent task");
    }

    rec.openEl.toggle(!!parent);

    // Only parent tasks get the subtask dropdown; leaves have nothing to list.
    rec.childrenEl.toggle(children.length > 0);
    rec.childCountEl.setText(String(children.length));
    rec.childrenEl.setAttribute(
      "aria-label",
      children.length === 1 ? "1 subtask" : `${children.length} subtasks`
    );
  }

  /**
   * Advance the task one step around the status cycle. The status is re-read at
   * click time (rather than taken from the rendered banner) so a banner that
   * hasn't refreshed yet can't write a value based on a stale status.
   */
  private async cycleStatus(taskId: string): Promise<void> {
    const task = await this.plugin.store.getTask(taskId);
    if (!task) return;
    try {
      await this.plugin.store.setStatus(taskId, NEXT_STATUS[task.status]);
    } catch (e) {
      console.error("[Filo] failed to set status", e);
      new Notice("Filo: failed to set status");
    }
  }

  /**
   * Drop down the task's direct children so a parent note can jump straight
   * into any of them. Children are re-read at click time, and ordered undone
   * first so the still-open work is nearest the cursor.
   */
  private async openChildMenu(taskId: string, evt: MouseEvent): Promise<void> {
    const children = await this.plugin.store.getChildren(taskId);
    if (!children.length) {
      new Notice("Filo: no subtasks.");
      return;
    }

    const order: Record<Task["status"], number> = {
      undone: 0,
      "in-progress": 1,
      done: 2,
    };
    const sorted = children
      .slice()
      .sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));

    const menu = new Menu();
    for (const child of sorted) {
      menu.addItem((item) =>
        item
          .setTitle(child.title)
          .setIcon(STATUS_MENU_ICON[child.status])
          .onClick(() => void this.plugin.openTaskFile(child))
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private async goToParent(taskId: string): Promise<void> {
    const task = await this.plugin.store.getTask(taskId);
    if (!task?.parent) return;
    const parent = await this.plugin.store.getTask(task.parent);
    if (parent) await this.plugin.openTaskFile(parent);
  }

  /**
   * Offer every task as a parent except the task itself and its own
   * descendants — reparenting under a descendant would create a cycle.
   * Ordered most-recently-modified first, matching the `/t` dropdown.
   */
  private async openPicker(taskId: string): Promise<void> {
    const app = this.plugin.app;
    const task = await this.plugin.store.getTask(taskId);
    if (!task) return;

    const descendants = new Set(
      (await this.plugin.store.getSubtree(taskId)).map((n) => n.task.id)
    );
    const candidates = byRecentlyModified(
      app,
      (await this.plugin.store.listTasks()).filter((t) => !descendants.has(t.id))
    );

    const choices: ParentChoice[] = [];
    if (task.parent) choices.push({ task: null, label: "(no parent)" });
    for (const t of candidates) {
      choices.push({ task: t, label: t.title });
    }

    if (!choices.length) {
      new Notice("Filo: no other tasks available as a parent.");
      return;
    }

    new ParentPickerModal(app, choices, (choice) => {
      void this.setParent(taskId, choice);
    }).open();
  }

  private async setParent(taskId: string, choice: ParentChoice): Promise<void> {
    try {
      await this.plugin.store.updateTask(taskId, { parent: choice.task?.id ?? null });
      new Notice(
        choice.task ? `Filo: parent set to "${choice.task.title}"` : "Filo: parent cleared"
      );
    } catch (e) {
      console.error("[Filo] failed to set parent", e);
      new Notice("Filo: failed to set parent");
    }
  }

  /** Remove all banners (called on plugin unload and when the setting is off). */
  destroy(): void {
    for (const rec of this.records.values()) rec.el.remove();
    this.records.clear();
  }
}
