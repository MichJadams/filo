/*
Filo - file-based todos for Obsidian.
This is a generated bundle. Source lives in src/. Do not edit directly.
*/
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FiloPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian13 = require("obsidian");

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  tasksFolder: "tasks",
  canvasFolder: "",
  timerCapHours: 12,
  rednessMode: "relative",
  processRecurringOnLoad: true,
  taskLinkSuggest: true,
  taskLinkTrigger: "/t",
  taskLinkMaxResults: 20,
  taskLinkHideDone: false,
  parentBanner: true
};
var FiloSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Tasks folder").setDesc("Vault-relative folder where task files live.").addText(
      (t) => t.setPlaceholder("tasks").setValue(this.plugin.settings.tasksFolder).onChange(async (v) => {
        this.plugin.settings.tasksFolder = v.trim() || "tasks";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Canvas output folder").setDesc("Folder for generated .canvas files. Leave empty for the vault root.").addText(
      (t) => t.setPlaceholder("(vault root)").setValue(this.plugin.settings.canvasFolder).onChange(async (v) => {
        this.plugin.settings.canvasFolder = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Timer max duration (hours)").setDesc(
      "A running session longer than this is flagged and its time is capped, rather than counted silently."
    ).addText(
      (t) => t.setPlaceholder("12").setValue(String(this.plugin.settings.timerCapHours)).onChange(async (v) => {
        const n = Number(v);
        if (!isNaN(n) && n > 0) {
          this.plugin.settings.timerCapHours = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Redness mode").setDesc(
      "How tracked time maps to canvas node color. Relative normalizes to the longest task in the subtree."
    ).addDropdown(
      (d) => d.addOption("relative", "Relative to subtree").addOption("absolute", "Absolute thresholds").setValue(this.plugin.settings.rednessMode).onChange(async (v) => {
        this.plugin.settings.rednessMode = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Process recurring tasks on load").setDesc(
      'Automatically reset due recurring tasks when the plugin loads. You can also run it any time via the "Load tasks" command.'
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.processRecurringOnLoad).onChange(async (v) => {
        this.plugin.settings.processRecurringOnLoad = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Task references").setHeading();
    new import_obsidian.Setting(containerEl).setName("Inline task autocomplete").setDesc(
      "Type the trigger anywhere in a note to pick a task from a dropdown and insert a link to it."
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.taskLinkSuggest).onChange(async (v) => {
        this.plugin.settings.taskLinkSuggest = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Trigger text").setDesc("Opens the dropdown when typed at the start of a line or after a space.").addText(
      (t) => t.setPlaceholder("/t").setValue(this.plugin.settings.taskLinkTrigger).onChange(async (v) => {
        this.plugin.settings.taskLinkTrigger = v.trim() || "/t";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Dropdown results").setDesc("How many tasks to show, taking the most recently modified first.").addText(
      (t) => t.setPlaceholder("20").setValue(String(this.plugin.settings.taskLinkMaxResults)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 1) {
          this.plugin.settings.taskLinkMaxResults = Math.floor(n);
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Hide completed tasks").setDesc("Omit done tasks from the dropdown.").addToggle(
      (t) => t.setValue(this.plugin.settings.taskLinkHideDone).onChange(async (v) => {
        this.plugin.settings.taskLinkHideDone = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Parent banner on task notes").setDesc(
      "Show the parent task's title at the top of a task note, and click it to pick a new parent by title. Obsidian's own properties editor can only show the raw parent id."
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.parentBanner).onChange(async (v) => {
        this.plugin.settings.parentBanner = v;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/store/TaskStore.ts
var import_obsidian2 = require("obsidian");

// src/store/id.ts
function generateTaskId() {
  const a = Math.random().toString(36).slice(2, 8);
  const b = Math.random().toString(36).slice(2, 4);
  return `t-${a}${b}`;
}

// src/store/timeBlock.ts
var TIME_FENCE = /```(?:t-time|timekeeper)(?![\w-])[^\n]*\n([\s\S]*?)```/;
function parseSessions(content) {
  const m = content.match(TIME_FENCE);
  if (!m)
    return [];
  const sessions = [];
  let current = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line)
      continue;
    const ci = line.indexOf(":");
    if (ci === -1)
      continue;
    const key = line.slice(0, ci).trim().toLowerCase();
    const val = line.slice(ci + 1).trim();
    if (key === "start") {
      if (current)
        sessions.push(current);
      current = { start: val, stop: null };
    } else if (key === "stop") {
      if (current) {
        current.stop = val.toLowerCase() === "running" || val === "" ? null : val;
        sessions.push(current);
        current = null;
      }
    }
  }
  if (current)
    sessions.push(current);
  return sessions;
}
function serializeSessions(sessions) {
  return sessions.map((s) => {
    var _a;
    return `start: ${s.start}
stop: ${(_a = s.stop) != null ? _a : "running"}`;
  }).join("\n");
}
function writeSessions(content, sessions) {
  const inner = sessions.length ? serializeSessions(sessions) + "\n" : "";
  const block = "```t-time\n" + inner + "```";
  if (TIME_FENCE.test(content)) {
    return content.replace(TIME_FENCE, block);
  }
  return content.replace(/\s*$/, "") + "\n\n" + block + "\n";
}
function computeTotal(sessions, capMs, nowMs = Date.now()) {
  let ms = 0;
  let flagged = false;
  let running = false;
  for (const s of sessions) {
    const start = Date.parse(s.start);
    if (isNaN(start))
      continue;
    if (s.stop === null) {
      running = true;
      const elapsed = nowMs - start;
      if (elapsed > capMs) {
        flagged = true;
        ms += capMs;
      } else {
        ms += Math.max(0, elapsed);
      }
    } else {
      const stop = Date.parse(s.stop);
      if (!isNaN(stop))
        ms += Math.max(0, stop - start);
    }
  }
  return { ms, flagged, running };
}
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1e3);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  const s = totalSec % 60;
  if (h > 0)
    return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0)
    return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

// src/store/recurrence.ts
function parseField(field, min, max) {
  if (field === "*")
    return { star: true, values: /* @__PURE__ */ new Set() };
  const values = /* @__PURE__ */ new Set();
  for (const part of field.split(",")) {
    let step = 1;
    let range = part;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      step = parseInt(part.slice(slash + 1), 10);
      range = part.slice(0, slash);
    }
    let lo;
    let hi;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = parseInt(a, 10);
      hi = parseInt(b, 10);
    } else {
      lo = hi = parseInt(range, 10);
    }
    if (isNaN(lo) || isNaN(hi) || isNaN(step) || step < 1 || lo < min || hi > max) {
      return null;
    }
    for (let v = lo; v <= hi; v += step)
      values.add(v);
  }
  return { star: false, values };
}
function parseCron(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5)
    return null;
  const minute = parseField(f[0], 0, 59);
  const hour = parseField(f[1], 0, 23);
  const dom = parseField(f[2], 1, 31);
  const month = parseField(f[3], 1, 12);
  const dow = parseField(f[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow)
    return null;
  if (!dow.star && dow.values.has(7))
    dow.values.add(0);
  return { minute, hour, dom, month, dow };
}
function fieldMatch(f, v) {
  return f.star || f.values.has(v);
}
function cronMatches(p, date) {
  if (!fieldMatch(p.minute, date.getMinutes()))
    return false;
  if (!fieldMatch(p.hour, date.getHours()))
    return false;
  if (!fieldMatch(p.month, date.getMonth() + 1))
    return false;
  const domOk = fieldMatch(p.dom, date.getDate());
  const dowOk = fieldMatch(p.dow, date.getDay());
  if (!p.dom.star && !p.dow.star)
    return domOk || dowOk;
  return domOk && dowOk;
}
var SCAN_MINUTE_CAP = 366 * 2 * 24 * 60;
function lastFireBetween(cron, afterMs, nowMs) {
  const parsed = parseCron(cron);
  if (!parsed)
    return null;
  let t = Math.floor(nowMs / 6e4) * 6e4;
  let i = 0;
  while (t > afterMs && i < SCAN_MINUTE_CAP) {
    if (cronMatches(parsed, new Date(t)))
      return t;
    t -= 6e4;
    i++;
  }
  return null;
}
var CADENCE_PRESETS = [
  { key: "daily", label: "Daily (midnight)", cron: "0 0 * * *" },
  { key: "weekdays", label: "Weekdays (Mon\u2013Fri)", cron: "0 0 * * 1-5" },
  { key: "weekly", label: "Weekly (Monday)", cron: "0 0 * * 1" },
  { key: "monthly", label: "Monthly (1st)", cron: "0 0 1 * *" }
];
var LOG_MARKER = "<!-- filo-log -->";
function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function logSectionTemplate() {
  return `## Recurrence log

${LOG_MARKER}

| Date | Status |
| --- | --- |
`;
}
function appendLogEntry(content, date, status) {
  const row = `| ${date} | ${status} |`;
  const lines = content.split("\n");
  const markerIdx = lines.findIndex((l) => l.trim() === LOG_MARKER);
  if (markerIdx === -1) {
    const base = content.replace(/\s*$/, "");
    return base + "\n\n" + logSectionTemplate() + row + "\n";
  }
  let lastTableLine = -1;
  for (let i = markerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "") {
      if (lastTableLine !== -1)
        break;
      continue;
    }
    if (t.startsWith("|")) {
      lastTableLine = i;
      continue;
    }
    break;
  }
  if (lastTableLine === -1) {
    lines.splice(markerIdx + 1, 0, "", "| Date | Status |", "| --- | --- |", row);
  } else {
    lines.splice(lastTableLine + 1, 0, row);
  }
  return lines.join("\n");
}

// src/store/TaskStore.ts
var FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
var STATUSES = ["undone", "in-progress", "done"];
function headingLine(title) {
  const flat = (title != null ? title : "").replace(/\s+/g, " ").trim();
  return flat || "Untitled";
}
var TaskStore = class {
  constructor(app, data) {
    /**
     * Cached full scan of the tasks folder. `parent` is the only stored
     * relationship, so children/subtrees are derived from this list at read
     * time. The cache is dropped (set to null) whenever a file in the tasks
     * folder changes; the next read re-scans lazily.
     */
    this.cache = null;
    /** Re-render subscribers (list/add widgets). */
    this.subscribers = /* @__PURE__ */ new Set();
    this.app = app;
    this.data = data;
  }
  // --- change notification -------------------------------------------------
  /** Subscribe to store changes; returns an unsubscribe function. */
  subscribe(cb) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
  notify() {
    this.subscribers.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error("[Filo] subscriber error", e);
      }
    });
  }
  /**
   * Invalidate the cache and re-render. Only fires when the changed path is
   * inside the tasks folder — vault events elsewhere are ignored so unrelated
   * edits never trigger a rescan.
   */
  handleVaultChange(path) {
    const folder = this.folder();
    if (path === folder || path.startsWith(folder + "/")) {
      this.invalidate();
    }
  }
  /** Force a rescan on next read and notify subscribers. */
  invalidate() {
    this.cache = null;
    this.notify();
  }
  // --- folder helpers ------------------------------------------------------
  folder() {
    return (0, import_obsidian2.normalizePath)(this.data.getTasksFolder() || "tasks");
  }
  async ensureFolder(path) {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path).catch(() => {
      });
    }
  }
  // --- reading -------------------------------------------------------------
  coerceDate(v) {
    if (v == null || v === "")
      return null;
    if (v instanceof Date)
      return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }
  coerceIso(v) {
    if (v == null)
      return "";
    if (v instanceof Date)
      return v.toISOString();
    return String(v);
  }
  normalizeStatus(v) {
    const s = String(v);
    return STATUSES.includes(s) ? s : "undone";
  }
  coerceBool(v) {
    return v === true || v === "true";
  }
  /**
   * Priority as a finite number, defaulting to 0. Tasks predating the field (or
   * carrying a non-numeric value) read as 0 rather than NaN, so sorting stays
   * well-defined without having to rewrite existing task files.
   */
  coercePriority(v) {
    if (v == null || v === "")
      return 0;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : 0;
  }
  /** Parse a file's full content into a Task. */
  parseFile(file, content) {
    var _a;
    const m = content.match(FM_RE);
    let fm = {};
    if (m) {
      try {
        fm = (_a = (0, import_obsidian2.parseYaml)(m[1])) != null ? _a : {};
      } catch (e) {
        fm = {};
      }
    }
    const rawTags = fm.tags;
    const tags = Array.isArray(rawTags) ? rawTags.map((t) => String(t)) : rawTags != null && rawTags !== "" ? [String(rawTags)] : [];
    return {
      id: fm.id ? String(fm.id) : file.basename,
      title: fm.title != null ? String(fm.title) : file.basename,
      status: this.normalizeStatus(fm.status),
      parent: fm.parent != null && fm.parent !== "" ? String(fm.parent) : null,
      due: this.coerceDate(fm.due),
      tags,
      priority: this.coercePriority(fm.priority),
      created: this.coerceIso(fm.created),
      sessions: parseSessions(content),
      path: file.path,
      recurring: this.coerceBool(fm.recurring),
      cadence: fm.cadence != null && fm.cadence !== "" ? String(fm.cadence) : null,
      lastReset: fm.lastReset != null && fm.lastReset !== "" ? this.coerceIso(fm.lastReset) : null
    };
  }
  /** All tasks in the folder (cached). */
  async listTasks() {
    if (this.cache)
      return this.cache;
    const folder = this.folder();
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/"));
    const tasks = [];
    for (const f of files) {
      const content = await this.app.vault.cachedRead(f);
      const task = this.parseFile(f, content);
      if (content.includes("id:"))
        tasks.push(task);
    }
    this.cache = tasks;
    return tasks;
  }
  async getTask(id) {
    var _a;
    return (_a = (await this.listTasks()).find((t) => t.id === id)) != null ? _a : null;
  }
  /** Resolve the backing TFile for a task id (via cached path). */
  async fileForId(id) {
    const task = await this.getTask(id);
    if (!task)
      return null;
    const f = this.app.vault.getAbstractFileByPath(task.path);
    return f instanceof import_obsidian2.TFile ? f : null;
  }
  // --- writing -------------------------------------------------------------
  async createTask(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    const folder = this.folder();
    await this.ensureFolder(folder);
    const id = generateTaskId();
    const created = new Date().toISOString();
    const priority = this.coercePriority(input.priority);
    const fm = {
      id,
      title: input.title,
      status: (_a = input.status) != null ? _a : "undone",
      parent: (_b = input.parent) != null ? _b : null,
      due: (_c = input.due) != null ? _c : null,
      tags: (_d = input.tags) != null ? _d : [],
      priority,
      created
    };
    if (input.recurring) {
      fm.recurring = true;
      fm.cadence = (_e = input.cadence) != null ? _e : "0 0 * * *";
      fm.lastReset = created;
    }
    const body = ((_f = input.body) != null ? _f : "").trim();
    const heading = headingLine(input.title);
    const content = `---
${(0, import_obsidian2.stringifyYaml)(fm)}---

# ${heading}

` + (body ? body + "\n\n" : "") + "```t-time\n```\n" + (input.recurring ? "\n" + logSectionTemplate() : "");
    const path = `${folder}/${id}.md`;
    await this.app.vault.create(path, content);
    this.invalidate();
    return {
      id,
      title: input.title,
      status: (_g = input.status) != null ? _g : "undone",
      parent: (_h = input.parent) != null ? _h : null,
      due: (_i = input.due) != null ? _i : null,
      tags: (_j = input.tags) != null ? _j : [],
      priority,
      created,
      sessions: [],
      path,
      recurring: !!input.recurring,
      cadence: input.recurring ? (_k = input.cadence) != null ? _k : "0 0 * * *" : null,
      lastReset: input.recurring ? created : null
    };
  }
  /**
   * Update frontmatter fields via processFrontMatter (which mutates only the
   * YAML and preserves the body, rather than naive string replacement).
   */
  async updateTask(id, patch) {
    const file = await this.fileForId(id);
    if (!file)
      throw new Error(`[Filo] task not found: ${id}`);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (patch.title !== void 0)
        fm.title = patch.title;
      if (patch.status !== void 0)
        fm.status = patch.status;
      if (patch.parent !== void 0)
        fm.parent = patch.parent;
      if (patch.due !== void 0)
        fm.due = patch.due;
      if (patch.tags !== void 0)
        fm.tags = patch.tags;
      if (patch.priority !== void 0)
        fm.priority = patch.priority;
      if (patch.recurring !== void 0)
        fm.recurring = patch.recurring;
      if (patch.cadence !== void 0)
        fm.cadence = patch.cadence;
      if (patch.lastReset !== void 0)
        fm.lastReset = patch.lastReset;
    });
    this.invalidate();
  }
  async setStatus(id, status) {
    await this.updateTask(id, { status });
  }
  /** Set a task's priority. Non-finite input is rejected rather than written. */
  async setPriority(id, priority) {
    if (!Number.isFinite(priority))
      return;
    await this.updateTask(id, { priority });
  }
  // --- recurrence ----------------------------------------------------------
  /**
   * Scan all recurring tasks and reset any whose cadence boundary has elapsed
   * since their `lastReset`. For each reset, the status held at the boundary is
   * appended to the task's recurrence-log table, the status is flipped back to
   * `undone`, and `lastReset` is advanced to the boundary. Returns the number
   * of tasks reset (used for the "load tasks" notice).
   *
   * Only the most recent missed boundary is logged per run; if several periods
   * elapsed between runs, intermediate ones are not back-filled.
   */
  async processRecurring(now = Date.now()) {
    var _a;
    const tasks = await this.listTasks();
    let count = 0;
    for (const t of tasks) {
      if (!t.recurring || !t.cadence)
        continue;
      const afterRaw = Date.parse((_a = t.lastReset) != null ? _a : t.created);
      const afterMs = isNaN(afterRaw) ? 0 : afterRaw;
      const fireMs = lastFireBetween(t.cadence, afterMs, now);
      if (fireMs == null)
        continue;
      const file = await this.fileForId(t.id);
      if (!file)
        continue;
      const statusAtBoundary = t.status;
      const dateStr = localDate(new Date(fireMs));
      await this.app.vault.process(
        file,
        (content) => appendLogEntry(content, dateStr, statusAtBoundary)
      );
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.status = "undone";
        fm.lastReset = new Date(fireMs).toISOString();
      });
      count++;
    }
    if (count)
      this.invalidate();
    return count;
  }
  // --- tree ----------------------------------------------------------------
  async getChildren(id) {
    return (await this.listTasks()).filter((t) => t.parent === id);
  }
  /**
   * Flatten the subtree rooted at `rootId` (depth-first), annotating each node
   * with its depth. A `visited` set guards against accidental parent cycles.
   */
  async getSubtree(rootId) {
    var _a;
    const all = await this.listTasks();
    const root = all.find((t) => t.id === rootId);
    if (!root)
      return [];
    const byParent = /* @__PURE__ */ new Map();
    for (const t of all) {
      const arr = (_a = byParent.get(t.parent)) != null ? _a : [];
      arr.push(t);
      byParent.set(t.parent, arr);
    }
    const out = [];
    const visited = /* @__PURE__ */ new Set();
    const walk = (task, depth) => {
      var _a2;
      if (visited.has(task.id))
        return;
      visited.add(task.id);
      out.push({ task, depth });
      for (const child of (_a2 = byParent.get(task.id)) != null ? _a2 : [])
        walk(child, depth + 1);
    };
    walk(root, 0);
    return out;
  }
  // --- timers --------------------------------------------------------------
  /**
   * Start the timer for `id`. Enforces a single global active timer by first
   * stopping whichever task is currently active. The active id is persisted by
   * the plugin so it survives reloads.
   */
  async startTimer(id) {
    const active = this.data.getActiveTaskId();
    if (active && active !== id)
      await this.stopTimer(active);
    const file = await this.fileForId(id);
    if (!file)
      throw new Error(`[Filo] task not found: ${id}`);
    const now = new Date().toISOString();
    await this.app.vault.process(file, (content) => {
      const sessions = parseSessions(content);
      if (!sessions.some((s) => s.stop === null)) {
        sessions.push({ start: now, stop: null });
      }
      return writeSessions(content, sessions);
    });
    await this.data.setActiveTaskId(id);
    this.invalidate();
  }
  /** Stop the timer for `id` by closing its open session with the current time. */
  async stopTimer(id) {
    const file = await this.fileForId(id);
    if (!file)
      return;
    const now = new Date().toISOString();
    await this.app.vault.process(file, (content) => {
      const sessions = parseSessions(content);
      for (let i = sessions.length - 1; i >= 0; i--) {
        if (sessions[i].stop === null) {
          sessions[i].stop = now;
          break;
        }
      }
      return writeSessions(content, sessions);
    });
    if (this.data.getActiveTaskId() === id)
      await this.data.setActiveTaskId(null);
    this.invalidate();
  }
  /** Total tracked milliseconds for a task (running session capped per settings). */
  async totalTime(id) {
    const task = await this.getTask(id);
    if (!task)
      return 0;
    return computeTotal(task.sessions, this.data.getTimerCapMs()).ms;
  }
};

// src/processors/addProcessor.ts
var import_obsidian3 = require("obsidian");
var AddWidget = class extends import_obsidian3.MarkdownRenderChild {
  constructor(plugin, containerEl, sourcePath) {
    super(containerEl);
    this.parentSelect = null;
    /** Task id of the containing file, if that file is itself a task. */
    this.containingTaskId = null;
    /** Once the user picks a parent manually, stop auto-defaulting. */
    this.userPickedParent = false;
    /** Monotonic token; guards against interleaved async option rebuilds. */
    this.refreshSeq = 0;
    this.plugin = plugin;
    this.sourcePath = sourcePath;
  }
  onload() {
    this.build();
    this.register(this.plugin.store.subscribe(() => this.refreshParents()));
  }
  build() {
    const el = this.containerEl;
    el.empty();
    el.addClass("filo-add");
    const titleInput = el.createEl("input", {
      type: "text",
      cls: "filo-add-title",
      attr: { placeholder: "Task title" }
    });
    const row = el.createDiv({ cls: "filo-add-row" });
    const dueInput = row.createEl("input", { type: "date", cls: "filo-add-due" });
    const tagsInput = row.createEl("input", {
      type: "text",
      cls: "filo-add-tags",
      attr: { placeholder: "tags, comma, separated" }
    });
    this.parentSelect = row.createEl("select", { cls: "filo-add-parent" });
    this.parentSelect.addEventListener("change", () => {
      this.userPickedParent = true;
    });
    void this.refreshParents();
    const recurRow = el.createDiv({ cls: "filo-add-row filo-add-recur" });
    const recurLabel = recurRow.createEl("label", { cls: "filo-add-recur-label" });
    const recurCheck = recurLabel.createEl("input", { type: "checkbox" });
    recurLabel.appendText(" \u27F3 recurring");
    const cadenceSelect = recurRow.createEl("select", { cls: "filo-add-cadence" });
    for (const p of CADENCE_PRESETS)
      cadenceSelect.createEl("option", { text: p.label, value: p.key });
    cadenceSelect.createEl("option", { text: "Custom (cron)", value: "custom" });
    const customInput = recurRow.createEl("input", {
      type: "text",
      cls: "filo-add-cron",
      attr: { placeholder: "0 0 * * *" }
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
      var _a, _b, _c;
      const title = titleInput.value.trim();
      if (!title) {
        new import_obsidian3.Notice("Filo: title required");
        return;
      }
      const tags = tagsInput.value.split(",").map((s) => s.trim()).filter(Boolean);
      const parent = ((_a = this.parentSelect) == null ? void 0 : _a.value) || null;
      const due = dueInput.value || null;
      const recurring = recurCheck.checked;
      let cadence = null;
      if (recurring) {
        cadence = cadenceSelect.value === "custom" ? customInput.value.trim() : (_c = (_b = CADENCE_PRESETS.find((p) => p.key === cadenceSelect.value)) == null ? void 0 : _b.cron) != null ? _c : null;
        if (!cadence || !parseCron(cadence)) {
          new import_obsidian3.Notice("Filo: invalid cron cadence");
          return;
        }
      }
      await this.plugin.createTask({ title, due, tags, parent, recurring, cadence });
      titleInput.value = "";
      tagsInput.value = "";
      dueInput.value = "";
      recurCheck.checked = false;
      customInput.value = "";
      syncRecurUI();
      this.userPickedParent = false;
      void this.refreshParents();
      new import_obsidian3.Notice(`Filo: created "${title}"`);
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
  async refreshParents() {
    var _a, _b;
    const sel = this.parentSelect;
    if (!sel)
      return;
    const seq = ++this.refreshSeq;
    const tasks = await this.plugin.store.listTasks();
    if (seq !== this.refreshSeq)
      return;
    this.containingTaskId = (_b = (_a = tasks.find((t) => t.path === this.sourcePath)) == null ? void 0 : _a.id) != null ? _b : null;
    const previous = sel.value;
    sel.empty();
    sel.createEl("option", { text: "(no parent)", value: "" });
    for (const t of tasks.slice().sort((a, b) => a.title.localeCompare(b.title))) {
      const label = t.id === this.containingTaskId ? `${t.title} (this task)` : t.title;
      sel.createEl("option", { text: label, value: t.id });
    }
    if (!this.userPickedParent && this.containingTaskId) {
      sel.value = this.containingTaskId;
    } else {
      sel.value = previous;
    }
  }
};

// src/processors/listProcessor.ts
var import_obsidian4 = require("obsidian");

// src/dsl/filter.ts
var STATUSES2 = ["undone", "in-progress", "done"];
var SORT_FIELDS = ["due", "created", "title", "time", "priority"];
function parseQuery(source) {
  const q = { errors: [] };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#"))
      continue;
    const ci = line.indexOf(":");
    if (ci === -1) {
      q.errors.push(`ignored (no ':'): ${line}`);
      continue;
    }
    const key = line.slice(0, ci).trim().toLowerCase();
    const val = line.slice(ci + 1).trim();
    switch (key) {
      case "status": {
        let rest = val;
        let not = false;
        if (rest.startsWith("!")) {
          not = true;
          rest = rest.slice(1).trim();
        }
        const parts = rest.split(",").map((s) => s.trim()).filter(Boolean);
        const bad = parts.filter((p) => !STATUSES2.includes(p));
        if (!parts.length)
          q.errors.push(`bad status: ${val}`);
        else if (bad.length)
          q.errors.push(`bad status: ${bad.join(", ")}`);
        else
          q.status = { not, values: parts };
        break;
      }
      case "due": {
        if (val.toLowerCase() === "overdue") {
          q.due = { kind: "overdue" };
        } else {
          const op = val[0];
          if (op === "<" || op === ">" || op === "=") {
            q.due = { kind: "cmp", op, date: val.slice(1).trim() };
          } else {
            q.due = { kind: "cmp", op: "=", date: val };
          }
        }
        break;
      }
      case "tags":
        q.tags = val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        break;
      case "sort": {
        const [field, dir] = val.split(/\s+/);
        if (SORT_FIELDS.includes(field)) {
          q.sort = { field, dir: dir === "desc" ? "desc" : "asc" };
        } else {
          q.errors.push(`bad sort field: ${field}`);
        }
        break;
      }
      case "group": {
        const g = val.toLowerCase();
        if (g === "parent")
          q.group = "parent";
        else if (g === "none" || g === "flat")
          q.group = "none";
        else
          q.errors.push(`only 'group: parent' or 'group: none' is supported`);
        break;
      }
      default:
        q.errors.push(`unknown key: ${key}`);
    }
  }
  return q;
}
function applyQuery(tasks, q, ctx) {
  let out = tasks.filter((t) => {
    if (q.status) {
      const inSet = q.status.values.includes(t.status);
      if (q.status.not ? inSet : !inSet)
        return false;
    }
    if (q.tags && q.tags.length) {
      const lower = t.tags.map((x) => x.toLowerCase());
      if (!q.tags.some((tag) => lower.includes(tag)))
        return false;
    }
    if (q.due) {
      if (q.due.kind === "overdue") {
        if (!(t.due && t.due < ctx.today && t.status !== "done"))
          return false;
      } else {
        if (!t.due)
          return false;
        const cmp = t.due.localeCompare(q.due.date);
        if (q.due.op === "<" && !(cmp < 0))
          return false;
        if (q.due.op === ">" && !(cmp > 0))
          return false;
        if (q.due.op === "=" && cmp !== 0)
          return false;
      }
    }
    return true;
  });
  if (q.sort) {
    const { field, dir } = q.sort;
    const mul = dir === "desc" ? -1 : 1;
    out = out.slice().sort((a, b) => {
      let r = 0;
      switch (field) {
        case "title":
          r = a.title.localeCompare(b.title);
          break;
        case "created":
          r = (a.created || "").localeCompare(b.created || "");
          break;
        case "time":
          r = ctx.totalTime(a) - ctx.totalTime(b);
          break;
        case "priority":
          r = a.priority - b.priority;
          break;
        case "due":
          if (!a.due && !b.due)
            r = 0;
          else if (!a.due)
            return 1;
          else if (!b.due)
            return -1;
          else
            r = a.due.localeCompare(b.due);
          break;
      }
      return r * mul;
    });
  }
  return out;
}

// src/processors/listProcessor.ts
var STATUS_ICON = {
  undone: "\u25CB",
  "in-progress": "\u25D0",
  done: "\u25CF"
};
var NEXT_STATUS = {
  undone: "in-progress",
  "in-progress": "done",
  done: "undone"
};
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
var ListWidget = class extends import_obsidian4.MarkdownRenderChild {
  constructor(plugin, containerEl, source) {
    super(containerEl);
    /** time cell element per task id, so the tick can update them in place. */
    this.timeEls = /* @__PURE__ */ new Map();
    /** tasks currently running, recomputed each render. */
    this.runningTasks = [];
    /** Monotonic render token; guards against interleaved async renders. */
    this.renderSeq = 0;
    this.plugin = plugin;
    this.query = parseQuery(source);
  }
  onload() {
    this.register(this.plugin.store.subscribe(() => void this.render()));
    this.registerInterval(window.setInterval(() => this.tick(), 1e3));
    void this.render();
  }
  /** Live-update only the running rows; full data is untouched. */
  tick() {
    if (!this.runningTasks.length)
      return;
    const cap = this.plugin.getTimerCapMs();
    const now = Date.now();
    for (const t of this.runningTasks) {
      const el = this.timeEls.get(t.id);
      if (!el)
        continue;
      const { ms, flagged } = computeTotal(t.sessions, cap, now);
      el.setText(formatDuration(ms));
      el.toggleClass("filo-flagged", flagged);
    }
  }
  async render() {
    var _a, _b;
    const seq = ++this.renderSeq;
    const cap = this.plugin.getTimerCapMs();
    const today = todayStr();
    const all = await this.plugin.store.listTasks();
    if (seq !== this.renderSeq)
      return;
    const tasks = applyQuery(all, this.query, {
      totalTime: (t) => computeTotal(t.sessions, cap).ms,
      today
    });
    const el = this.containerEl;
    el.empty();
    el.addClass("filo-list");
    this.timeEls.clear();
    this.runningTasks = [];
    this.renderToolbar(el);
    if (this.query.errors.length) {
      el.createEl("div", {
        cls: "filo-error",
        text: "Query problems: " + this.query.errors.join("; ")
      });
    }
    if (!tasks.length) {
      el.createEl("div", { cls: "filo-empty", text: "No matching tasks." });
      return;
    }
    if (this.query.group === "parent") {
      const titleById = new Map(all.map((t) => [t.id, t.title]));
      const groups = /* @__PURE__ */ new Map();
      for (const t of tasks) {
        const arr = (_a = groups.get(t.parent)) != null ? _a : [];
        arr.push(t);
        groups.set(t.parent, arr);
      }
      for (const [pid, group] of groups) {
        const header = pid ? (_b = titleById.get(pid)) != null ? _b : pid : "(no parent)";
        el.createEl("div", { cls: "filo-group-header", text: header });
        const rows = el.createDiv({ cls: "filo-rows" });
        for (const t of group)
          this.renderRow(rows, t, cap, today);
      }
    } else if (this.query.group === "none") {
      const rows = el.createDiv({ cls: "filo-rows" });
      for (const t of tasks)
        this.renderRow(rows, t, cap, today);
    } else {
      const rows = el.createDiv({ cls: "filo-rows" });
      this.renderTree(rows, tasks, cap, today);
    }
  }
  /**
   * Block toolbar. Runs the same recurrence pass as the "Load tasks" command,
   * which is otherwise only triggered at plugin load — so a long-running
   * Obsidian session never resets a due recurring task on its own.
   */
  renderToolbar(container) {
    const bar = container.createDiv({ cls: "filo-toolbar" });
    const btn = bar.createEl("button", {
      cls: "filo-load-tasks",
      text: "\u27F3 Load tasks",
      attr: { "aria-label": "Process recurring tasks now" }
    });
    btn.addEventListener("click", () => {
      btn.disabled = true;
      void this.plugin.runProcessRecurring(true).finally(() => {
        if (btn.isConnected)
          btn.disabled = false;
      });
    });
  }
  /**
   * Render the matched tasks as a nested tree: children sit (indented) beneath
   * their parent. Sibling order follows the filtered/sorted order. A matched
   * task whose parent is NOT in the result set becomes a top-level root, so
   * filtered-out parents don't hide their matching children.
   */
  renderTree(container, matched, cap, today) {
    var _a, _b;
    const inSet = new Set(matched.map((t) => t.id));
    const childrenByParent = /* @__PURE__ */ new Map();
    for (const t of matched) {
      const parent = t.parent && inSet.has(t.parent) ? t.parent : null;
      const arr = (_a = childrenByParent.get(parent)) != null ? _a : [];
      arr.push(t);
      childrenByParent.set(parent, arr);
    }
    const visited = /* @__PURE__ */ new Set();
    const walk = (task, depth) => {
      var _a2;
      if (visited.has(task.id))
        return;
      visited.add(task.id);
      this.renderRow(container, task, cap, today, depth);
      for (const child of (_a2 = childrenByParent.get(task.id)) != null ? _a2 : [])
        walk(child, depth + 1);
    };
    for (const root of (_b = childrenByParent.get(null)) != null ? _b : [])
      walk(root, 0);
  }
  renderRow(container, task, cap, today, depth = 0) {
    var _a, _b;
    const { ms, flagged, running } = computeTotal(task.sessions, cap);
    const row = container.createDiv({ cls: "filo-row" });
    if (depth > 0)
      row.style.paddingLeft = `${4 + depth * 20}px`;
    const statusBtn = row.createEl("button", {
      cls: `filo-status filo-status-${task.status}`,
      text: STATUS_ICON[task.status],
      attr: { "aria-label": `Status: ${task.status}` }
    });
    statusBtn.addEventListener("click", () => {
      void this.plugin.store.setStatus(task.id, NEXT_STATUS[task.status]);
    });
    const childBtn = row.createEl("button", {
      cls: "filo-add-child",
      text: "\uFF0B",
      attr: { "aria-label": `Add child task to "${task.title}"` }
    });
    const titleEl = row.createDiv({ cls: "filo-title" });
    if (task.recurring) {
      titleEl.createSpan({
        cls: "filo-recurring",
        text: "\u27F3 ",
        attr: { "aria-label": `Recurring: ${(_a = task.cadence) != null ? _a : ""}` }
      });
    }
    titleEl.createSpan({ text: task.title });
    titleEl.addEventListener("click", () => {
      const f = this.plugin.app.vault.getAbstractFileByPath(task.path);
      if (f instanceof import_obsidian4.TFile)
        void this.plugin.app.workspace.getLeaf(false).openFile(f);
    });
    const prioEl = row.createEl("input", {
      type: "number",
      cls: "filo-priority",
      attr: {
        step: "1",
        title: "Priority",
        "aria-label": `Priority of "${task.title}": ${task.priority}`
      }
    });
    let committed = task.priority;
    prioEl.value = String(committed);
    const commitPriority = () => {
      const raw = prioEl.value.trim();
      const next = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(next) || next === committed) {
        prioEl.value = String(committed);
        return;
      }
      committed = next;
      void this.plugin.store.setPriority(task.id, next);
    };
    prioEl.addEventListener("change", commitPriority);
    prioEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitPriority();
      } else if (e.key === "Escape") {
        prioEl.value = String(committed);
        prioEl.blur();
      }
    });
    const overdue = !!task.due && task.due < today && task.status !== "done";
    row.createDiv({
      cls: "filo-due" + (overdue ? " filo-overdue" : ""),
      text: (_b = task.due) != null ? _b : ""
    });
    const tagsEl = row.createDiv({ cls: "filo-tags" });
    for (const tag of task.tags)
      tagsEl.createEl("span", { cls: "filo-tag", text: tag });
    const timeEl = row.createDiv({
      cls: "filo-time" + (flagged ? " filo-flagged" : ""),
      text: formatDuration(ms)
    });
    this.timeEls.set(task.id, timeEl);
    if (running)
      this.runningTasks.push(task);
    const timerBtn = row.createEl("button", {
      cls: "filo-timer" + (running ? " filo-running" : ""),
      text: running ? "\u23F9 Stop" : "\u25B6 Start"
    });
    timerBtn.addEventListener("click", () => {
      if (running)
        void this.plugin.store.stopTimer(task.id);
      else
        void this.plugin.store.startTimer(task.id);
    });
    this.renderChildForm(container, task, childBtn);
    if (flagged) {
      console.warn(
        `[Filo] Task "${task.title}" (${task.id}) has a running session exceeding the ${this.plugin.settings.timerCapHours}h cap. Time is capped and flagged.`
      );
    }
  }
  /** Inline, collapsible "new child" form appended after a row. */
  renderChildForm(container, task, toggleBtn) {
    const form = container.createDiv({ cls: "filo-child-form" });
    const input = form.createEl("input", {
      type: "text",
      cls: "filo-child-input",
      attr: { placeholder: `New child of "${task.title}"\u2026` }
    });
    const create = form.createEl("button", { text: "Create", cls: "filo-child-create" });
    const cancel = form.createEl("button", { text: "Cancel", cls: "filo-child-cancel" });
    const close = () => {
      form.removeClass("is-open");
      input.value = "";
    };
    toggleBtn.addEventListener("click", () => {
      const willOpen = !form.hasClass("is-open");
      form.toggleClass("is-open", willOpen);
      if (willOpen)
        input.focus();
      else
        input.value = "";
    });
    const submit = async () => {
      const title = input.value.trim();
      if (!title)
        return;
      await this.plugin.createTask({ title, parent: task.id });
    };
    create.addEventListener("click", () => void submit());
    cancel.addEventListener("click", close);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      } else if (e.key === "Escape") {
        close();
      }
    });
  }
};

