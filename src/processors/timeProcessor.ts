import { MarkdownRenderChild } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import { computeTotal, formatDuration } from "../store/timeBlock";

/** Render an ISO timestamp as a short local "Jun 14, 13:05" label. */
function formatStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return iso || "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Renders a ```t-time block.
 *
 * The block is the task's time store (`start:`/`stop:` lines, parsed by
 * store/timeBlock) AND its control surface: Start / Stop buttons that act on
 * the task whose file the block lives in, so a task can be timed from its own
 * page without going through a `t-list` or the header action.
 *
 * Lifecycle mirrors ListWidget: the store subscription and the 1s tick are both
 * registered on the render child, so they're torn down when the block unloads.
 */
export class TimeWidget extends MarkdownRenderChild {
  private plugin: FiloPlugin;
  private sourcePath: string;

  /** Elapsed-time cell, updated in place by the tick while a timer runs. */
  private totalEl: HTMLElement | null = null;
  /** Task the block belongs to; null when the block sits in a non-task note. */
  private task: Task | null = null;
  /** Monotonic render token; guards against interleaved async renders. */
  private renderSeq = 0;

  constructor(plugin: FiloPlugin, containerEl: HTMLElement, sourcePath: string) {
    super(containerEl);
    this.plugin = plugin;
    this.sourcePath = sourcePath;
  }

  onload(): void {
    this.register(this.plugin.store.subscribe(() => void this.render()));
    this.registerInterval(window.setInterval(() => this.tick(), 1000));
    void this.render();
  }

  /** Live-update the elapsed total while a session is open. */
  private tick(): void {
    const task = this.task;
    if (!task || !this.totalEl) return;
    const { ms, flagged, running } = computeTotal(
      task.sessions,
      this.plugin.getTimerCapMs(),
      Date.now()
    );
    if (!running) return;
    this.totalEl.setText(formatDuration(ms));
    this.totalEl.toggleClass("filo-flagged", flagged);
  }

  private async render(): Promise<void> {
    const seq = ++this.renderSeq;
    const tasks = await this.plugin.store.listTasks();
    // Only the latest render is allowed to touch the DOM.
    if (seq !== this.renderSeq) return;

    const task = tasks.find((t) => t.path === this.sourcePath) ?? null;
    this.task = task;

    const el = this.containerEl;
    el.empty();
    el.addClass("filo-time-block");
    this.totalEl = null;

    if (!task) {
      // The block only makes sense inside a task file: there's no id to time.
      el.createDiv({
        cls: "filo-empty",
        text: "t-time: this note isn't a Filo task, so there's nothing to time.",
      });
      return;
    }

    const { ms, flagged, running } = computeTotal(task.sessions, this.plugin.getTimerCapMs());

    const header = el.createDiv({ cls: "filo-time-header" });
    this.totalEl = header.createDiv({
      cls: "filo-time-total" + (flagged ? " filo-flagged" : ""),
      text: formatDuration(ms),
    });
    header.createDiv({
      cls: "filo-time-state" + (running ? " filo-running" : ""),
      text: running ? "● running" : `${task.sessions.length} session${task.sessions.length === 1 ? "" : "s"}`,
    });

    // Start / Stop as two distinct buttons; the one that doesn't apply to the
    // current state is disabled rather than hidden, so the control row doesn't
    // reflow when the timer flips.
    const controls = header.createDiv({ cls: "filo-time-controls" });
    const startBtn = controls.createEl("button", {
      cls: "filo-time-start",
      text: "▶ Start",
      attr: { "aria-label": `Start timer for "${task.title}"` },
    });
    startBtn.disabled = running;
    startBtn.addEventListener("click", () => void this.plugin.store.startTimer(task.id));

    const stopBtn = controls.createEl("button", {
      cls: "filo-time-stop" + (running ? " filo-running" : ""),
      text: "⏹ Stop",
      attr: { "aria-label": `Stop timer for "${task.title}"` },
    });
    stopBtn.disabled = !running;
    stopBtn.addEventListener("click", () => void this.plugin.store.stopTimer(task.id));

    if (flagged) {
      el.createDiv({
        cls: "filo-error",
        text: `Running session exceeds the ${this.plugin.settings.timerCapHours}h cap — time is capped.`,
      });
    }

    // The raw start/stop lines are hidden once the block renders, so list the
    // sessions back (collapsed) rather than making them unreadable.
    if (task.sessions.length) {
      const details = el.createEl("details", { cls: "filo-time-sessions" });
      details.createEl("summary", { text: "Sessions" });
      const list = details.createEl("ul");
      for (const s of task.sessions) {
        const span = s.stop === null ? "running" : formatDuration(Math.max(0, Date.parse(s.stop) - Date.parse(s.start)));
        list.createEl("li", {
          text: `${formatStamp(s.start)} → ${s.stop === null ? "…" : formatStamp(s.stop)}  (${span})`,
        });
      }
    }
  }
}
