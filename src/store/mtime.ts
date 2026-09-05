import { App, TFile } from "obsidian";
import { Task } from "../types";

/**
 * Modification time of a task's backing file, or 0 when the file can't be
 * resolved (which sorts it last rather than dropping it).
 *
 * mtime lives on the vault file, not in the Task record, so anything that wants
 * "most recently touched first" ordering goes through here.
 */
export function taskMtime(app: App, task: Task): number {
  const f = app.vault.getAbstractFileByPath(task.path);
  return f instanceof TFile ? f.stat.mtime : 0;
}

/**
 * Copy of `tasks` ordered most-recently-modified first. mtime is read once per
 * task up front rather than inside the comparator, which would re-hit the vault
 * on every comparison.
 */
export function byRecentlyModified(app: App, tasks: Task[]): Task[] {
  return tasks
    .map((task) => ({ task, mtime: taskMtime(app, task) }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.task);
}

/**
 * "3m ago" / "2h ago" / "5d ago" — compact recency for a meta line, falling
 * back to a plain date past a month. Empty string for a missing timestamp, so
 * callers can drop the field rather than print "just now" for nothing.
 */
export function relativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