// src/processors/timeProcessor.ts
var import_obsidian5 = require("obsidian");
function formatStamp(iso) {
  const ms = Date.parse(iso);
  if (isNaN(ms))
    return iso || "\u2014";
  return new Date(ms).toLocaleString(void 0, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
var TimeWidget = class extends import_obsidian5.MarkdownRenderChild {
  constructor(plugin, containerEl, sourcePath) {
    super(containerEl);
    /** Elapsed-time cell, updated in place by the tick while a timer runs. */
    this.totalEl = null;
    /** Task the block belongs to; null when the block sits in a non-task note. */
    this.task = null;
    /** Monotonic render token; guards against interleaved async renders. */
    this.renderSeq = 0;
    this.plugin = plugin;
    this.sourcePath = sourcePath;
  }
  onload() {
    this.register(this.plugin.store.subscribe(() => void this.render()));
    this.registerInterval(window.setInterval(() => this.tick(), 1e3));
    void this.render();
  }
  /** Live-update the elapsed total while a session is open. */
  tick() {
    const task = this.task;
    if (!task || !this.totalEl)
      return;
    const { ms, flagged, running } = computeTotal(
      task.sessions,
      this.plugin.getTimerCapMs(),
      Date.now()
    );
    if (!running)
      return;
    this.totalEl.setText(formatDuration(ms));
    this.totalEl.toggleClass("filo-flagged", flagged);
  }
  async render() {
    var _a;
    const seq = ++this.renderSeq;
    const tasks = await this.plugin.store.listTasks();
    if (seq !== this.renderSeq)
      return;
    const task = (_a = tasks.find((t) => t.path === this.sourcePath)) != null ? _a : null;
    this.task = task;
    const el = this.containerEl;
    el.empty();
    el.addClass("filo-time-block");
    this.totalEl = null;
    if (!task) {
      el.createDiv({
        cls: "filo-empty",
        text: "t-time: this note isn't a Filo task, so there's nothing to time."
      });
      return;
    }
    const { ms, flagged, running } = computeTotal(task.sessions, this.plugin.getTimerCapMs());
    const header = el.createDiv({ cls: "filo-time-header" });
    this.totalEl = header.createDiv({
      cls: "filo-time-total" + (flagged ? " filo-flagged" : ""),
      text: formatDuration(ms)
    });
    header.createDiv({
      cls: "filo-time-state" + (running ? " filo-running" : ""),
      text: running ? "\u25CF running" : `${task.sessions.length} session${task.sessions.length === 1 ? "" : "s"}`
    });
    const controls = header.createDiv({ cls: "filo-time-controls" });
    const startBtn = controls.createEl("button", {
      cls: "filo-time-start",
      text: "\u25B6 Start",
      attr: { "aria-label": `Start timer for "${task.title}"` }
    });
    startBtn.disabled = running;
    startBtn.addEventListener("click", () => void this.plugin.store.startTimer(task.id));
    const stopBtn = controls.createEl("button", {
      cls: "filo-time-stop" + (running ? " filo-running" : ""),
      text: "\u23F9 Stop",
      attr: { "aria-label": `Stop timer for "${task.title}"` }
    });
    stopBtn.disabled = !running;
    stopBtn.addEventListener("click", () => void this.plugin.store.stopTimer(task.id));
    if (flagged) {
      el.createDiv({
        cls: "filo-error",
        text: `Running session exceeds the ${this.plugin.settings.timerCapHours}h cap \u2014 time is capped.`
      });
    }
    if (task.sessions.length) {
      const details = el.createEl("details", { cls: "filo-time-sessions" });
      details.createEl("summary", { text: "Sessions" });
      const list = details.createEl("ul");
      for (const s of task.sessions) {
        const span = s.stop === null ? "running" : formatDuration(Math.max(0, Date.parse(s.stop) - Date.parse(s.start)));
        list.createEl("li", {
          text: `${formatStamp(s.start)} \u2192 ${s.stop === null ? "\u2026" : formatStamp(s.stop)}  (${span})`
        });
      }
    }
  }
};

// src/processors/createTaskModal.ts
var import_obsidian6 = require("obsidian");
var CreateTaskModal = class extends import_obsidian6.Modal {
  constructor(app, plugin, defaultParentId) {
    super(app);
    this.titleVal = "";
    this.dueVal = "";
    this.tagsVal = "";
    this.recurring = false;
    /** Selected cadence preset key, or "custom". */
    this.cadenceKey = CADENCE_PRESETS[0].key;
    this.customCadence = "";
    this.plugin = plugin;
    this.defaultParentId = defaultParentId;
    this.parentId = defaultParentId;
  }
  onOpen() {
    void this.build();
  }
  onClose() {
    this.contentEl.empty();
  }
  async build() {
    var _a;
    const { contentEl, titleEl } = this;
    titleEl.setText("Create task");
    contentEl.empty();
    const refs = {};
    new import_obsidian6.Setting(contentEl).setName("Title").addText((t) => {
      refs.title = t.inputEl;
      t.onChange((v) => this.titleVal = v);
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void this.submit();
        }
      });
    });
    new import_obsidian6.Setting(contentEl).setName("Due").addText((t) => {
      t.inputEl.type = "date";
      t.onChange((v) => this.dueVal = v);
    });
    new import_obsidian6.Setting(contentEl).setName("Tags").setDesc("Comma-separated").addText((t) => {
      t.setPlaceholder("backend, docs");
      t.onChange((v) => this.tagsVal = v);
    });
    const tasks = await this.plugin.store.listTasks();
    new import_obsidian6.Setting(contentEl).setName("Parent").addDropdown((d) => {
      var _a2;
      d.addOption("", "(no parent)");
      for (const task of tasks.slice().sort((a, b) => a.title.localeCompare(b.title))) {
        const label = task.id === this.defaultParentId ? `${task.title} (current)` : task.title;
        d.addOption(task.id, label);
      }
      d.setValue((_a2 = this.parentId) != null ? _a2 : "");
      d.onChange((v) => this.parentId = v || null);
    });
    new import_obsidian6.Setting(contentEl).setName("Recurring").setDesc("Reset this task to undone on a cadence and log each period's outcome.").addToggle(
      (t) => t.setValue(this.recurring).onChange((v) => {
        this.recurring = v;
        cadenceSetting.settingEl.toggle(v);
        customSetting.settingEl.toggle(v && this.cadenceKey === "custom");
      })
    );
    const cadenceSetting = new import_obsidian6.Setting(contentEl).setName("Cadence").addDropdown((d) => {
      for (const p of CADENCE_PRESETS)
        d.addOption(p.key, p.label);
      d.addOption("custom", "Custom (cron)");
      d.setValue(this.cadenceKey);
      d.onChange((v) => {
        this.cadenceKey = v;
        customSetting.settingEl.toggle(this.recurring && v === "custom");
      });
    });
    const customSetting = new import_obsidian6.Setting(contentEl).setName("Custom cron").setDesc('5-field cron, e.g. "0 0 * * *" (daily at midnight).').addText((t) => {
      t.setPlaceholder("0 0 * * *");
      t.onChange((v) => this.customCadence = v);
    });
    cadenceSetting.settingEl.toggle(this.recurring);
    customSetting.settingEl.toggle(this.recurring && this.cadenceKey === "custom");
    new import_obsidian6.Setting(contentEl).addButton(
      (b) => b.setButtonText("Create").setCta().onClick(() => void this.submit())
    );
    (_a = refs.title) == null ? void 0 : _a.focus();
  }
  /** Resolve the chosen cadence to a cron string, or null if invalid. */
  resolveCadence() {
    var _a, _b;
    if (this.cadenceKey === "custom") {
      const expr = this.customCadence.trim();
      return parseCron(expr) ? expr : null;
    }
    return (_b = (_a = CADENCE_PRESETS.find((p) => p.key === this.cadenceKey)) == null ? void 0 : _a.cron) != null ? _b : null;
  }
  async submit() {
    const title = this.titleVal.trim();
    if (!title) {
      new import_obsidian6.Notice("Filo: title required");
      return;
    }
    const tags = this.tagsVal.split(",").map((s) => s.trim()).filter(Boolean);
    let cadence = null;
    if (this.recurring) {
      cadence = this.resolveCadence();
      if (!cadence) {
        new import_obsidian6.Notice("Filo: invalid cron cadence");
        return;
      }
    }
    await this.plugin.createTask({
      title,
      due: this.dueVal || null,
      tags,
      parent: this.parentId,
      recurring: this.recurring,
      cadence
    });
    new import_obsidian6.Notice(`Filo: created "${title}"`);
    this.close();
  }
};

