import { Notice, TFile, normalizePath } from "obsidian";
import type FiloPlugin from "../main";
import { Task, isClosed } from "../types";
import {
  CanvasData,
  CanvasEdge,
  CanvasNode,
  H_GAP,
  NODE_H,
  NODE_W,
  Point,
  STATUS_COLOR,
  V_GAP,
  overlaps,
  readCanvas,
  revealCanvas,
  rootsCanvasPath,
  sizeFor,
} from "./canvasImport";

/** Cards per row in the generated grid. */
const COLS = 4;

/** Is this the root tasks board? */
export function isRootsCanvas(plugin: FiloPlugin, file: TFile): boolean {
  return file.path === rootsCanvasPath(plugin);
}

/**
 * The tasks the board shows: **open roots** — no parent, and not finished.
 *
 * A task whose `parent` points at an id no task has is treated as a root too;
 * it's unreachable from any tree, so the roots board is the only place it would
 * ever show up.
 */
export function openRoots(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((t) => (!t.parent || !byId.has(t.parent)) && !isClosed(t.status));
}

/**
 * Build (or refresh) the **root tasks board**: one card per open root task,
 * laid out in a grid, with no edges of Filo's own since roots have no parents
 * to draw to.
 *
 * It is a *view*, rebuilt from the tree on every open, which is the whole point
 * — group two roots under a third with the digest and they stop being roots, so
 * the next open drops their cards and leaves the new parent. Equally, a root
 * that gets marked done or won't-do drops off.
 *
 * What survives a rebuild:
 *  - **positions and sizes** of cards you moved, matched by task id;
 *  - **foreign nodes and edges** — the text cards and arrows you draw to group
 *    things, which is how the board is used before a digest turns them real.
 *
 * What doesn't: cards for tasks that are no longer open roots, and any edge
 * left dangling by their removal.
 */
export async function buildRootsCanvas(plugin: FiloPlugin): Promise<TFile | null> {
  const app = plugin.app;
  const roots = openRoots(await plugin.store.listTasks());

  const folder = normalizePath(plugin.settings.canvasFolder || "");
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder).catch(() => {});
  }

  const path = rootsCanvasPath(plugin);
  const existingFile = app.vault.getAbstractFileByPath(path);
  const existing: CanvasData =
    existingFile instanceof TFile
      ? await readCanvas(app, existingFile)
      : { nodes: [], edges: [] };

  const prevById = new Map(existing.nodes.map((n) => [n.id, n]));

  // Slots already spoken for, so a new card isn't dropped on one you moved.
  const taken: Point[] = roots
    .map((t) => prevById.get(t.id))
    .filter((p): p is CanvasNode => !!p)
    .map((p) => ({ x: p.x, y: p.y }));

  const taskNodes: CanvasNode[] = roots.map((task, i) => {
    const prev = prevById.get(task.id);

    let at: Point;
    if (prev) {
      at = { x: prev.x, y: prev.y }; // PRESERVE the manual position
    } else {
      at = {
        x: (i % COLS) * (NODE_W + H_GAP),
        y: Math.floor(i / COLS) * (NODE_H + V_GAP),
      };
      while (taken.some((t) => overlaps(at, t))) at = { x: at.x, y: at.y + NODE_H + V_GAP };
      taken.push(at);
    }

    const node: CanvasNode = {
      ...(prev ?? {}),
      id: task.id,
      type: "file",
      file: task.path, // refresh in case the note moved
      x: at.x,
      y: at.y,
      ...sizeFor(prev),
    };
    const color = STATUS_COLOR[task.status];
    if (color) node.color = color;
    else delete node.color;
    return node;
  });

  // Keep whatever the user drew; drop task cards that are no longer open roots.
  const foreignNodes = existing.nodes.filter((n) => !String(n.id).startsWith("t-"));
  const outNodes = [...foreignNodes, ...taskNodes];

  // Any edge whose endpoints didn't both survive would point at nothing. That
  // is exactly what happens to the arrow you drew to group two roots: the digest
  // consumes it, the children stop being roots, and their cards go — so the edge
  // has to go with them rather than dangle.
  const present = new Set(outNodes.map((n) => String(n.id)));
  const outEdges: CanvasEdge[] = existing.edges.filter(
    (e) => present.has(String(e.fromNode)) && present.has(String(e.toNode))
  );

  const json = JSON.stringify({ nodes: outNodes, edges: outEdges }, null, 2);
  if (existingFile instanceof TFile) {
    await app.vault.modify(existingFile, json);
    return existingFile;
  }
  return app.vault.create(path, json);
}

/** Refresh the root tasks board and show it — what the command and ribbon do. */
export async function openRootsCanvas(plugin: FiloPlugin): Promise<void> {
  const file = await buildRootsCanvas(plugin);
  if (!file) {
    new Notice("Filo: could not build the root tasks board.");
    return;
  }
  await revealCanvas(plugin, file);
}
