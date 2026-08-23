export type TaskStatus = "undone" | "in-progress" | "done";

/**
 * One discrete tracked interval in a task's `t-time` block. `stop === null`
 * means the session is still running (serialized as `stop: running`).
 */
export interface TimeSession {
  start: string; // ISO timestamp
  stop: string | null; // ISO timestamp, or null while running
}

export interface Task {
  /** Stable random id. Source of truth for all relationships; never derived from the title. */
  id: string;
  title: string;
  status: TaskStatus;
  /** Single source of truth for the tree. Children are derived by scanning. */
  parent: string | null;
  due: string | null; // YYYY-MM-DD
  tags: string[];
  /** Ranking number, editable from a t-list row. New tasks start at 0. */
  priority: number;
  created: string; // ISO timestamp
  sessions: TimeSession[];
  /** Vault-relative path of the backing `<id>.md` file. */
  path: string;
  /** When true, the task is reset to `undone` on its `cadence`. */
  recurring: boolean;
  /** Cron expression driving resets (only meaningful when `recurring`). */
  cadence: string | null;
  /** ISO boundary of the period the task is currently in; advanced on each reset. */
  lastReset: string | null;
}

/** Fields accepted when creating a task. Everything else is generated. */
export interface TaskInput {
  title: string;
  status?: TaskStatus;
  parent?: string | null;
  due?: string | null;
  tags?: string[];
  /** Defaults to 0 when omitted. */
  priority?: number;
  body?: string;
  recurring?: boolean;
  cadence?: string | null;
}

/** Mutable fields accepted by updateTask. */
export interface TaskPatch {
  title?: string;
  status?: TaskStatus;
  parent?: string | null;
  due?: string | null;
  tags?: string[];
  priority?: number;
  recurring?: boolean;
  cadence?: string | null;
  lastReset?: string | null;
}

/** A node in a flattened subtree, carrying its depth from the root (root = 0). */
export interface SubtreeNode {
  task: Task;
  depth: number;
}