// src/ui/fileTimerButton.ts
var import_obsidian7 = require("obsidian");
function isRunning(task) {
  return task.sessions.some((s) => s.stop === null);
}
var FileTimerManager = class {
  constructor(plugin) {
    this.records = /* @__PURE__ */ new Map();
    this.plugin = plugin;
  }
  /** Re-sync controls across all open markdown leaves. */
  async update() {
    const tasks = await this.plugin.store.listTasks();
    const byPath = new Map(tasks.map((t) => [t.path, t]));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const live = /* @__PURE__ */ new Set();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof import_obsidian7.MarkdownView))
        continue;
      live.add(view);
      const task = view.file ? byPath.get(view.file.path) : void 0;
      const rec = this.records.get(view);
      if (!task) {
        if (rec)
          this.removeRecord(view, rec);
        continue;
      }
      const activeRec = rec && rec.taskId === task.id ? rec : this.replaceRecord(view, rec, task);
      const hasParent = !!task.parent && byId.has(task.parent);
      const childCount = tasks.reduce((n, t) => t.parent === task.id ? n + 1 : n, 0);
      this.refresh(activeRec, task, hasParent, childCount);
    }
    for (const view of Array.from(this.records.keys())) {
      if (!live.has(view))
        this.records.delete(view);
    }
  }
  replaceRecord(view, rec, task) {
    if (rec)
      this.removeRecord(view, rec);
    return this.addControls(view, task);
  }
  addControls(view, task) {
    const timerEl = view.addAction("play", "Filo timer", () => void this.toggleTimer(task.id));
    timerEl.addClass("filo-file-timer");
    const parentEl = view.addAction(
      "corner-left-up",
      "Filo: go to parent task",
      () => void this.goToParent(task.id)
    );
    parentEl.addClass("filo-nav-parent");
    const childEl = view.addAction(
      "corner-down-right",
      "Filo: go to child task",
      (evt) => void this.goToChild(task.id, evt)
    );
    childEl.addClass("filo-nav-child");
    const rec = { taskId: task.id, timerEl, parentEl, childEl };
    this.records.set(view, rec);
    return rec;
  }
  removeRecord(view, rec) {
    rec.timerEl.remove();
    rec.parentEl.remove();
    rec.childEl.remove();
    this.records.delete(view);
  }
  async toggleTimer(taskId) {
    const task = await this.plugin.store.getTask(taskId);
    if (!task)
      return;
    if (isRunning(task))
      await this.plugin.store.stopTimer(taskId);
    else
      await this.plugin.store.startTimer(taskId);
  }
  async goToParent(taskId) {
    const task = await this.plugin.store.getTask(taskId);
    if (!(task == null ? void 0 : task.parent))
      return;
    const parent = await this.plugin.store.getTask(task.parent);
    if (parent)
      await this.plugin.openTaskFile(parent);
  }
  async goToChild(taskId, evt) {
    const children = await this.plugin.store.getChildren(taskId);
    if (!children.length)
      return;
    if (children.length === 1) {
      await this.plugin.openTaskFile(children[0]);
      return;
    }
    const menu = new import_obsidian7.Menu();
    for (const child of children.slice().sort((a, b) => a.title.localeCompare(b.title))) {
      menu.addItem(
        (item) => item.setTitle(child.title).setIcon("circle").onClick(() => void this.plugin.openTaskFile(child))
      );
    }
    menu.showAtMouseEvent(evt);
  }
  refresh(rec, task, hasParent, childCount) {
    const running = isRunning(task);
    (0, import_obsidian7.setIcon)(rec.timerEl, running ? "square" : "play");
    const { ms } = computeTotal(task.sessions, this.plugin.getTimerCapMs());
    rec.timerEl.setAttribute(
      "aria-label",
      `Filo: ${running ? "Stop" : "Start"} timer (${formatDuration(ms)})`
    );
    rec.timerEl.toggleClass("filo-running", running);
    rec.parentEl.style.display = hasParent ? "" : "none";
    rec.childEl.style.display = childCount > 0 ? "" : "none";
    rec.childEl.setAttribute(
      "aria-label",
      childCount === 1 ? "Filo: go to child task" : `Filo: go to child task (${childCount})`
    );
  }
  /** Remove all controls (called on plugin unload). */
  destroy() {
    for (const rec of this.records.values()) {
      rec.timerEl.remove();
      rec.parentEl.remove();
      rec.childEl.remove();
    }
    this.records.clear();
  }
};

