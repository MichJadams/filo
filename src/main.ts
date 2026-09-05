import { ItemView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import { Task, TaskInput } from "./types";
import { DEFAULT_SETTINGS, FiloSettings, FiloSettingTab } from "./settings";
import { FiloDataAccess, TaskStore } from "./store/TaskStore";
import { AddWidget } from "./processors/addProcessor";
import { ListWidget } from "./processors/listProcessor";
import { TimeWidget } from "./processors/timeProcessor";
import { CreateTaskModal } from "./processors/createTaskModal";
import { CopyTaskModal } from "./processors/copyTaskModal";
import { FileTimerManager } from "./ui/fileTimerButton";
import { CurrentTaskStatus } from "./ui/statusBar";
import { TaskLinkSuggest } from "./ui/taskSuggest";
import { TaskSearchModal } from "./ui/taskSearchModal";
import { ParentBannerManager } from "./ui/parentBanner";
import { CanvasActionManager } from "./ui/canvasActions";
import { TaskPickerModal, openTaskCanvas } from "./canvas/canvasImport";
import { digestCanvas } from "./canvas/canvasDigest";
import { clearSlackStatus } from "./slack/slackStatus";

/** Shape persisted via loadData/saveData. */
interface FiloData {
  settings: FiloSettings;
  /** Id of the single globally-active timer; null when none. Survives reloads. */
  activeTaskId: string | null;
  /** Last task file opened; the "current task" fallback when no timer runs. */
  lastTaskId: string | null;
  /**
   * The status text Filo last pushed to Slack, or null when it hasn't pushed
   * one (or has since cleared it). Persisted so a restart doesn't leave a
   * Filo-set status that nothing will clean up.
   */
  slackStatusText: string | null;
}

export default class FiloPlugin extends Plugin implements FiloDataAccess {
  settings!: FiloSettings;
  store!: TaskStore;
  private activeTaskId: string | null = null;
  private lastTaskId: string | null = null;
  /** See `FiloData.slackStatusText`. Read by the Slack module. */
  slackStatusText: string | null = null;
  private fileTimer!: FileTimerManager;
  private parentBanner!: ParentBannerManager;
  private canvasActions!: CanvasActionManager;
  private status!: CurrentTaskStatus;

  async onload(): Promise<void> {
    await this.loadFiloData();

    this.store = new TaskStore(this.app, this);
    this.fileTimer = new FileTimerManager(this);
    this.parentBanner = new ParentBannerManager(this);
    this.canvasActions = new CanvasActionManager(this);
    this.status = new CurrentTaskStatus(this, this.addStatusBarItem());

    // Cache invalidation: any create/modify/delete/rename inside the tasks
    // folder drops the cache and re-renders open widgets. registerEvent ties
    // these to the plugin lifecycle so they're cleaned up on unload.
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

    // Code block processors.
    this.registerMarkdownCodeBlockProcessor("t-add", (_src, el, ctx) => {
      // ctx.sourcePath is the file the block lives in; the widget uses it to
      // default the parent to the containing task (if that file is a task).
      ctx.addChild(new AddWidget(this, el, ctx.sourcePath));
    });
    this.registerMarkdownCodeBlockProcessor("t-list", (src, el, ctx) => {
      ctx.addChild(new ListWidget(this, el, src));
    });
    // t-time is both the storage for a task's sessions and its on-page timer
    // controls. The source is not parsed here — sessions are read from the
    // file by the store — so the widget only needs the containing file's path.
    this.registerMarkdownCodeBlockProcessor("t-time", (_src, el, ctx) => {
      ctx.addChild(new TimeWidget(this, el, ctx.sourcePath));
    });

    // Create a task from the palette. Defaults the parent to the active file's
    // task (if any), matching the inline t-add auto-parenting.
    this.addCommand({
      id: "create-task",
      name: "Create task",
      callback: () => void this.openCreateTask(),
    });

    // Create a child of the current task. Only available when the active file
    // is a task (checkCallback gates visibility synchronously by path).
    this.addCommand({
      id: "create-child-of-current-task",
      name: "Create child of current task",
      checkCallback: (checking) => {
        if (!this.activeTaskFilePath()) return false;
        if (!checking) void this.openCreateTask();
        return true;
      },
    });

    // Task-scoped quick switcher. No checkCallback: it's meant to be reachable
    // from anywhere in the vault, which is the point of it.
    this.addCommand({
      id: "search-tasks",
      name: "Search tasks",
      callback: () => void this.openTaskSearch(),
    });

    this.addCommand({
      id: "copy-task-tree",
      name: "Copy task tree",
      checkCallback: (checking) => {
        if (!this.activeTaskFilePath()) return false;
        if (!checking) void this.openCopyTask();
        return true;
      },
    });

    // Canvas command. The id is kept from when this was "import task tree to
    // canvas" so existing hotkeys keep working.
    this.addCommand({
      id: "import-task-tree-to-canvas",
      name: "Open task canvas",
      callback: () => void this.runCanvasImport(),
    });

    // Turn the active canvas back into tasks. Gated on the active view being a
    // canvas file, so it stays out of the palette everywhere else.
    this.addCommand({
      id: "digest-canvas",
      name: "Digest canvas into tasks",
      checkCallback: (checking) => {
        const file = this.activeCanvasFile();
        if (!file) return false;
        if (!checking) void this.runDigest(file);
        return true;
      },
    });

    // Scan recurring tasks and reset any whose cadence has elapsed.
    this.addCommand({
      id: "load-tasks",
      name: "Load tasks (process recurring)",
      callback: () => void this.runProcessRecurring(true),
    });

    // Inline `/t` task-reference autocomplete. Registered unconditionally; the
    // enable setting is checked in onTrigger so toggling it needs no reload.
    this.registerEditorSuggest(new TaskLinkSuggest(this));

    this.addSettingTab(new FiloSettingTab(this.app, this));

    // Keep the in-file start/stop timer button and the status bar in sync: when
    // files open, when the active leaf changes, on layout changes, and whenever
    // task data changes (so e.g. starting one timer flips the buttons on others
    // and updates the current-task indicator).
    this.registerEvent(this.app.workspace.on("file-open", (f) => void this.onFileOpen(f)));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshFileUI()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshFileUI()));
    this.register(
      this.store.subscribe(() => {
        this.refreshFileUI();
        void this.status.update();
      })
    );
    // Tick the live elapsed time on the status bar once per second.
    this.registerInterval(window.setInterval(() => this.status.tick(), 1000));

    this.app.workspace.onLayoutReady(() => {
      this.refreshFileUI();
      void this.status.update();
      if (this.settings.processRecurringOnLoad) void this.runProcessRecurring(false);
    });
  }

  /**
   * Reset due recurring tasks. `announce` controls whether a Notice is shown
   * (true for the explicit command and the t-list button, false for the silent
   * on-load pass).
   */
  async runProcessRecurring(announce: boolean): Promise<void> {
    try {
      const count = await this.store.processRecurring();
      if (announce) {
        new Notice(
          count > 0
            ? `Filo: reset ${count} recurring task${count === 1 ? "" : "s"}`
            : "Filo: no recurring tasks due"
        );
      }
    } catch (e) {
      console.error("[Filo] processRecurring failed", e);
      if (announce) new Notice("Filo: failed to process recurring tasks");
    }
  }

  onunload(): void {
    this.fileTimer?.destroy();
    this.parentBanner?.destroy();
    this.canvasActions?.destroy();
  }

  /**
   * Re-sync the per-view task UI: the note's header buttons and parent banner,
   * and the digest button on canvas views.
   */
  private refreshFileUI(): void {
    void this.fileTimer.update();
    void this.parentBanner.update();
    void this.canvasActions.update();
  }

  /** Track the last opened task file (for the status-bar fallback) and refresh UI. */
  private async onFileOpen(file: TFile | null): Promise<void> {
    this.refreshFileUI();
    if (file instanceof TFile && file.extension === "md") {
      const folder = normalizePath(this.settings.tasksFolder || "tasks");
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
  currentTaskId(): string | null {
    return this.activeTaskId ?? this.lastTaskId;
  }

  /**
   * Create a task, then open it if it was created as a child of the task whose
   * file is currently active — i.e. "created from the current task". Other
   * creation paths (e.g. the t-list + button used from a dashboard) leave the
   * current view untouched.
   */
  async createTask(input: TaskInput): Promise<Task> {
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
  async openTaskFile(task: Task): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
  }

  /** Active file's path if it's a markdown file inside the tasks folder, else null. */
  private activeTaskFilePath(): string | null {
    const f = this.app.workspace.getActiveFile();
    if (!(f instanceof TFile) || f.extension !== "md") return null;
    const folder = normalizePath(this.settings.tasksFolder || "tasks");
    return f.path.startsWith(folder + "/") ? f.path : null;
  }

  /** Open the task-scoped search dialog. */
  private async openTaskSearch(): Promise<void> {
    const tasks = await this.store.listTasks();
    if (!tasks.length) {
      new Notice("Filo: no tasks to search.");
      return;
    }
    new TaskSearchModal(this.app, this, tasks).open();
  }

  /** Open the copy dialog for the task whose file is active. */
  private async openCopyTask(): Promise<void> {
    const path = this.activeTaskFilePath();
    if (!path) return;
    const task = (await this.store.listTasks()).find((t) => t.path === path);
    if (!task) return;
    const count = (await this.store.getSubtree(task.id)).length;
    new CopyTaskModal(this.app, this, task, count).open();
  }

  /** Open the create-task modal, defaulting the parent to the active task (if any). */
  private async openCreateTask(): Promise<void> {
    const path = this.activeTaskFilePath();
    let parentId: string | null = null;
    if (path) {
      const tasks = await this.store.listTasks();
      parentId = tasks.find((t) => t.path === path)?.id ?? null;
    }
    new CreateTaskModal(this.app, this, parentId).open();
  }

  /** The active view's file when it's a canvas, else null. */
  private activeCanvasFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    const file = this.app.workspace.getActiveFile();
    if (!view || view.getViewType() !== "canvas") return null;
    return file instanceof TFile && file.extension === "canvas" ? file : null;
  }

  private async runDigest(file: TFile): Promise<void> {
    try {
      await digestCanvas(this, file);
    } catch (e) {
      console.error("[Filo] canvas digest failed", e);
      new Notice("Filo: failed to digest canvas");
    }
  }

  private async runCanvasImport(): Promise<void> {
    // If invoked from inside a task file, open that task's tree; `openTaskCanvas`
    // resolves the root, so any task in the tree gets the same canvas.
    const active = this.app.workspace.getActiveFile();
    const tasks = await this.store.listTasks();
    let taskId: string | null = null;
    if (active instanceof TFile) {
      taskId = tasks.find((t) => t.path === active.path)?.id ?? null;
    }

    if (taskId) {
      await openTaskCanvas(this, taskId);
      return;
    }
    if (!tasks.length) {
      new Notice("Filo: no tasks to import.");
      return;
    }
    // Otherwise prompt to pick a task.
    new TaskPickerModal(this.app, tasks, (t) => void openTaskCanvas(this, t.id)).open();
  }

  // --- FiloDataAccess (consumed by TaskStore) ------------------------------

  getTasksFolder(): string {
    return this.settings.tasksFolder;
  }
  getTimerCapMs(): number {
    return this.settings.timerCapHours * 3_600_000;
  }
  getActiveTaskId(): string | null {
    return this.activeTaskId;
  }
  async setActiveTaskId(id: string | null): Promise<void> {
    this.activeTaskId = id;
    await this.persist();

    // Every stop path funnels through here — the note's timer button, the
    // `t-time` and `t-list` widgets, and the implicit stop when another task's
    // timer starts — so it's the one place a Slack clear has to be wired in.
    // Deliberately NOT awaited: stopping a timer shouldn't block on a network
    // round-trip, and `clearSlackStatus` reports its own failures.
    if (id === null) void clearSlackStatus(this);
  }

  /** Record (and persist) what Filo last pushed to Slack; null = nothing of ours. */
  async setSlackStatusText(text: string | null): Promise<void> {
    this.slackStatusText = text;
    await this.persist();
  }

  // --- persistence ---------------------------------------------------------

  private async loadFiloData(): Promise<void> {
    const data = (await this.loadData()) as Partial<FiloData> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
    this.activeTaskId = data?.activeTaskId ?? null;
    this.lastTaskId = data?.lastTaskId ?? null;
    this.slackStatusText = data?.slackStatusText ?? null;
  }

  private async persist(): Promise<void> {
    const data: FiloData = {
      settings: this.settings,
      activeTaskId: this.activeTaskId,
      lastTaskId: this.lastTaskId,
      slackStatusText: this.slackStatusText,
    };
    await this.saveData(data);
  }

  async saveSettings(): Promise<void> {
    await this.persist();
    // Folder/cap may have changed; drop the cache and re-render.
    this.store?.invalidate();
  }
}
