import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
  prepareFuzzySearch,
} from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import { STATUS_ICON } from "../processors/listProcessor";
import { relativeTime, taskMtime } from "../store/mtime";

/**
 * A candidate row: the task plus the mtime of its backing file, which is the
 * sort key. Resolved once per suggestion pass so sorting doesn't re-hit the
 * vault for every comparison.
 */
interface TaskSuggestion {
  task: Task;
  mtime: number;
}

/**
 * Upper bound on how much text may follow the trigger before we give up. Keeps
 * the popover from lingering while ordinary prose is typed after a stray "/t"
 * (an empty result set also closes it, this is the belt-and-braces half).
 */
const MAX_QUERY_LEN = 40;

/**
 * Wikilink aliases are delimited by `|` and `]]`, so a title containing either
 * would break the link. Strip them rather than refusing to insert.
 */
function safeAlias(title: string): string {
  return title.replace(/[|\[\]]/g, "").trim() || "task";
}

/**
 * Inline task-reference autocomplete. Typing the trigger (default `/t`) at a
 * word boundary opens a dropdown of tasks — most recently modified first — and
 * choosing one replaces the trigger text with a link to that task's file,
 * aliased to its title (task filenames are opaque ids, so the alias is what
 * makes the link readable).
 */
export class TaskLinkSuggest extends EditorSuggest<TaskSuggestion> {
  private plugin: FiloPlugin;

  constructor(plugin: FiloPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "insert task link" },
      { command: "esc", purpose: "dismiss" },
    ]);
  }

  /**
   * Fires on every keypress, so it bails as early as possible: the trigger must
   * be present on the line before the cursor and sit at the start of the line or
   * after whitespace (so `notes/tasks` and URLs never open the popover).
   */
  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.plugin.settings.taskLinkSuggest) return null;

    const trigger = this.plugin.settings.taskLinkTrigger || "/t";
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const start = before.lastIndexOf(trigger);
    if (start < 0) return null;
    if (start > 0 && !/\s/.test(before[start - 1])) return null;

    const query = before.slice(start + trigger.length);
    if (query.length > MAX_QUERY_LEN) return null;
    // Inside an existing link Obsidian's own file suggester owns the popover.
    if (/[[\]]/.test(query)) return null;

    return { start: { line: cursor.line, ch: start }, end: cursor, query };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<TaskSuggestion[]> {
    const tasks = await this.plugin.store.listTasks();
    const query = context.query.trim();
    const match = query ? prepareFuzzySearch(query) : null;

    const out: TaskSuggestion[] = [];
    for (const task of tasks) {
      if (this.plugin.settings.taskLinkHideDone && task.status === "done") continue;
      // Match titles and tags, so `/tapi` finds a task tagged #api.
      if (match && !match(task.title) && !task.tags.some((t) => match(t))) continue;
      out.push({ task, mtime: taskMtime(this.app, task) });
    }

    out.sort((a, b) => b.mtime - a.mtime);
    return out.slice(0, Math.max(1, this.plugin.settings.taskLinkMaxResults));
  }

  renderSuggestion(item: TaskSuggestion, el: HTMLElement): void {
    const { task } = item;
    el.addClass("filo-suggest-item");

    const main = el.createDiv({ cls: "filo-suggest-main" });
    main.createSpan({
      cls: `filo-suggest-status filo-suggest-status-${task.status}`,
      text: STATUS_ICON[task.status],
    });
    main.createSpan({ cls: "filo-suggest-title", text: task.title });

    const meta = el.createDiv({ cls: "filo-suggest-meta" });
    if (task.due) meta.createSpan({ cls: "filo-suggest-due", text: `due ${task.due}` });
    for (const tag of task.tags) {
      meta.createSpan({ cls: "filo-tag", text: `#${tag}` });
    }
    const rel = relativeTime(item.mtime);
    if (rel) meta.createSpan({ cls: "filo-suggest-mtime", text: rel });
  }

  selectSuggestion(item: TaskSuggestion, _evt: MouseEvent | KeyboardEvent): void {
    const ctx = this.context;
    if (!ctx) return;

    const link = this.linkFor(item.task, ctx.file?.path ?? "");
    ctx.editor.replaceRange(link, ctx.start, ctx.end);
    ctx.editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + link.length });
    this.close();
  }

  /**
   * Build the inserted link. generateMarkdownLink is preferred because it honors
   * the vault's link settings (wikilink vs markdown, shortest-path vs absolute);
   * the hand-built wikilink is a fallback for a task whose file has vanished.
   */
  private linkFor(task: Task, sourcePath: string): string {
    const alias = safeAlias(task.title);
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (f instanceof TFile) {
      return this.app.fileManager.generateMarkdownLink(f, sourcePath, undefined, alias);
    }
    return `[[${task.path.replace(/\.md$/, "")}|${alias}]]`;
  }
}