// src/ui/statusBar.ts
var import_obsidian8 = require("obsidian");
var MAX_TITLE = 28;
var CurrentTaskStatus = class {
  constructor(plugin, el) {
    this.currentId = null;
    this.title = "";
    this.sessions = [];
    this.running = false;
    this.plugin = plugin;
    this.el = el;
    el.addClass("filo-status-item", "mod-clickable");
    this.iconEl = el.createSpan({ cls: "filo-status-icon" });
    this.textEl = el.createSpan({ cls: "filo-status-text" });
    el.addEventListener("click", () => void this.onClick());
  }
  async onClick() {
    if (!this.currentId)
      return;
    const task = await this.plugin.store.getTask(this.currentId);
    if (task)
      await this.plugin.openTaskFile(task);
  }
  /** Recompute which task is current and re-render. */
  async update() {
    const id = this.plugin.currentTaskId();
    const task = id ? await this.plugin.store.getTask(id) : null;
    if (!task) {
      this.currentId = null;
      this.running = false;
      this.sessions = [];
      this.title = "";
      this.el.toggleClass("filo-running", false);
      (0, import_obsidian8.setIcon)(this.iconEl, "circle");
      this.textEl.setText("No current task");
      this.el.setAttribute("aria-label", "Filo: no current task");
      return;
    }
    this.currentId = task.id;
    this.title = task.title;
    this.sessions = task.sessions;
    this.running = task.sessions.some((s) => s.stop === null);
    (0, import_obsidian8.setIcon)(this.iconEl, this.running ? "clock" : "circle");
    this.el.toggleClass("filo-running", this.running);
    this.el.setAttribute("aria-label", `Filo: jump to "${task.title}"`);
    this.renderText();
  }
  /** Live-update only the elapsed time while a timer runs. */
  tick() {
    if (this.running)
      this.renderText();
  }
  renderText() {
    const short = this.title.length > MAX_TITLE ? this.title.slice(0, MAX_TITLE - 1) + "\u2026" : this.title;
    if (this.running) {
      const { ms } = computeTotal(this.sessions, this.plugin.getTimerCapMs());
      this.textEl.setText(`${short} \xB7 ${formatDuration(ms)}`);
    } else {
      this.textEl.setText(short);
    }
  }
};

