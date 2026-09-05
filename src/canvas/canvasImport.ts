import {
  App,
  FuzzySuggestModal,
  Notice,
  TFile,
  WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import type FiloPlugin from "../main";
import { SubtreeNode, Task } from "../types";
import { computeTotal } from "../store/timeBlock";

// --- Canvas JSON shapes (the subset we read/write) -------------------------

export interface CanvasNode {
  id: string;
  type: string;
  file?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  [k: string]: unknown; // preserve any other fields Obsidian wrote
}
export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  [k: string]: unknown;
}
export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// --- Layout constants ------------------------------------------------------

/**
 * Card size, in canvas pixels. Sized to fit roughly 80 characters across and
 * the same measure down — big enough to read a task note at a glance — using
 * ~8px per character at the canvas's default font.
 */
const NODE_W = 640;
const NODE_H = 640;

/** Card sizes Filo itself used to generate; see `sizeFor`. */
const LEGACY_SIZES: Array<[number, number]> = [[260, 80]];

const H_GAP = 80; // horizontal gap between siblings
const V_GAP = 140; // vertical gap between depth rows

/**
 * Obsidian Canvas node colors only support the preset palette "1".."6"; there
 * is NO arbitrary hex. The presets are:
 *   1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 purple.
 * To approximate a "cold -> hot" gradient we exploit their rainbow ordering:
 *   purple(6) -> cyan(5) -> green(4) -> yellow(3) -> orange(2) -> red(1).
 * So the most tracked time maps to "1" (red) and the least to "6" (purple).
 * This is a documented approximation, not a true continuous gradient.
 */
const HEAT_RAMP = ["6", "5", "4", "3", "2", "1"];

// Absolute-mode hour thresholds: each crossed threshold bumps to the next
// (hotter) bucket. 6 buckets -> indices 0..5 into HEAT_RAMP.
const ABS_THRESHOLDS_HOURS = [0.25, 1, 2, 4, 8];

function colorForTime(
  ms: number,
  maxMs: number,
  mode: "relative" | "absolute"
): string | undefined {
  if (ms <= 0) return undefined; // untracked -> leave uncolored

  if (mode === "absolute") {
    const hours = ms / 3_600_000;
    let bucket = 0;
    for (const t of ABS_THRESHOLDS_HOURS) if (hours >= t) bucket++;
    return HEAT_RAMP[Math.min(bucket, HEAT_RAMP.length - 1)];
  }

  // relative: normalize to the longest task in this subtree.
  if (maxMs <= 0) return undefined;
  const r = ms / maxMs; // 0..1
  const idx = Math.min(HEAT_RAMP.length - 1, Math.floor(r * HEAT_RAMP.length));
  return HEAT_RAMP[idx];
}

// --- Layout -----------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

/**
 * Position every task in the subtree as an inverted tree: the root on top, each
 * generation in a row beneath the last (**depth → y**), and every parent
 * centered over the span of its children.
 *
 * Leaves are laid out left to right in the order `getSubtree` walked them, so
 * sibling order on the canvas matches sibling order in the tree.
 */
function layoutTree(nodes: SubtreeNode[]): Map<string, Point> {
  const childIds = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.task.parent) continue;
    const siblings = childIds.get(n.task.parent) ?? [];
    siblings.push(n.task.id);
    childIds.set(n.task.parent, siblings);
  }

  const pos = new Map<string, Point>();
  const placed = new Set<string>(); // guards against a parent cycle recursing forever
  let nextLeafX = 0;

  /** Place `id` and its descendants; returns the x the node was centered on. */
  const place = (id: string, depth: number): number => {
    placed.add(id);
    const kids = (childIds.get(id) ?? []).filter((k) => !placed.has(k));

    let x: number;
    if (!kids.length) {
      x = nextLeafX;
      nextLeafX += NODE_W + H_GAP;
    } else {
      const kidXs = kids.map((k) => place(k, depth + 1));
      x = (kidXs[0] + kidXs[kidXs.length - 1]) / 2;
    }

    pos.set(id, { x, y: depth * (NODE_H + V_GAP) });
    return x;
  };

  place(nodes[0].task.id, 0);
  return pos;
}

