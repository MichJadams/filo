import { App, Modal, Notice, Setting } from "obsidian";
import type FiloPlugin from "../main";
import { CADENCE_PRESETS, parseCron } from "../store/recurrence";

/**
 * Modal used by the command-palette "Create task" commands. Mirrors the t-add
 * widget's fields (title, due, tags, parent) but in a dialog, since palette
 * commands can't render inline forms.
 *
 * `defaultParentId` pre-selects a parent (e.g. the task whose file is active),
 * matching the auto-parenting behavior of the inline t-add form.
 */
export class CreateTaskModal extends Modal {
  private plugin: FiloPlugin;
  private defaultParentId: string | null;

  private titleVal = "";
  private dueVal = "";
  private tagsVal = "";
  private parentId: string | null;
  private recurring = false;
  /** Selected cadence preset key, or "custom". */
  private cadenceKey = CADENCE_PRESETS[0].key;
  private customCadence = "";

  constructor(app: App, plugin: FiloPlugin, defaultParentId: string | null) {
    super(app);
    this.plugin = plugin;
    this.defaultParentId = defaultParentId;
    this.parentId = defaultParentId;
  }

  onOpen(): void {
    void this.build();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async build(): Promise<void> {
    const { contentEl, titleEl } = this;
    titleEl.setText("Create task");
    contentEl.empty();

    // Object holder so TS doesn't narrow a closure-assigned local to `never`.
    const refs: { title?: HTMLInputElement } = {};

    new Setting(contentEl).setName("Title").addText((t) => {
      refs.title = t.inputEl;
      t.onChange((v) => (this.titleVal = v));
      // Enter anywhere in the title submits.
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void this.submit();
        }
      });
    });

    new Setting(contentEl).setName("Due").addText((t) => {
      t.inputEl.type = "date";
      t.onChange((v) => (this.dueVal = v));
    });

    new Setting(contentEl)
      .setName("Tags")
      .setDesc("Comma-separated")
      .addText((t) => {
        t.setPlaceholder("backend, docs");
        t.onChange((v) => (this.tagsVal = v));
      });

    const tasks = await this.plugin.store.listTasks();
    new Setting(contentEl).setName("Parent").addDropdown((d) => {
      d.addOption("", "(no parent)");
      for (const task of tasks.slice().sort((a, b) => a.title.localeCompare(b.title))) {
        const label =
          task.id === this.defaultParentId ? `${task.title} (current)` : task.title;
        d.addOption(task.id, label);
      }
      d.setValue(this.parentId ?? "");
      d.onChange((v) => (this.parentId = v || null));
    });

    // Recurring toggle + cadence picker. The cadence rows are revealed only
    // when "Recurring" is on.
    new Setting(contentEl)
      .setName("Recurring")
      .setDesc("Reset this task to undone on a cadence and log each period's outcome.")
      .addToggle((t) =>
        t.setValue(this.recurring).onChange((v) => {
          this.recurring = v;
          cadenceSetting.settingEl.toggle(v);
          customSetting.settingEl.toggle(v && this.cadenceKey === "custom");
        })
      );

    const cadenceSetting = new Setting(contentEl).setName("Cadence").addDropdown((d) => {
      for (const p of CADENCE_PRESETS) d.addOption(p.key, p.label);
      d.addOption("custom", "Custom (cron)");
      d.setValue(this.cadenceKey);
      d.onChange((v) => {
        this.cadenceKey = v;
        customSetting.settingEl.toggle(this.recurring && v === "custom");
      });
    });

    const customSetting = new Setting(contentEl)
      .setName("Custom cron")
      .setDesc("5-field cron, e.g. \"0 0 * * *\" (daily at midnight).")
      .addText((t) => {
        t.setPlaceholder("0 0 * * *");
        t.onChange((v) => (this.customCadence = v));
      });

    cadenceSetting.settingEl.toggle(this.recurring);
    customSetting.settingEl.toggle(this.recurring && this.cadenceKey === "custom");

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Create")
        .setCta()
        .onClick(() => void this.submit())
    );

    refs.title?.focus();
  }

  /** Resolve the chosen cadence to a cron string, or null if invalid. */
  private resolveCadence(): string | null {
    if (this.cadenceKey === "custom") {
      const expr = this.customCadence.trim();
      return parseCron(expr) ? expr : null;
    }
    return CADENCE_PRESETS.find((p) => p.key === this.cadenceKey)?.cron ?? null;
  }

  private async submit(): Promise<void> {
    const title = this.titleVal.trim();
    if (!title) {
      new Notice("Filo: title required");
      return;
    }
    const tags = this.tagsVal
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let cadence: string | null = null;
    if (this.recurring) {
      cadence = this.resolveCadence();
      if (!cadence) {
        new Notice("Filo: invalid cron cadence");
        return;
      }
    }

    // Via the plugin wrapper so a child of the current task opens automatically.
    await this.plugin.createTask({
      title,
      due: this.dueVal || null,
      tags,
      parent: this.parentId,
      recurring: this.recurring,
      cadence,
    });
    new Notice(`Filo: created "${title}"`);
    this.close();
  }
}