// src/ui/taskSuggest.ts
var import_obsidian10 = require("obsidian");

// src/store/mtime.ts
var import_obsidian9 = require("obsidian");
function taskMtime(app, task) {
  const f = app.vault.getAbstractFileByPath(task.path);
  return f instanceof import_obsidian9.TFile ? f.stat.mtime : 0;
}
function byRecentlyModified(app, tasks) {
  return tasks.map((task) => ({ task, mtime: taskMtime(app, task) })).sort((a, b) => b.mtime - a.mtime).map((x) => x.task);
}

// src/ui/taskSuggest.ts
var MAX_QUERY_LEN = 40;
function relativeTime(ms) {
  if (!ms)
    return "";
  const diff = Date.now() - ms;
  if (diff < 6e4)
    return "just now";
  const mins = Math.floor(diff / 6e4);
  if (mins < 60)
    return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30)
    return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
function safeAlias(title) {
  return title.replace(/[|\[\]]/g, "").trim() || "task";
}
var TaskLinkSuggest = class extends import_obsidian10.EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "navigate" },
      { command: "\u21B5", purpose: "insert task link" },
      { command: "esc", purpose: "dismiss" }
    ]);
  }
  /**
   * Fires on every keypress, so it bails as early as possible: the trigger must
   * be present on the line before the cursor and sit at the start of the line or
   * after whitespace (so `notes/tasks` and URLs never open the popover).
   */
  onTrigger(cursor, editor, _file) {
    if (!this.plugin.settings.taskLinkSuggest)
      return null;
    const trigger = this.plugin.settings.taskLinkTrigger || "/t";
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const start = before.lastIndexOf(trigger);
    if (start < 0)
      return null;
    if (start > 0 && !/\s/.test(before[start - 1]))
      return null;
    const query = before.slice(start + trigger.length);
    if (query.length > MAX_QUERY_LEN)
      return null;
    if (/[[\]]/.test(query))
      return null;
    return { start: { line: cursor.line, ch: start }, end: cursor, query };
  }
  async getSuggestions(context) {
    const tasks = await this.plugin.store.listTasks();
    const query = context.query.trim();
    const match = query ? (0, import_obsidian10.prepareFuzzySearch)(query) : null;
    const out = [];
    for (const task of tasks) {
      if (this.plugin.settings.taskLinkHideDone && task.status === "done")
        continue;
      if (match && !match(task.title) && !task.tags.some((t) => match(t)))
        continue;
      out.push({ task, mtime: taskMtime(this.app, task) });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out.slice(0, Math.max(1, this.plugin.settings.taskLinkMaxResults));
  }
  renderSuggestion(item, el) {
    const { task } = item;
    el.addClass("filo-suggest-item");
    const main = el.createDiv({ cls: "filo-suggest-main" });
    main.createSpan({
      cls: `filo-suggest-status filo-suggest-status-${task.status}`,
      text: STATUS_ICON[task.status]
    });
    main.createSpan({ cls: "filo-suggest-title", text: task.title });
    const meta = el.createDiv({ cls: "filo-suggest-meta" });
    if (task.due)
      meta.createSpan({ cls: "filo-suggest-due", text: `due ${task.due}` });
    for (const tag of task.tags) {
      meta.createSpan({ cls: "filo-tag", text: `#${tag}` });
    }
    const rel = relativeTime(item.mtime);
    if (rel)
      meta.createSpan({ cls: "filo-suggest-mtime", text: rel });
  }
  selectSuggestion(item, _evt) {
    var _a, _b;
    const ctx = this.context;
    if (!ctx)
      return;
    const link = this.linkFor(item.task, (_b = (_a = ctx.file) == null ? void 0 : _a.path) != null ? _b : "");
    ctx.editor.replaceRange(link, ctx.start, ctx.end);
    ctx.editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + link.length });
    this.close();
  }
  /**
   * Build the inserted link. generateMarkdownLink is preferred because it honors
   * the vault's link settings (wikilink vs markdown, shortest-path vs absolute);
   * the hand-built wikilink is a fallback for a task whose file has vanished.
   */
  linkFor(task, sourcePath) {
    const alias = safeAlias(task.title);
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (f instanceof import_obsidian10.TFile) {
      return this.app.fileManager.generateMarkdownLink(f, sourcePath, void 0, alias);
    }
    return `[[${task.path.replace(/\.md$/, "")}|${alias}]]`;
  }
};

