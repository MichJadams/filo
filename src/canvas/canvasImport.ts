import { App, FuzzySuggestModal, Notice, TFile, normalizePath } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import { computeTotal } from "../store/timeBlock";

// --- Canvas JSON shapes (the subset we read/write) -------------------------

interface CanvasNode {
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
interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  [k: string]: unknown;
}
interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// --- Layout constants ------------------------------------------------------
const NODE_W = 260;
const NODE_H = 80;
const H_GAP = 120; // horizontal gap between depth columns
const V_GAP = 40; // vertical gap between siblings

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

/**
 * Build/refresh a Canvas for the subtree rooted at `rootId`.
 *
 * Merge strategy when the canvas already exists:
 *  - nodes are matched to tasks by id (canvas node id === task id);
 *  - matched nodes KEEP their existing x/y (manual positions are preserved);
 *    only their color and file path are refreshed;
 *  - brand-new task nodes are auto-laid-out (depth -> x, slot -> y);
 *  - task nodes whose task is no longer in the subtree are removed;
 *  - any foreign nodes/edges (ids not starting with "t-"/"e-t-") are left
 *    untouched, so user-added canvas content survives.
 */
export async function importTaskTreeToCanvas(
  plugin: FiloPlugin,
  rootId: string
): Promise<void> {
  const store = plugin.store;
  const nodes = await store.getSubtree(rootId);
  if (!nodes.length) {
    new Notice("Filo: no task found to import.");
    return;
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

  // Resolve target path (deterministic by root id so re-runs find this file).
  const folder = normalizePath(plugin.settings.canvasFolder || "");
  const canvasPath = folder ? `${folder}/${rootId}.canvas` : `${rootId}.canvas`;
  if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
    await plugin.app.vault.createFolder(folder).catch(() => {});
  }

  // Load existing canvas, if any.
  let existing: CanvasData = { nodes: [], edges: [] };
  const existingFile = plugin.app.vault.getAbstractFileByPath(canvasPath);
  if (existingFile instanceof TFile) {
    try {
      existing = JSON.parse(await plugin.app.vault.read(existingFile)) as CanvasData;
      if (!Array.isArray(existing.nodes)) existing.nodes = [];
      if (!Array.isArray(existing.edges)) existing.edges = [];
    } catch {
      existing = { nodes: [], edges: [] };
    }
  }

  const prevById = new Map(existing.nodes.map((n) => [n.id, n]));
  const taskIds = new Set(nodes.map((n) => n.task.id));

  // For auto-layout of NEW nodes: seed each depth's slot counter with the
  // number of already-placed (reused) nodes at that depth so new ones stack
  // below them instead of overlapping.
  const slot: Record<number, number> = {};
  for (const n of nodes) {
    if (prevById.has(n.task.id)) slot[n.depth] = (slot[n.depth] ?? 0) + 1;
  }

  const taskNodes: CanvasNode[] = nodes.map((n) => {
    const prev = prevById.get(n.task.id);
    const color = colorForTime(times.get(n.task.id) ?? 0, maxMs, plugin.settings.rednessMode);

    let x: number;
    let y: number;
    if (prev) {
      // PRESERVE the user's manual position.
      x = prev.x;
      y = prev.y;
    } else {
      x = n.depth * (NODE_W + H_GAP);
      const i = slot[n.depth] ?? 0;
      slot[n.depth] = i + 1;
      y = i * (NODE_H + V_GAP);
    }

    const node: CanvasNode = {
      ...(prev ?? {}),
      id: n.task.id,
      type: "file",
      file: n.task.path, // refresh in case the file moved
      x,
      y,
      width: prev?.width ?? NODE_W,
      height: prev?.height ?? NODE_H,
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
        fromSide: "right",
        toSide: "left",
      });
    }
  }
  const foreignEdges = existing.edges.filter((e) => !String(e.id).startsWith("e-t-"));

  const out: CanvasData = {
    nodes: [...foreignNodes, ...taskNodes],
    edges: [...foreignEdges, ...taskEdges],
  };
  const json = JSON.stringify(out, null, 2);

  if (existingFile instanceof TFile) {
    await plugin.app.vault.modify(existingFile, json);
    new Notice(`Filo: updated canvas (${taskNodes.length} tasks).`);
  } else {
    await plugin.app.vault.create(canvasPath, json);
    new Notice(`Filo: created canvas (${taskNodes.length} tasks).`);
  }
}

/** Fuzzy picker used when the command is invoked outside a task file. */
export class TaskPickerModal extends FuzzySuggestModal<Task> {
  private tasks: Task[];
  private onChoose: (task: Task) => void;

  constructor(app: App, tasks: Task[], onChoose: (task: Task) => void) {
    super(app);
    this.tasks = tasks;
    this.onChoose = onChoose;
    this.setPlaceholder("Pick the root task to import…");
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
