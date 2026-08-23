import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { Task, TaskInput } from "./types";
import { DEFAULT_SETTINGS, FiloSettings, FiloSettingTab } from "./settings";
import { FiloDataAccess, TaskStore } from "./store/TaskStore";
import { AddWidget } from "./processors/addProcessor";
import { ListWidget } from "./processors/listProcessor";
import { TimeWidget } from "./processors/timeProcessor";
import { CreateTaskModal } from "./processors/createTaskModal";
import { FileTimerManager } from "./ui/fileTimerButton";
import { CurrentTaskStatus } from "./ui/statusBar";
import { TaskLinkSuggest } from "./ui/taskSuggest";
import { ParentBannerManager } from "./ui/parentBanner";
import { TaskPickerModal, importTaskTreeToCanvas } from "./canvas/canvasImport";

/** Shape persisted via loadData/saveData. */
interface FiloData {
  settings: FiloSettings;
  /** Id of the single globally-active timer; null when none. Survives reloads. */
  activeTaskId: string | null;
  /** Last task file opened; the "current task" fallback when no timer runs. */
  lastTaskId: string | null;
}

export default class FiloPlugin extends Plugin implements FiloDataAccess {
  settings!: FiloSettings;
  store!: TaskStore;
  private activeTaskId: string | null = null;
  private lastTaskId: string | null = null;
  private fileTimer!: FileTimerManager;
  private parentBanner!: ParentBannerManager;
  private status!: CurrentTaskStatus;

  async onload(): Promise<void> {
    await this.loadFiloData();

    this.store = new TaskStore(this.app, this);
    this.fileTimer = new FileTimerManager(this);
    this.parentBanner = new ParentBannerManager(this);
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

    // Canvas import command.
    this.addCommand({
      id: "import-task-tree-to-canvas",
      name: "Import task tree to canvas",
      callback: () => void this.runCanvasImport(),
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
   * (true for the explicit command, false for the silent on-load pass).
   */
  private async runProcessRecurring(announce: boolean): Promise<void> {
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
  }

  /** Re-sync the per-note task UI (header timer/nav buttons and parent banner). */
  private refreshFileUI(): void {
    void this.fileTimer.update();
    void this.parentBanner.update();
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

  private async runCanvasImport(): Promise<void> {
    // If invoked from inside a task file, use that task as the root.
    const active = this.app.workspace.getActiveFile();
    const tasks = await this.store.listTasks();
    let rootId: string | null = null;
    if (active instanceof TFile) {
      rootId = tasks.find((t) => t.path === active.path)?.id ?? null;
    }

    if (rootId) {
      await importTaskTreeToCanvas(this, rootId);
      return;
    }
    if (!tasks.length) {
      new Notice("Filo: no tasks to import.");
      return;
    }
    // Otherwise prompt to pick a root task.
    new TaskPickerModal(this.app, tasks, (t) => void importTaskTreeToCanvas(this, t.id)).open();
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
  }

  // --- persistence ---------------------------------------------------------

  private async loadFiloData(): Promise<void> {
    const data = (await this.loadData()) as Partial<FiloData> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
    this.activeTaskId = data?.activeTaskId ?? null;
    this.lastTaskId = data?.lastTaskId ?? null;
  }

  private async persist(): Promise<void> {
    const data: FiloData = {
      settings: this.settings,
      activeTaskId: this.activeTaskId,
      lastTaskId: this.lastTaskId,
    };
    await this.saveData(data);
  }

  async saveSettings(): Promise<void> {
    await this.persist();
    // Folder/cap may have changed; drop the cache and re-render.
    this.store?.invalidate();
  }
}