// src/ui/parentBanner.ts
var import_obsidian11 = require("obsidian");
var STATUS_MENU_ICON = {
  undone: "circle",
  "in-progress": "circle-dot",
  done: "check-circle"
};
var NEXT_STATUS2 = {
  undone: "in-progress",
  "in-progress": "done",
  done: "undone"
};
var STATUS_LABEL = {
  undone: "Undone",
  "in-progress": "In progress",
  done: "Done"
};
var STATUS_CLASSES = Object.keys(STATUS_LABEL).map(
  (s) => `filo-banner-status-${s}`
);
var ParentPickerModal = class extends import_obsidian11.FuzzySuggestModal {
  constructor(app, choices, onChoose) {
    super(app);
    this.choices = choices;
    this.onChoose = onChoose;
    this.setPlaceholder("Search tasks by title\u2026");
  }
  getItems() {
    return this.choices;
  }
  getItemText(choice) {
    return choice.label;
  }
  onChooseItem(choice) {
    this.onChoose(choice);
  }
};
var ParentBannerManager = class {
  constructor(plugin) {
    this.records = /* @__PURE__ */ new Map();
    this.plugin = plugin;
  }
  /** Re-sync banners across all open markdown leaves. */
  async update() {
    var _a, _b;
    if (!this.plugin.settings.parentBanner) {
      this.destroy();
      return;
    }
    const tasks = await this.plugin.store.listTasks();
    const byPath = new Map(tasks.map((t) => [t.path, t]));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const byParent = /* @__PURE__ */ new Map();
    for (const t of tasks) {
      if (!t.parent)
        continue;
      const arr = (_a = byParent.get(t.parent)) != null ? _a : [];
      arr.push(t);
      byParent.set(t.parent, arr);
    }
    const live = /* @__PURE__ */ new Set();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof import_obsidian11.MarkdownView))
        continue;
      live.add(view);
      const task = view.file ? byPath.get(view.file.path) : void 0;
      const rec = this.records.get(view);
      if (!task) {
        if (rec)
          this.removeRecord(view, rec);
        continue;
      }
      const active = rec && rec.taskId === task.id ? rec : this.replaceRecord(view, rec, task);
      if (!active.el.isConnected)
        view.contentEl.prepend(active.el);
      this.refresh(active, task, byId, (_b = byParent.get(task.id)) != null ? _b : []);
    }
    for (const view of Array.from(this.records.keys())) {
      if (!live.has(view))
        this.records.delete(view);
    }
  }
  replaceRecord(view, rec, task) {
    if (rec)
      this.removeRecord(view, rec);
    return this.addBanner(view, task);
  }
  addBanner(view, task) {
    const el = createDiv({ cls: "filo-parent-banner" });
    const statusEl = el.createEl("button", { cls: "filo-banner-status" });
    const statusIconEl = statusEl.createSpan({ cls: "filo-banner-status-icon" });
    const statusTextEl = statusEl.createSpan({ cls: "filo-banner-status-text" });
    statusEl.addEventListener("click", () => void this.cycleStatus(task.id));
    el.createSpan({ cls: "filo-parent-label", text: "Parent" });
    const valueEl = el.createEl("button", { cls: "filo-parent-value" });
    valueEl.addEventListener("click", () => void this.openPicker(task.id));
    const openEl = el.createEl("button", { cls: "filo-parent-open" });
    (0, import_obsidian11.setIcon)(openEl, "corner-left-up");
    openEl.setAttribute("aria-label", "Open parent task");
    openEl.addEventListener("click", () => void this.goToParent(task.id));
    const childrenEl = el.createEl("button", { cls: "filo-parent-children" });
    const childIconEl = childrenEl.createSpan({ cls: "filo-parent-children-icon" });
    (0, import_obsidian11.setIcon)(childIconEl, "list-tree");
    const childCountEl = childrenEl.createSpan({ cls: "filo-parent-children-count" });
    childrenEl.addEventListener("click", (evt) => void this.openChildMenu(task.id, evt));
    view.contentEl.prepend(el);
    const rec = {
      taskId: task.id,
      el,
      statusEl,
      statusIconEl,
      statusTextEl,
      valueEl,
      openEl,
      childrenEl,
      childCountEl
    };
    this.records.set(view, rec);
    return rec;
  }
  removeRecord(view, rec) {
    rec.el.remove();
    this.records.delete(view);
  }
  refresh(rec, task, byId, children) {
    const parent = task.parent ? byId.get(task.parent) : void 0;
    rec.statusEl.removeClass(...STATUS_CLASSES);
    rec.statusEl.addClass(`filo-banner-status-${task.status}`);
    rec.statusIconEl.empty();
    (0, import_obsidian11.setIcon)(rec.statusIconEl, STATUS_MENU_ICON[task.status]);
    rec.statusTextEl.setText(STATUS_LABEL[task.status]);
    rec.statusEl.setAttribute(
      "aria-label",
      `Status: ${STATUS_LABEL[task.status]} \u2014 click to mark ` + STATUS_LABEL[NEXT_STATUS2[task.status]].toLowerCase()
    );
    if (parent) {
      rec.valueEl.setText(parent.title);
      rec.valueEl.removeClass("filo-parent-none", "filo-parent-broken");
      rec.valueEl.setAttribute("aria-label", "Change parent task");
    } else if (task.parent) {
      rec.valueEl.setText(`\u26A0 missing task ${task.parent}`);
      rec.valueEl.removeClass("filo-parent-none");
      rec.valueEl.addClass("filo-parent-broken");
      rec.valueEl.setAttribute("aria-label", "Change parent task");
    } else {
      rec.valueEl.setText("Set parent\u2026");
      rec.valueEl.removeClass("filo-parent-broken");
      rec.valueEl.addClass("filo-parent-none");
      rec.valueEl.setAttribute("aria-label", "Set parent task");
    }
    rec.openEl.toggle(!!parent);
    rec.childrenEl.toggle(children.length > 0);
    rec.childCountEl.setText(String(children.length));
    rec.childrenEl.setAttribute(
      "aria-label",
      children.length === 1 ? "1 subtask" : `${children.length} subtasks`
    );
  }
  /**
   * Advance the task one step around the status cycle. The status is re-read at
   * click time (rather than taken from the rendered banner) so a banner that
   * hasn't refreshed yet can't write a value based on a stale status.
   */
  async cycleStatus(taskId) {
    const task = await this.plugin.store.getTask(taskId);
    if (!task)
      return;
    try {
      await this.plugin.store.setStatus(taskId, NEXT_STATUS2[task.status]);
    } catch (e) {
      console.error("[Filo] failed to set status", e);
      new import_obsidian11.Notice("Filo: failed to set status");
    }
  }
  /**
   * Drop down the task's direct children so a parent note can jump straight
   * into any of them. Children are re-read at click time, and ordered undone
   * first so the still-open work is nearest the cursor.
   */
  async openChildMenu(taskId, evt) {
    const children = await this.plugin.store.getChildren(taskId);
    if (!children.length) {
      new import_obsidian11.Notice("Filo: no subtasks.");
      return;
    }
    const order = {
      undone: 0,
      "in-progress": 1,
      done: 2
    };
    const sorted = children.slice().sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));
    const menu = new import_obsidian11.Menu();
    for (const child of sorted) {
      menu.addItem(
        (item) => item.setTitle(child.title).setIcon(STATUS_MENU_ICON[child.status]).onClick(() => void this.plugin.openTaskFile(child))
      );
    }
    menu.showAtMouseEvent(evt);
  }
  async goToParent(taskId) {
    const task = await this.plugin.store.getTask(taskId);
    if (!(task == null ? void 0 : task.parent))
      return;
    const parent = await this.plugin.store.getTask(task.parent);
    if (parent)
      await this.plugin.openTaskFile(parent);
  }
  /**
   * Offer every task as a parent except the task itself and its own
   * descendants — reparenting under a descendant would create a cycle.
   * Ordered most-recently-modified first, matching the `/t` dropdown.
   */
  async openPicker(taskId) {
    const app = this.plugin.app;
    const task = await this.plugin.store.getTask(taskId);
    if (!task)
      return;
    const descendants = new Set(
      (await this.plugin.store.getSubtree(taskId)).map((n) => n.task.id)
    );
    const candidates = byRecentlyModified(
      app,
      (await this.plugin.store.listTasks()).filter((t) => !descendants.has(t.id))
    );
    const choices = [];
    if (task.parent)
      choices.push({ task: null, label: "(no parent)" });
    for (const t of candidates) {
      choices.push({ task: t, label: t.title });
    }
    if (!choices.length) {
      new import_obsidian11.Notice("Filo: no other tasks available as a parent.");
      return;
    }
    new ParentPickerModal(app, choices, (choice) => {
      void this.setParent(taskId, choice);
    }).open();
  }
  async setParent(taskId, choice) {
    var _a, _b;
    try {
      await this.plugin.store.updateTask(taskId, { parent: (_b = (_a = choice.task) == null ? void 0 : _a.id) != null ? _b : null });
      new import_obsidian11.Notice(
        choice.task ? `Filo: parent set to "${choice.task.title}"` : "Filo: parent cleared"
      );
    } catch (e) {
      console.error("[Filo] failed to set parent", e);
      new import_obsidian11.Notice("Filo: failed to set parent");
    }
  }
  /** Remove all banners (called on plugin unload and when the setting is off). */
  destroy() {
    for (const rec of this.records.values())
      rec.el.remove();
    this.records.clear();
  }
};

