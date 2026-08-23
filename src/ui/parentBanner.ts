import { App, FuzzySuggestModal, MarkdownView, Notice, setIcon } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import { byRecentlyModified } from "../store/mtime";

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
  valueEl: HTMLElement;
  openEl: HTMLElement;
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
      this.refresh(active, task, byId);
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
    el.createSpan({ cls: "filo-parent-label", text: "Parent" });

    // The task id is captured here; current data is re-read at click time so
    // the banner acts on the task's live parent, not a stale snapshot.
    const valueEl = el.createEl("button", { cls: "filo-parent-value" });
    valueEl.addEventListener("click", () => void this.openPicker(task.id));

    const openEl = el.createEl("button", { cls: "filo-parent-open" });
    setIcon(openEl, "corner-left-up");
    openEl.setAttribute("aria-label", "Open parent task");
    openEl.addEventListener("click", () => void this.goToParent(task.id));

    view.contentEl.prepend(el);

    const rec: BannerRecord = { taskId: task.id, el, valueEl, openEl };
    this.records.set(view, rec);
    return rec;
  }

  private removeRecord(view: MarkdownView, rec: BannerRecord): void {
    rec.el.remove();
    this.records.delete(view);
  }

  private refresh(rec: BannerRecord, task: Task, byId: Map<string, Task>): void {
    const parent = task.parent ? byId.get(task.parent) : undefined;

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
