import { App, Modal, Notice, Setting } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";

/**
 * Prompt for a task's new name, pre-filled with the current one.
 *
 * Renaming writes both places the name lives — the `title` property and the H1
 * heading — via `TaskStore.renameTask`; see there for why they're kept together.
 */
export class RenameTaskModal extends Modal {
  private plugin: FiloPlugin;
  private task: Task;
  private titleVal: string;

  constructor(app: App, plugin: FiloPlugin, task: Task) {
    super(app);
    this.plugin = plugin;
    this.task = task;
    this.titleVal = task.title;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("Rename task");
    contentEl.empty();

    const refs: { title?: HTMLInputElement } = {};

    new Setting(contentEl).setName("Title").addText((t) => {
      refs.title = t.inputEl;
      t.setValue(this.titleVal);
      t.onChange((v) => (this.titleVal = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void this.submit();
        }
      });
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Rename")
        .setCta()
        .onClick(() => void this.submit())
    );

    // Select rather than just focus: renaming usually means replacing the name,
    // not appending to it.
    refs.title?.focus();
    refs.title?.select();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    const title = this.titleVal.trim();
    if (!title) {
      new Notice("Filo: title required");
      return;
    }
    if (title === this.task.title) {
      this.close();
      return;
    }

    try {
      await this.plugin.store.renameTask(this.task.id, title);
      new Notice(`Filo: renamed to "${title}"`);
      this.close();
    } catch (e) {
      console.error("[Filo] rename failed", e);
      new Notice("Filo: failed to rename task");
    }
  }
}
