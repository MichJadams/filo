import { setIcon } from "obsidian";
import type FiloPlugin from "../main";
import { TimeSession } from "../types";
import { computeTotal, formatDuration } from "../store/timeBlock";

const MAX_TITLE = 28;

/**
 * Bottom status-bar item showing the "current task" — the task with a running
 * timer if any, otherwise the most recently opened task. Clicking it opens that
 * task. While a timer runs, the elapsed time ticks live.
 */
export class CurrentTaskStatus {
  private plugin: FiloPlugin;
  private el: HTMLElement;
  private iconEl: HTMLElement;
  private textEl: HTMLElement;

  private currentId: string | null = null;
  private title = "";
  private sessions: TimeSession[] = [];
  private running = false;

  constructor(plugin: FiloPlugin, el: HTMLElement) {
    this.plugin = plugin;
    this.el = el;
    el.addClass("filo-status-item", "mod-clickable");
    this.iconEl = el.createSpan({ cls: "filo-status-icon" });
    this.textEl = el.createSpan({ cls: "filo-status-text" });
    el.addEventListener("click", () => void this.onClick());
  }

  private async onClick(): Promise<void> {
    if (!this.currentId) return;
    const task = await this.plugin.store.getTask(this.currentId);
    if (task) await this.plugin.openTaskFile(task);
  }

  /** Recompute which task is current and re-render. */
  async update(): Promise<void> {
    const id = this.plugin.currentTaskId();
    const task = id ? await this.plugin.store.getTask(id) : null;

    if (!task) {
      this.currentId = null;
      this.running = false;
      this.sessions = [];
      this.title = "";
      this.el.toggleClass("filo-running", false);
      setIcon(this.iconEl, "circle");
      this.textEl.setText("No current task");
      this.el.setAttribute("aria-label", "Filo: no current task");
      return;
    }

    this.currentId = task.id;
    this.title = task.title;
    this.sessions = task.sessions;
    this.running = task.sessions.some((s) => s.stop === null);

    setIcon(this.iconEl, this.running ? "clock" : "circle");
    this.el.toggleClass("filo-running", this.running);
    this.el.setAttribute("aria-label", `Filo: jump to "${task.title}"`);
    this.renderText();
  }

  /** Live-update only the elapsed time while a timer runs. */
  tick(): void {
    if (this.running) this.renderText();
  }

  private renderText(): void {
    const short =
      this.title.length > MAX_TITLE ? this.title.slice(0, MAX_TITLE - 1) + "…" : this.title;
    if (this.running) {
      const { ms } = computeTotal(this.sessions, this.plugin.getTimerCapMs());
      this.textEl.setText(`${short} · ${formatDuration(ms)}`);
    } else {
      this.textEl.setText(short);
    }
  }
}
