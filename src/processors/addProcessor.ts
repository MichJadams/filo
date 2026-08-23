import { MarkdownRenderChild, Notice } from "obsidian";
import type FiloPlugin from "../main";
import { CADENCE_PRESETS, parseCron } from "../store/recurrence";

/**
 * Persistent inline "add task" form rendered for a ```t-add code block.
 *
 * Extends MarkdownRenderChild so its store subscription is auto-unregistered
 * when the block leaves the DOM. The subscription keeps the parent picker in
 * sync as tasks are created/deleted elsewhere.
 */
export class AddWidget extends MarkdownRenderChild {
  private plugin: FiloPlugin;
  private parentSelect: HTMLSelectElement | null = null;

  /** Path of the note this t-add block lives in. */
  private sourcePath: string;
  /** Task id of the containing file, if that file is itself a task. */
  private containingTaskId: string | null = null;
  /** Once the user picks a parent manually, stop auto-defaulting. */
  private userPickedParent = false;
  /** Monotonic token; guards against interleaved async option rebuilds. */
  private refreshSeq = 0;

  constructor(plugin: FiloPlugin, containerEl: HTMLElement, sourcePath: string) {
    super(containerEl);
    this.plugin = plugin;
    this.sourcePath = sourcePath;
  }

  onload(): void {
    this.build();
    // Refresh the parent dropdown whenever the task set changes.
    this.register(this.plugin.store.subscribe(() => this.refreshParents()));
  }

  private build(): void {
    const el = this.containerEl;
    el.empty();
    el.addClass("filo-add");

    const titleInput = el.createEl("input", {
      type: "text",
      cls: "filo-add-title",
      attr: { placeholder: "Task title" },
    });

    const row = el.createDiv({ cls: "filo-add-row" });
    const dueInput = row.createEl("input", { type: "date", cls: "filo-add-due" });
    const tagsInput = row.createEl("input", {
      type: "text",
      cls: "filo-add-tags",
      attr: { placeholder: "tags, comma, separated" },
    });

    this.parentSelect = row.createEl("select", { cls: "filo-add-parent" });
    // A manual selection disables the containing-task auto-default.
    this.parentSelect.addEventListener("change", () => {
      this.userPickedParent = true;
    });
    void this.refreshParents();

    // Recurring controls: a checkbox, a cadence preset select, and a custom
    // cron input revealed only when "Custom" is chosen. The whole row collapses
    // to just the checkbox until recurring is enabled.
    const recurRow = el.createDiv({ cls: "filo-add-row filo-add-recur" });
    const recurLabel = recurRow.createEl("label", { cls: "filo-add-recur-label" });
    const recurCheck = recurLabel.createEl("input", { type: "checkbox" });
    recurLabel.appendText(" ⟳ recurring");

    const cadenceSelect = recurRow.createEl("select", { cls: "filo-add-cadence" });
    for (const p of CADENCE_PRESETS) cadenceSelect.createEl("option", { text: p.label, value: p.key });
    cadenceSelect.createEl("option", { text: "Custom (cron)", value: "custom" });

    const customInput = recurRow.createEl("input", {
      type: "text",
      cls: "filo-add-cron",
      attr: { placeholder: "0 0 * * *" },
    });

    const syncRecurUI = () => {
      cadenceSelect.toggle(recurCheck.checked);
      customInput.toggle(recurCheck.checked && cadenceSelect.value === "custom");
    };
    recurCheck.addEventListener("change", syncRecurUI);
    cadenceSelect.addEventListener("change", syncRecurUI);
    syncRecurUI();

    const btn = el.createEl("button", { text: "Create", cls: "filo-add-btn" });

    const submit = async () => {
      const title = titleInput.value.trim();
      if (!title) {
        new Notice("Filo: title required");
        return;
      }
      const tags = tagsInput.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const parent = this.parentSelect?.value || null;
      const due = dueInput.value || null;

      const recurring = recurCheck.checked;
      let cadence: string | null = null;
      if (recurring) {
        cadence =
          cadenceSelect.value === "custom"
            ? customInput.value.trim()
            : CADENCE_PRESETS.find((p) => p.key === cadenceSelect.value)?.cron ?? null;
        if (!cadence || !parseCron(cadence)) {
          new Notice("Filo: invalid cron cadence");
          return;
        }
      }

      // Via the plugin wrapper so a child of the current task opens automatically.
      await this.plugin.createTask({ title, due, tags, parent, recurring, cadence });

      // Persistent widget: clear inputs but keep the form usable for the next
      // add. Reset the manual-pick flag so the parent falls back to the
      // containing task default again.
      titleInput.value = "";
      tagsInput.value = "";
      dueInput.value = "";
      recurCheck.checked = false;
      customInput.value = "";
      syncRecurUI();
      this.userPickedParent = false;
      void this.refreshParents();
      new Notice(`Filo: created "${title}"`);
      titleInput.focus();
    };

    btn.addEventListener("click", submit);
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    });
  }

  /**
   * Rebuild the parent <select> from the current task list.
   *
   * If this t-add block lives inside a file that is itself a task, that task is
   * used as the default parent — so tasks created from within a task become its
   * children automatically. The default is only applied until the user picks a
   * parent manually (tracked by `userPickedParent`).
   */
  private async refreshParents(): Promise<void> {
    const sel = this.parentSelect;
    if (!sel) return;

    const seq = ++this.refreshSeq;
    const tasks = await this.plugin.store.listTasks();
    // Abort if a newer refresh started while awaiting, so options aren't doubled.
    if (seq !== this.refreshSeq) return;

    // Is the containing file a task? Match by path.
    this.containingTaskId = tasks.find((t) => t.path === this.sourcePath)?.id ?? null;

    const previous = sel.value;
    sel.empty();
    sel.createEl("option", { text: "(no parent)", value: "" });
    for (const t of tasks.slice().sort((a, b) => a.title.localeCompare(b.title))) {
      const label = t.id === this.containingTaskId ? `${t.title} (this task)` : t.title;
      sel.createEl("option", { text: label, value: t.id });
    }

    // Default to the containing task unless the user has chosen something.
    if (!this.userPickedParent && this.containingTaskId) {
      sel.value = this.containingTaskId;
    } else {
      sel.value = previous;
    }
  }
}