// src/canvas/canvasImport.ts
var import_obsidian12 = require("obsidian");
var NODE_W = 260;
var NODE_H = 80;
var H_GAP = 120;
var V_GAP = 40;
var HEAT_RAMP = ["6", "5", "4", "3", "2", "1"];
var ABS_THRESHOLDS_HOURS = [0.25, 1, 2, 4, 8];
function colorForTime(ms, maxMs, mode) {
  if (ms <= 0)
    return void 0;
  if (mode === "absolute") {
    const hours = ms / 36e5;
    let bucket = 0;
    for (const t of ABS_THRESHOLDS_HOURS)
      if (hours >= t)
        bucket++;
    return HEAT_RAMP[Math.min(bucket, HEAT_RAMP.length - 1)];
  }
  if (maxMs <= 0)
    return void 0;
  const r = ms / maxMs;
  const idx = Math.min(HEAT_RAMP.length - 1, Math.floor(r * HEAT_RAMP.length));
  return HEAT_RAMP[idx];
}
async function importTaskTreeToCanvas(plugin, rootId) {
  var _a;
  const store = plugin.store;
  const nodes = await store.getSubtree(rootId);
  if (!nodes.length) {
    new import_obsidian12.Notice("Filo: no task found to import.");
    return;
  }
  const capMs = plugin.getTimerCapMs();
  const times = /* @__PURE__ */ new Map();
  let maxMs = 0;
  for (const n of nodes) {
    const ms = computeTotal(n.task.sessions, capMs).ms;
    times.set(n.task.id, ms);
    if (ms > maxMs)
      maxMs = ms;
  }
  const folder = (0, import_obsidian12.normalizePath)(plugin.settings.canvasFolder || "");
  const canvasPath = folder ? `${folder}/${rootId}.canvas` : `${rootId}.canvas`;
  if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
    await plugin.app.vault.createFolder(folder).catch(() => {
    });
  }
  let existing = { nodes: [], edges: [] };
  const existingFile = plugin.app.vault.getAbstractFileByPath(canvasPath);
  if (existingFile instanceof import_obsidian12.TFile) {
    try {
      existing = JSON.parse(await plugin.app.vault.read(existingFile));
      if (!Array.isArray(existing.nodes))
        existing.nodes = [];
      if (!Array.isArray(existing.edges))
        existing.edges = [];
    } catch (e) {
      existing = { nodes: [], edges: [] };
    }
  }
  const prevById = new Map(existing.nodes.map((n) => [n.id, n]));
  const taskIds = new Set(nodes.map((n) => n.task.id));
  const slot = {};
  for (const n of nodes) {
    if (prevById.has(n.task.id))
      slot[n.depth] = ((_a = slot[n.depth]) != null ? _a : 0) + 1;
  }
  const taskNodes = nodes.map((n) => {
    var _a2, _b, _c, _d;
    const prev = prevById.get(n.task.id);
    const color = colorForTime((_a2 = times.get(n.task.id)) != null ? _a2 : 0, maxMs, plugin.settings.rednessMode);
    let x;
    let y;
    if (prev) {
      x = prev.x;
      y = prev.y;
    } else {
      x = n.depth * (NODE_W + H_GAP);
      const i = (_b = slot[n.depth]) != null ? _b : 0;
      slot[n.depth] = i + 1;
      y = i * (NODE_H + V_GAP);
    }
    const node = {
      ...prev != null ? prev : {},
      id: n.task.id,
      type: "file",
      file: n.task.path,
      // refresh in case the file moved
      x,
      y,
      width: (_c = prev == null ? void 0 : prev.width) != null ? _c : NODE_W,
      height: (_d = prev == null ? void 0 : prev.height) != null ? _d : NODE_H
    };
    if (color)
      node.color = color;
    else
      delete node.color;
    return node;
  });
  const foreignNodes = existing.nodes.filter((nd) => !String(nd.id).startsWith("t-"));
  const taskEdges = [];
  for (const n of nodes) {
    if (n.task.parent && taskIds.has(n.task.parent)) {
      taskEdges.push({
        id: `e-${n.task.parent}-${n.task.id}`,
        fromNode: n.task.parent,
        toNode: n.task.id,
        fromSide: "right",
        toSide: "left"
      });
    }
  }
  const foreignEdges = existing.edges.filter((e) => !String(e.id).startsWith("e-t-"));
  const out = {
    nodes: [...foreignNodes, ...taskNodes],
    edges: [...foreignEdges, ...taskEdges]
  };
  const json = JSON.stringify(out, null, 2);
  if (existingFile instanceof import_obsidian12.TFile) {
    await plugin.app.vault.modify(existingFile, json);
    new import_obsidian12.Notice(`Filo: updated canvas (${taskNodes.length} tasks).`);
  } else {
    await plugin.app.vault.create(canvasPath, json);
    new import_obsidian12.Notice(`Filo: created canvas (${taskNodes.length} tasks).`);
  }
}
var TaskPickerModal = class extends import_obsidian12.FuzzySuggestModal {
  constructor(app, tasks, onChoose) {
    super(app);
    this.tasks = tasks;
    this.onChoose = onChoose;
    this.setPlaceholder("Pick the root task to import\u2026");
  }
  getItems() {
    return this.tasks;
  }
  getItemText(task) {
    return task.title;
  }
  onChooseItem(task) {
    this.onChoose(task);
  }
};

