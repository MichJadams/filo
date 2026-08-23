import { App, PluginSettingTab, Setting } from "obsidian";
import type FiloPlugin from "./main";

export interface FiloSettings {
  /** Folder that holds task files. */
  tasksFolder: string;
  /** Folder where imported `.canvas` files are written ("" = vault root). */
  canvasFolder: string;
  /** Running-session safety cap, in hours. */
  timerCapHours: number;
  /**
   * How canvas node colors map to tracked time:
   *  - "relative": normalized to the longest task in the subtree (longest = reddest);
   *  - "absolute": fixed hour thresholds.
   */
  rednessMode: "relative" | "absolute";
  /** When true, recurring tasks are processed automatically on plugin load. */
  processRecurringOnLoad: boolean;
  /** Enables the inline `/t` task-reference autocomplete in the editor. */
  taskLinkSuggest: boolean;
  /** Text that opens the task-reference dropdown. */
  taskLinkTrigger: string;
  /** Maximum rows shown in the task-reference dropdown. */
  taskLinkMaxResults: number;
  /** When true, completed tasks are omitted from the dropdown. */
  taskLinkHideDone: boolean;
  /** Shows a click-to-change parent banner (by title) at the top of task notes. */
  parentBanner: boolean;
}

export const DEFAULT_SETTINGS: FiloSettings = {
  tasksFolder: "tasks",
  canvasFolder: "",
  timerCapHours: 12,
  rednessMode: "relative",
  processRecurringOnLoad: true,
  taskLinkSuggest: true,
  taskLinkTrigger: "/t",
  taskLinkMaxResults: 20,
  taskLinkHideDone: false,
  parentBanner: true,
};

export class FiloSettingTab extends PluginSettingTab {
  plugin: FiloPlugin;

  constructor(app: App, plugin: FiloPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Tasks folder")
      .setDesc("Vault-relative folder where task files live.")
      .addText((t) =>
        t
          .setPlaceholder("tasks")
          .setValue(this.plugin.settings.tasksFolder)
          .onChange(async (v) => {
            this.plugin.settings.tasksFolder = v.trim() || "tasks";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Canvas output folder")
      .setDesc("Folder for generated .canvas files. Leave empty for the vault root.")
      .addText((t) =>
        t
          .setPlaceholder("(vault root)")
          .setValue(this.plugin.settings.canvasFolder)
          .onChange(async (v) => {
            this.plugin.settings.canvasFolder = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Timer max duration (hours)")
      .setDesc(
        "A running session longer than this is flagged and its time is capped, rather than counted silently."
      )
      .addText((t) =>
        t
          .setPlaceholder("12")
          .setValue(String(this.plugin.settings.timerCapHours))
          .onChange(async (v) => {
            const n = Number(v);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.timerCapHours = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Redness mode")
      .setDesc(
        "How tracked time maps to canvas node color. Relative normalizes to the longest task in the subtree."
      )
      .addDropdown((d) =>
        d
          .addOption("relative", "Relative to subtree")
          .addOption("absolute", "Absolute thresholds")
          .setValue(this.plugin.settings.rednessMode)
          .onChange(async (v) => {
            this.plugin.settings.rednessMode = v as "relative" | "absolute";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Process recurring tasks on load")
      .setDesc(
        "Automatically reset due recurring tasks when the plugin loads. You can also run it any time via the \"Load tasks\" command."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.processRecurringOnLoad).onChange(async (v) => {
          this.plugin.settings.processRecurringOnLoad = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Task references").setHeading();

    new Setting(containerEl)
      .setName("Inline task autocomplete")
      .setDesc(
        "Type the trigger anywhere in a note to pick a task from a dropdown and insert a link to it."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.taskLinkSuggest).onChange(async (v) => {
          this.plugin.settings.taskLinkSuggest = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Trigger text")
      .setDesc("Opens the dropdown when typed at the start of a line or after a space.")
      .addText((t) =>
        t
          .setPlaceholder("/t")
          .setValue(this.plugin.settings.taskLinkTrigger)
          .onChange(async (v) => {
            this.plugin.settings.taskLinkTrigger = v.trim() || "/t";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Dropdown results")
      .setDesc("How many tasks to show, taking the most recently modified first.")
      .addText((t) =>
        t
          .setPlaceholder("20")
          .setValue(String(this.plugin.settings.taskLinkMaxResults))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 1) {
              this.plugin.settings.taskLinkMaxResults = Math.floor(n);
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Hide completed tasks")
      .setDesc("Omit done tasks from the dropdown.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.taskLinkHideDone).onChange(async (v) => {
          this.plugin.settings.taskLinkHideDone = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Parent banner on task notes")
      .setDesc(
        "Show the parent task's title at the top of a task note, and click it to pick a new parent by title. Obsidian's own properties editor can only show the raw parent id."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.parentBanner).onChange(async (v) => {
          this.plugin.settings.parentBanner = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