/** Do two cards overlap? Touching edges don't count. */
function overlaps(a: Point, b: Point): boolean {
  return (
    a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H
  );
}

/** Is this node still at a card size an older Filo generated? */
function isLegacySize(node: CanvasNode): boolean {
  return LEGACY_SIZES.some(([w, h]) => node.width === w && node.height === h);
}

/**
 * The card size to write. Nodes still at a size Filo generated are bumped to the
 * current default (so an old canvas picks up the bigger cards), while anything
 * the user resized by hand is left as-is.
 */
function sizeFor(prev: CanvasNode | undefined): { width: number; height: number } {
  if (!prev || prev.width === undefined || prev.height === undefined || isLegacySize(prev)) {
    return { width: NODE_W, height: NODE_H };
  }
  return { width: prev.width, height: prev.height };
}

// --- Canvas file naming ----------------------------------------------------

/** Prefix of every edge id Filo generates, i.e. the ones it owns and rebuilds. */
export const TASK_EDGE_PREFIX = "e-t-";

/**
 * Parse a `.canvas` file. A canvas Filo can't read is treated as empty rather
 * than throwing, so one malformed file can't break a scan across many.
 */
export async function readCanvas(app: App, file: TFile): Promise<CanvasData> {
  try {
    const data = JSON.parse(await app.vault.read(file)) as Partial<CanvasData>;
    return {
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      edges: Array.isArray(data.edges) ? data.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

/**
 * True when `file` is the canvas *rooted at* `rootId`, as opposed to one that
 * merely contains that task as a child node.
 *
 * Every generated parent→child edge is `e-<parent>-<child>`, so the root is the
 * one task node with no incoming task edge. Without this test, a parent task's
 * canvas would be mistaken for its child's.
 */
async function isCanvasRootedAt(app: App, file: TFile, rootId: string): Promise<boolean> {
  const data = await readCanvas(app, file);
  if (!data.nodes.some((n) => n.id === rootId)) return false;
  return !data.edges.some(
    (e) => e.toNode === rootId && String(e.id).startsWith(TASK_EDGE_PREFIX)
  );
}

/**
 * Where the canvas for `root` lives: `<canvasFolder>/<rootId>.canvas`.
 *
 * Keyed on the **id**, the one thing about a task that never changes. That
 * makes the path a pure function of the tree's root: every task in a tree
 * resolves to the same board with no lookup, renaming a task can't move,
 * orphan or duplicate it, and two tasks sharing a title can't collide.
 *
 * The scan below is a one-time migration off the old title-based naming: a
 * canvas rooted at this task, wherever it sits in the folder, is moved onto the
 * id path so its hand-placed cards survive. Once moved, the direct hit above
 * wins and the scan never runs for that tree again.
 */
async function resolveCanvasPath(plugin: FiloPlugin, root: Task): Promise<string> {
  const app = plugin.app;
  const folder = normalizePath(plugin.settings.canvasFolder || "");
  const idPath = folder ? `${folder}/${root.id}.canvas` : `${root.id}.canvas`;

  if (app.vault.getAbstractFileByPath(idPath) instanceof TFile) return idPath;

  const prefix = folder ? folder + "/" : "";
  for (const f of app.vault.getFiles()) {
    if (f.extension !== "canvas") continue;
    if (!f.path.startsWith(prefix)) continue;
    if (f.path.slice(prefix.length).includes("/")) continue; // direct children only
    if (await isCanvasRootedAt(app, f, root.id)) {
      // The id path is free — the check above just missed it — so this can't
      // clobber anything.
      await app.fileManager.renameFile(f, idPath);
      return idPath;
    }
  }
  return idPath;
}

/**
 * Build/refresh a Canvas for the subtree rooted at `rootId`.
 *
 * Merge strategy when the canvas already exists:
 *  - nodes are matched to tasks by id (canvas node id === task id);
 *  - matched nodes KEEP their existing x/y (manual positions are preserved);
 *    only their color and file path are refreshed;
 *  - brand-new task nodes are auto-laid-out (root on top, depth -> y), and
 *    nudged down if their slot is occupied by a node the user had moved;
 *  - task nodes whose task is no longer in the subtree are removed;
 *  - any foreign nodes/edges (ids not starting with "t-"/"e-t-") are left
 *    untouched, so user-added canvas content survives.
 *
 * The file is named `<rootId>.canvas` (see `resolveCanvasPath`), and is returned
 * so callers can open it.
 */
export async function importTaskTreeToCanvas(
  plugin: FiloPlugin,
  rootId: string,
  target?: TFile
): Promise<TFile | null> {
  const store = plugin.store;
  const nodes = await store.getSubtree(rootId);
  if (!nodes.length) {
    new Notice("Filo: no task found to import.");
    return null;
  }

  const capMs = plugin.getTimerCapMs();

  // Tracked time per task + the subtree max (for relative coloring).
  const times = new Map<string, number>();
  let maxMs = 0;
  for (const n of nodes) {
    const ms = computeTotal(n.task.sessions, capMs).ms;
    times.set(n.task.id, ms);
    if (ms > maxMs) maxMs = ms;
  }

  // `target` pins the file (the digest refreshes the canvas it was run on);
  // otherwise the task's own canvas is resolved by title. The output folder has
  // to exist first, since resolving may rename an existing canvas into it.
  const folder = normalizePath(plugin.settings.canvasFolder || "");
  if (!target && folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
    await plugin.app.vault.createFolder(folder).catch(() => {});
  }
  const canvasPath = target ? target.path : await resolveCanvasPath(plugin, nodes[0].task);

  // Load existing canvas, if any.
  const existingFile = target ?? plugin.app.vault.getAbstractFileByPath(canvasPath);
  const existing: CanvasData =
    existingFile instanceof TFile
      ? await readCanvas(plugin.app, existingFile)
      : { nodes: [], edges: [] };

  const prevById = new Map(existing.nodes.map((n) => [n.id, n]));
  const taskIds = new Set(nodes.map((n) => n.task.id));

  // Ideal tree positions; normally only NEW nodes take theirs, since reused
  // nodes keep wherever the user dragged them.
  const ideal = layoutTree(nodes);

  // A canvas whose every task card is still at an old generated size was laid
  // out by an older Filo, for cards a fraction of today's. Those positions can't
  // survive the resize without piling the cards on top of each other, so the
  // whole board is laid out afresh — the one case where positions are dropped.
  const prevTaskNodes = nodes
    .map((n) => prevById.get(n.task.id))
    .filter((p): p is CanvasNode => !!p);
  const relayout = prevTaskNodes.length > 0 && prevTaskNodes.every(isLegacySize);

  // Every position already spoken for, so a new node isn't dropped on top of a
  // node that was moved out of its ideal slot.
  const taken: Point[] = relayout ? [] : prevTaskNodes.map((p) => ({ x: p.x, y: p.y }));

  const taskNodes: CanvasNode[] = nodes.map((n) => {
    const prev = prevById.get(n.task.id);
    const color = colorForTime(times.get(n.task.id) ?? 0, maxMs, plugin.settings.rednessMode);

    let at: Point;
    if (prev && !relayout) {
      // PRESERVE the user's manual position.
      at = { x: prev.x, y: prev.y };
    } else {
      at = ideal.get(n.task.id) ?? { x: 0, y: n.depth * (NODE_H + V_GAP) };
      // Slide down a row at a time until the card has the space to itself.
      while (taken.some((t) => overlaps(at, t))) at = { x: at.x, y: at.y + NODE_H + V_GAP };
      taken.push(at);
    }

    const node: CanvasNode = {
      ...(prev ?? {}),
      id: n.task.id,
      type: "file",
      file: n.task.path, // refresh in case the file moved
      x: at.x,
      y: at.y,
      ...sizeFor(prev),
    };
    if (color) node.color = color;
    else delete node.color;
    return node;
  });

  // Keep foreign nodes (anything not managed as a task node).
  const foreignNodes = existing.nodes.filter((nd) => !String(nd.id).startsWith("t-"));

  // Rebuild parent->child edges with deterministic ids (so re-runs dedupe).
  const taskEdges: CanvasEdge[] = [];
  for (const n of nodes) {
    if (n.task.parent && taskIds.has(n.task.parent)) {
      taskEdges.push({
        id: `e-${n.task.parent}-${n.task.id}`,
        fromNode: n.task.parent,
        toNode: n.task.id,
        fromSide: "bottom",
        toSide: "top",
      });
    }
  }
  const foreignEdges = existing.edges.filter((e) => !String(e.id).startsWith("e-t-"));

  const out: CanvasData = {
    nodes: [...foreignNodes, ...taskNodes],
    edges: [...foreignEdges, ...taskEdges],
  };
  const json = JSON.stringify(out, null, 2);

  // A pinned target means this is someone else's rebuild step (the digest);
  // that caller reports its own outcome, so stay quiet here.
  const announce = (msg: string) => {
    if (!target) new Notice(msg);
  };

  if (existingFile instanceof TFile) {
    await plugin.app.vault.modify(existingFile, json);
    announce(
      relayout
        ? `Filo: re-laid out canvas for the larger cards (${taskNodes.length} tasks).`
        : `Filo: updated canvas (${taskNodes.length} tasks).`
    );
    return existingFile;
  }
  const created = await plugin.app.vault.create(canvasPath, json);
  announce(`Filo: created canvas (${taskNodes.length} tasks).`);
  return created;
}

/**
 * Build/refresh the canvas for `taskId`'s tree and show it — what the note's
 * canvas button and the command both do.
 *
 * A tree gets ONE canvas, rooted at its outermost ancestor, so the button works
 * from any task in it: pressing it on a leaf task opens the same whole-tree
 * board as pressing it on the root. (The digest goes through
 * `importTaskTreeToCanvas` directly, since it rebuilds the canvas it was run on
 * rather than resolving one.)
 */
export async function openTaskCanvas(plugin: FiloPlugin, taskId: string): Promise<void> {
  const root = await plugin.store.getRoot(taskId);
  if (!root) {
    new Notice("Filo: no task found to import.");
    return;
  }
  const file = await importTaskTreeToCanvas(plugin, root.id);
  if (file) await revealCanvas(plugin, file);
}

/**
 * The leaf already showing `path`, if any.
 *
 * Read from the leaf's view *state* rather than `leaf.view.file`: Obsidian
 * defers restored tabs until they're first activated, and a deferred leaf has
 * no view file yet — going by the view alone would miss the open canvas and
 * open a duplicate tab beside it.
 */
function findCanvasLeaf(plugin: FiloPlugin, path: string): WorkspaceLeaf | null {
  for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
    const state = leaf.getViewState().state as { file?: unknown } | undefined;
    if (state?.file === path) return leaf;
  }
  return null;
}

/**
 * Focus the canvas, reusing a leaf that already has it open. Such a leaf holds
 * its own in-memory copy of the board, so it's reloaded to pick up what was
 * just written; otherwise the refresh would be invisible until the file was
 * reopened.
 *
 * The reload is a park-on-empty-then-reopen rather than `leaf.rebuildView()`:
 * that method is undocumented and blows up on canvas views, which surfaced as
 * "failed to open task canvas" every time the button was pressed for a board
 * that was already open.
 */
export async function revealCanvas(plugin: FiloPlugin, file: TFile): Promise<void> {
  const leaf = findCanvasLeaf(plugin, file.path);
  if (leaf) {
    await leaf.setViewState({ type: "empty" });
    await leaf.openFile(file);
    await plugin.app.workspace.revealLeaf(leaf);
    return;
  }
  // A new tab, so the task note the button was pressed from stays open.
  await plugin.app.workspace.getLeaf("tab").openFile(file);
}

/**
 * Fuzzy picker used when the command is invoked outside a task file. Any task
 * will do — `openTaskCanvas` climbs to the top of its tree.
 */
export class TaskPickerModal extends FuzzySuggestModal<Task> {
  private tasks: Task[];
  private onChoose: (task: Task) => void;

  constructor(app: App, tasks: Task[], onChoose: (task: Task) => void) {
    super(app);
    this.tasks = tasks;
    this.onChoose = onChoose;
    this.setPlaceholder("Pick a task to open the canvas for…");
  }

  getItems(): Task[] {
    return this.tasks;
  }
  getItemText(task: Task): string {
    return task.title;
  }
  onChooseItem(task: Task): void {
    this.onChoose(task);
  }
}
