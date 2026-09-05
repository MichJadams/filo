import { App, Modal, Notice, Setting } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";

/**
 * Confirm a subtree copy and name the new root.
 *
 * Copying writes a whole tree of new notes at once, so the count is shown up
 * front rather than leaving you to discover how much landed — see
 * `TaskStore.copySubtree` for what carries over and what resets.
 */
export class CopyTaskModal extends Modal {
  private plugin: FiloPlugin;
  private task: Task;
  private count: number;
  private titleVal: string;

  constructor(app: App, plugin: FiloPlugin, task: Task, count: number) {
    super(app);
    this.plugin = plugin;
    this.task = task;
    this.count = count;
    this.titleVal = task.title;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("Copy task tree");
    contentEl.empty();

    const others = this.count - 1;
    contentEl.createEl("p", {
      text:
        others > 0
          ? `Copies "${this.task.title}" and its ${others} subtask${others === 1 ? "" : "s"}.`
          : `Copies "${this.task.title}".`,
    });
    contentEl.createEl("p", {
      cls: "filo-copy-note",
      text:
        "The copies start undone with timers and recurrence logs cleared, as a new top-level tree. The originals are not touched.",
    });

    const refs: { title?: HTMLInputElement } = {};

    new Setting(contentEl).setName("New root title").addText((t) => {
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
        .setButtonText("Copy")
        .setCta()
        .onClick(() => void this.submit())
    );

    // Selected, not just focused: a copy usually wants a new name, and the
    // originals keeping theirs makes two identically-titled trees confusing.
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

    try {
      const copy = await this.plugin.store.copySubtree(this.task.id, title);
      new Notice(
        `Filo: copied ${this.count} task${this.count === 1 ? "" : "s"} to "${copy.title}"`
      );
      this.close();
      await this.plugin.openTaskFile(copy);
    } catch (e) {
      console.error("[Filo] copy failed", e);
      new Notice("Filo: failed to copy task tree");
    }
  }
}