// src/main.ts
var FiloPlugin = class extends import_obsidian13.Plugin {
  constructor() {
    super(...arguments);
    this.activeTaskId = null;
    this.lastTaskId = null;
  }
  async onload() {
    await this.loadFiloData();
    this.store = new TaskStore(this.app, this);
    this.fileTimer = new FileTimerManager(this);
    this.parentBanner = new ParentBannerManager(this);
    this.status = new CurrentTaskStatus(this, this.addStatusBarItem());
    this.registerEvent(
      this.app.vault.on("modify", (f) => this.store.handleVaultChange(f.path))
    );
    this.registerEvent(
      this.app.vault.on("create", (f) => this.store.handleVaultChange(f.path))
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => this.store.handleVaultChange(f.path))
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        this.store.handleVaultChange(f.path);
        this.store.handleVaultChange(oldPath);
      })
    );
    this.registerMarkdownCodeBlockProcessor("t-add", (_src, el, ctx) => {
      ctx.addChild(new AddWidget(this, el, ctx.sourcePath));
    });
    this.registerMarkdownCodeBlockProcessor("t-list", (src, el, ctx) => {
      ctx.addChild(new ListWidget(this, el, src));
    });
    this.registerMarkdownCodeBlockProcessor("t-time", (_src, el, ctx) => {
      ctx.addChild(new TimeWidget(this, el, ctx.sourcePath));
    });
    this.addCommand({
      id: "create-task",
      name: "Create task",
      callback: () => void this.openCreateTask()
    });
    this.addCommand({
      id: "create-child-of-current-task",
      name: "Create child of current task",
      checkCallback: (checking) => {
        if (!this.activeTaskFilePath())
          return false;
        if (!checking)
          void this.openCreateTask();
        return true;
      }
    });
    this.addCommand({
      id: "import-task-tree-to-canvas",
      name: "Import task tree to canvas",
      callback: () => void this.runCanvasImport()
    });
    this.addCommand({
      id: "load-tasks",
      name: "Load tasks (process recurring)",
      callback: () => void this.runProcessRecurring(true)
    });
    this.registerEditorSuggest(new TaskLinkSuggest(this));
    this.addSettingTab(new FiloSettingTab(this.app, this));
    this.registerEvent(this.app.workspace.on("file-open", (f) => void this.onFileOpen(f)));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshFileUI()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshFileUI()));
    this.register(
      this.store.subscribe(() => {
        this.refreshFileUI();
        void this.status.update();
      })
    );
    this.registerInterval(window.setInterval(() => this.status.tick(), 1e3));
    this.app.workspace.onLayoutReady(() => {
      this.refreshFileUI();
      void this.status.update();
      if (this.settings.processRecurringOnLoad)
        void this.runProcessRecurring(false);
    });
  }
  /**
   * Reset due recurring tasks. `announce` controls whether a Notice is shown
   * (true for the explicit command and the t-list button, false for the silent
   * on-load pass).
   */
  async runProcessRecurring(announce) {
    try {
      const count = await this.store.processRecurring();
      if (announce) {
        new import_obsidian13.Notice(
          count > 0 ? `Filo: reset ${count} recurring task${count === 1 ? "" : "s"}` : "Filo: no recurring tasks due"
        );
      }
    } catch (e) {
      console.error("[Filo] processRecurring failed", e);
      if (announce)
        new import_obsidian13.Notice("Filo: failed to process recurring tasks");
    }
  }
  onunload() {
    var _a, _b;
    (_a = this.fileTimer) == null ? void 0 : _a.destroy();
    (_b = this.parentBanner) == null ? void 0 : _b.destroy();
  }
  /** Re-sync the per-note task UI (header timer/nav buttons and parent banner). */
  refreshFileUI() {
    void this.fileTimer.update();
    void this.parentBanner.update();
  }
  /** Track the last opened task file (for the status-bar fallback) and refresh UI. */
  async onFileOpen(file) {
    this.refreshFileUI();
    if (file instanceof import_obsidian13.TFile && file.extension === "md") {
      const folder = (0, import_obsidian13.normalizePath)(this.settings.tasksFolder || "tasks");
      if (file.path.startsWith(folder + "/")) {
        const task = (await this.store.listTasks()).find((t) => t.path === file.path);
        if (task && task.id !== this.lastTaskId) {
          this.lastTaskId = task.id;
          await this.persist();
        }
      }
    }
    void this.status.update();
  }
  /** The "current task": the running-timer task if any, else the last opened task. */
  currentTaskId() {
    var _a;
    return (_a = this.activeTaskId) != null ? _a : this.lastTaskId;
  }
  /**
   * Create a task, then open it if it was created as a child of the task whose
   * file is currently active — i.e. "created from the current task". Other
   * creation paths (e.g. the t-list + button used from a dashboard) leave the
   * current view untouched.
   */
  async createTask(input) {
    const task = await this.store.createTask(input);
    const activePath = this.activeTaskFilePath();
    if (task.parent && activePath) {
      const activeTask = (await this.store.listTasks()).find((t) => t.path === activePath);
      if (activeTask && activeTask.id === task.parent) {
        await this.openTaskFile(task);
      }
    }
    return task;
  }
  /** Open a task's backing file in the active leaf. */
  async openTaskFile(task) {
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (f instanceof import_obsidian13.TFile)
      await this.app.workspace.getLeaf(false).openFile(f);
  }
  /** Active file's path if it's a markdown file inside the tasks folder, else null. */
  activeTaskFilePath() {
    const f = this.app.workspace.getActiveFile();
    if (!(f instanceof import_obsidian13.TFile) || f.extension !== "md")
      return null;
    const folder = (0, import_obsidian13.normalizePath)(this.settings.tasksFolder || "tasks");
    return f.path.startsWith(folder + "/") ? f.path : null;
  }
  /** Open the create-task modal, defaulting the parent to the active task (if any). */
  async openCreateTask() {
    var _a, _b;
    const path = this.activeTaskFilePath();
    let parentId = null;
    if (path) {
      const tasks = await this.store.listTasks();
      parentId = (_b = (_a = tasks.find((t) => t.path === path)) == null ? void 0 : _a.id) != null ? _b : null;
    }
    new CreateTaskModal(this.app, this, parentId).open();
  }
  async runCanvasImport() {
    var _a, _b;
    const active = this.app.workspace.getActiveFile();
    const tasks = await this.store.listTasks();
    let rootId = null;
    if (active instanceof import_obsidian13.TFile) {
      rootId = (_b = (_a = tasks.find((t) => t.path === active.path)) == null ? void 0 : _a.id) != null ? _b : null;
    }
    if (rootId) {
      await importTaskTreeToCanvas(this, rootId);
      return;
    }
    if (!tasks.length) {
      new import_obsidian13.Notice("Filo: no tasks to import.");
      return;
    }
    new TaskPickerModal(this.app, tasks, (t) => void importTaskTreeToCanvas(this, t.id)).open();
  }
  // --- FiloDataAccess (consumed by TaskStore) ------------------------------
  getTasksFolder() {
    return this.settings.tasksFolder;
  }
  getTimerCapMs() {
    return this.settings.timerCapHours * 36e5;
  }
  getActiveTaskId() {
    return this.activeTaskId;
  }
  async setActiveTaskId(id) {
    this.activeTaskId = id;
    await this.persist();
  }
  // --- persistence ---------------------------------------------------------
  async loadFiloData() {
    var _a, _b, _c;
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (_a = data == null ? void 0 : data.settings) != null ? _a : {});
    this.activeTaskId = (_b = data == null ? void 0 : data.activeTaskId) != null ? _b : null;
    this.lastTaskId = (_c = data == null ? void 0 : data.lastTaskId) != null ? _c : null;
  }
  async persist() {
    const data = {
      settings: this.settings,
      activeTaskId: this.activeTaskId,
      lastTaskId: this.lastTaskId
    };
    await this.saveData(data);
  }
  async saveSettings() {
    var _a;
    await this.persist();
    (_a = this.store) == null ? void 0 : _a.invalidate();
  }
};
