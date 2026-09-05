import {
  App,
  SearchMatches,
  SuggestModal,
  prepareFuzzySearch,
  renderMatches,
} from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import { STATUS_ICON } from "../processors/listProcessor";
import { relativeTime, taskMtime } from "../store/mtime";

/** Rows shown at once. Enough to scroll, few enough to stay scannable. */
const MAX_RESULTS = 50;

/**
 * A scored candidate. `matches` carries the fuzzy hit offsets *into the title*
 * so they can be highlighted; a task matched only by one of its tags has none.
 */
interface TaskHit {
  task: Task;
  matches: SearchMatches | null;
  /** True when the **title** matched, false when only a tag did. */
  viaTitle: boolean;
  score: number;
  mtime: number;
}

/**
 * A quick switcher scoped to tasks — the whole point being that it searches
 * tasks *only*, where Obsidian's own switcher and global search cover the
 * entire vault and bury them among ordinary notes.
 *
 * Matching is fuzzy over **title and tags**, the same pair the inline `/t`
 * autocomplete uses, so the two behave alike. Task bodies are deliberately not
 * searched: this is a "jump to the task I mean" switcher, and full-text is what
 * Obsidian's search is for.
 *
 * Tasks are passed in rather than read here, so the list is a stable snapshot
 * for the life of the dialog and no keystroke re-hits the store.
 */
export class TaskSearchModal extends SuggestModal<TaskHit> {
  private plugin: FiloPlugin;
  private hits: TaskHit[];
  private titleById: Map<string, string>;

  constructor(app: App, plugin: FiloPlugin, tasks: Task[]) {
    super(app);
    this.plugin = plugin;
    this.titleById = new Map(tasks.map((t) => [t.id, t.title]));
    // mtime is read once per task here rather than inside a comparator, which
    // would re-hit the vault on every comparison of every keystroke.
    this.hits = tasks.map((task) => ({
      task,
      matches: null,
      viaTitle: false,
      score: 0,
      mtime: taskMtime(app, task),
    }));

    this.limit = MAX_RESULTS;
    this.setPlaceholder("Search tasks by title or tag…");
    this.emptyStateText = "No matching tasks";
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "open task" },
      { command: "esc", purpose: "dismiss" },
    ]);
  }

  getSuggestions(query: string): TaskHit[] {
    const q = query.trim();
    if (!q) {
      // No query: most recently modified first, so the dialog opens on what
      // you were just working on.
      return this.hits.slice().sort((a, b) => b.mtime - a.mtime);
    }

    const match = prepareFuzzySearch(q);
    const out: TaskHit[] = [];
    for (const hit of this.hits) {
      const onTitle = match(hit.task.title);
      if (onTitle) {
        out.push({ ...hit, matches: onTitle.matches, viaTitle: true, score: onTitle.score });
        continue;
      }
      // Fall back to tags. A tag hit still surfaces the task, but there's
      // nothing in the title to highlight.
      let best: number | null = null;
      for (const tag of hit.task.tags) {
        const r = match(tag);
        if (r && (best === null || r.score > best)) best = r.score;
      }
      if (best !== null) out.push({ ...hit, matches: null, viaTitle: false, score: best });
    }

    // Title hits always outrank tag-only hits, before scores are compared at
    // all. Fuzzy scores are length-sensitive, so a short exact tag would
    // otherwise beat a longer title that contains the very word you typed —
    // and the two scores aren't comparable anyway, having been measured against
    // different strings. Within a group: best score first, recency breaking
    // ties between titles that score identically.
    out.sort(
      (a, b) =>
        Number(b.viaTitle) - Number(a.viaTitle) ||
        b.score - a.score ||
        b.mtime - a.mtime
    );
    return out;
  }

  renderSuggestion(hit: TaskHit, el: HTMLElement): void {
    const { task } = hit;
    // Same classes as the `/t` dropdown, so both are styled by one rule set.
    el.addClass("filo-suggest-item");

    const main = el.createDiv({ cls: "filo-suggest-main" });
    main.createSpan({
      cls: `filo-suggest-status filo-suggest-status-${task.status}`,
      text: STATUS_ICON[task.status],
    });
    const titleEl = main.createSpan({ cls: "filo-suggest-title" });
    if (hit.matches) renderMatches(titleEl, task.title, hit.matches);
    else titleEl.setText(task.title);

    const meta = el.createDiv({ cls: "filo-suggest-meta" });
    // Parent title, not id: two subtasks across different trees often share a
    // name, and the parent is what tells them apart at a glance.
    const parent = task.parent ? this.titleById.get(task.parent) : undefined;
    if (parent) meta.createSpan({ cls: "filo-suggest-parent", text: `in ${parent}` });
    if (task.due) meta.createSpan({ cls: "filo-suggest-due", text: `due ${task.due}` });
    for (const tag of task.tags) meta.createSpan({ cls: "filo-tag", text: `#${tag}` });
    const rel = relativeTime(hit.mtime);
    if (rel) meta.createSpan({ cls: "filo-suggest-mtime", text: rel });
  }

  onChooseSuggestion(hit: TaskHit): void {
    void this.plugin.openTaskFile(hit.task);
  }
}
