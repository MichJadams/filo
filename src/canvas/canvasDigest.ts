import { Notice, TFile } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";
import {
  CanvasEdge,
  CanvasNode,
  TASK_EDGE_PREFIX,
  importTaskTreeToCanvas,
  readCanvas,
  revealCanvas,
} from "./canvasImport";

/**
 * Turning a canvas back into tasks — the inverse of `importTaskTreeToCanvas`,
 * so a board can be *edited* rather than only viewed.
 *
 * A digest reads the canvas as it stands and makes the task tree match it:
 *  - **text cards become tasks** (first line the title, the rest the body);
 *  - **note cards are adopted** — Filo frontmatter merged in, then renamed to
 *    `<tasksFolder>/<id>.md` like any other task;
 *  - **edges become parenthood**: a card hanging off another is that task's
 *    child, and re-drawing an edge between two existing tasks reparents them;
 *  - a new card with nothing pointing at it becomes a child of the **canvas
 *    root** (the task the canvas was built from).
 *
 * Then the canvas is rebuilt from the resulting tree, so what you see is the
 * real hierarchy — new cards land as proper task notes, right where you put
 * them, linked to their parent.
 *
 * Deletions are deliberately NOT mirrored: removing a card leaves the task
 * alone (and the rebuild puts the card back). Deleting task files from a canvas
 * gesture is too easy to do by accident.
 */

/** What a card should become, once digested. */
interface CardSource {
  title: string;
  /** Body for a text card; empty for a note card. */
  body: string;
  /** Set when the card points at an existing note, which is adopted in place. */
  file?: TFile;
}

/** Cards Filo will not touch: groups, web links, images, PDFs, and blanks. */
function sourceFor(plugin: FiloPlugin, node: CanvasNode): CardSource | null {
  if (node.type === "text") {
    const { title, body } = splitCardText(String(node.text ?? ""));
    return title ? { title, body } : null;
  }
  if (node.type === "file") {
    const f = plugin.app.vault.getAbstractFileByPath(String(node.file ?? ""));
    if (!(f instanceof TFile) || f.extension !== "md") return null;
    return { title: f.basename, body: "", file: f };
  }
  return null;
}

/**
 * Split a card's text into a task title and body: the first non-empty line,
 * stripped of the markdown that makes it a heading or a list item, then
 * everything after it.
 */
export function splitCardText(text: string): { title: string; body: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const i = lines.findIndex((l) => l.trim());
  if (i === -1) return { title: "", body: "" };

  const title = lines[i]
    .trim()
    .replace(/^#{1,6}\s+/, "") // heading
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "") // bullet, optionally a checkbox
    .trim();
  return { title, body: lines.slice(i + 1).join("\n").trim() };
}

/**
 * The task this canvas was built from: of the tasks on the board, the one with
 * no ancestor also on the board.
 *
 * This reads the task tree rather than the canvas edges, so a half-drawn edge
 * can't move the root out from under the digest. If the board holds several
 * disjoint branches, the one covering the most cards wins — the others are then
 * digested as its children, which is what "everything under this canvas" means.
 */
function findRootTaskId(present: string[], byId: Map<string, Task>): string | null {
  const onBoard = new Set(present);

  const isTop = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let parent = byId.get(id)?.parent ?? null;
    while (parent && !seen.has(parent)) {
      if (onBoard.has(parent)) return false;
      seen.add(parent);
      parent = byId.get(parent)?.parent ?? null;
    }
    return true;
  };

  const tops = present.filter(isTop);
  if (!tops.length) return present[0] ?? null; // every task on the board is in a cycle

  let best = tops[0];
  let bestReach = -1;
  for (const id of tops) {
    const reach = present.filter((p) => {
      const seen = new Set<string>();
      let cur: string | null = p;
      while (cur && !seen.has(cur)) {
        if (cur === id) return true;
        seen.add(cur);
        cur = byId.get(cur)?.parent ?? null;
      }
      return false;
    }).length;
    if (reach > bestReach) {
      best = id;
      bestReach = reach;
    }
  }
  return best;
}

/**
 * Flush the open view's in-memory board to disk before reading it. Obsidian
 * debounces canvas saves, so cards added seconds ago may not be in the file yet
 * — without this the digest would silently miss exactly the cards just drawn.
 */
async function flushCanvasView(plugin: FiloPlugin, file: TFile): Promise<void> {
  for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
    const view = leaf.view as unknown as { file?: TFile; save?: () => Promise<void> };
    if (view.file?.path === file.path) await view.save?.();
  }
}

export async function digestCanvas(plugin: FiloPlugin, file: TFile): Promise<void> {
  const app = plugin.app;
  await flushCanvasView(plugin, file);

  const canvas = await readCanvas(app, file);
  if (!canvas.nodes.length) {
    new Notice("Filo: this canvas is empty.");
    return;
  }

  const tasks = await plugin.store.listTasks();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const byPath = new Map(tasks.map((t) => [t.path, t]));

  // node id -> task id. Seeded with the cards that are already tasks: nodes Filo
  // generated (id === task id) and task notes dragged onto the board by hand
  // (matched by path), which is what lets those be re-parented rather than
  // adopted a second time.
  const taskIdOf = new Map<string, string>();
  for (const n of canvas.nodes) {
    if (byId.has(n.id)) {
      taskIdOf.set(n.id, n.id);
    } else if (n.type === "file") {
      const known = byPath.get(String(n.file ?? ""));
      if (known) taskIdOf.set(n.id, known.id);
    }
  }

  const rootTaskId = findRootTaskId(Array.from(new Set(taskIdOf.values())), byId);
  if (!rootTaskId) {
    new Notice("Filo: no Filo task on this canvas — open one from a task note first.");
    return;
  }

  // First edge into a card wins, so a card with two parents drawn at it still
  // resolves to one.
  const nodeById = new Map(canvas.nodes.map((n) => [n.id, n]));
  const parentNodeOf = new Map<string, string>();
  for (const e of canvas.edges) {
    if (!parentNodeOf.has(e.toNode)) parentNodeOf.set(e.toNode, e.fromNode);
  }

  /**
   * Resolve a card to a task id, creating the task if the card is new. Recurses
   * into the card's parent first, so a chain of new cards is created top-down
   * and each one's parent already exists. `resolving` breaks the recursion if
   * the user drew a loop, leaving that card to fall back to the root.
   */
  const resolving = new Set<string>();
  // Adopting renames the note, so a second card pointing at the same note would
  // find nothing at that path; it maps to the task the first card produced.
  const adoptedByPath = new Map<string, string>();
  let createdCount = 0;
  let adoptedCount = 0;

  const resolve = async (nodeId: string): Promise<string | null> => {
    const known = taskIdOf.get(nodeId);
    if (known) return known;
    if (resolving.has(nodeId)) return null;

    const node = nodeById.get(nodeId);
    if (!node) return null;
    const alreadyAdopted = node.type === "file" ? adoptedByPath.get(String(node.file)) : undefined;
    if (alreadyAdopted) {
      taskIdOf.set(nodeId, alreadyAdopted);
      return alreadyAdopted;
    }
    const source = sourceFor(plugin, node);
    if (!source) return null;

    resolving.add(nodeId);
    const parentNode = parentNodeOf.get(nodeId);
    const parentId = (parentNode ? await resolve(parentNode) : null) ?? rootTaskId;
    resolving.delete(nodeId);

    let task: Task;
    if (source.file) {
      const from = source.file.path;
      task = await plugin.store.adoptFile(source.file, {
        title: source.title,
        parent: parentId,
      });
      adoptedByPath.set(from, task.id);
      adoptedCount++;
    } else {
      task = await plugin.store.createTask({
        title: source.title,
        body: source.body,
        parent: parentId,
      });
      createdCount++;
    }
    taskIdOf.set(nodeId, task.id);
    return task.id;
  };

  for (const n of canvas.nodes) await resolve(n.id);

  // Edges between cards that were ALREADY tasks are the reparent gesture: drag
  // a card under a different one and the frontmatter follows. Cards created
  // above got their parent at creation, so they're skipped here.
  let reparented = 0;
  let refused = 0;
  for (const e of canvas.edges) {
    const childId = taskIdOf.get(e.toNode);
    const parentId = taskIdOf.get(e.fromNode);
    if (!childId || !parentId || childId === parentId) continue;

    const child = byId.get(childId);
    if (!child || child.parent === parentId) continue;

    // Re-parenting a task under its own descendant would orphan the branch from
    // the tree; refuse rather than write a cycle into frontmatter.
    const descendants = await plugin.store.getSubtree(childId);
    if (descendants.some((d) => d.task.id === parentId)) {
      refused++;
      continue;
    }
    await plugin.store.updateTask(childId, { parent: parentId });
    reparented++;
  }

  if (!createdCount && !adoptedCount && !reparented) {
    new Notice(
      refused
        ? "Filo: nothing to digest (an edge would have made a task its own ancestor)."
        : "Filo: nothing new on this canvas."
    );
    // Still rebuild: the tree may have changed elsewhere since this board was
    // last opened.
    await rebuild(plugin, rootTaskId, file);
    return;
  }

  await writeDigestedCanvas(plugin, file, canvas.nodes, canvas.edges, taskIdOf);
  await rebuild(plugin, rootTaskId, file);

  const parts: string[] = [];
  if (createdCount) parts.push(`${createdCount} created`);
  if (adoptedCount) parts.push(`${adoptedCount} adopted`);
  if (reparented) parts.push(`${reparented} re-parented`);
  if (refused) parts.push(`${refused} skipped (would loop)`);
  new Notice(`Filo: digested canvas — ${parts.join(", ")}.`);
}

/**
 * Rewrite the canvas so every digested card is now the task node for what it
 * became — keeping the card exactly where the user dropped it, since the
 * rebuild preserves positions by node id.
 */
async function writeDigestedCanvas(
  plugin: FiloPlugin,
  file: TFile,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  taskIdOf: Map<string, string>
): Promise<void> {
  const tasks = await plugin.store.listTasks();
  const pathById = new Map(tasks.map((t) => [t.id, t.path]));

  const outNodes = nodes.map((node) => {
    const taskId = taskIdOf.get(node.id);
    const path = taskId ? pathById.get(taskId) : undefined;
    if (!taskId || taskId === node.id || !path) return node;
    const { text, ...rest } = node;
    return { ...rest, id: taskId, type: "file", file: path };
  });

  const taskNodeIds = new Set(taskIdOf.values());
  const outEdges = edges
    .map((e) => ({
      ...e,
      fromNode: taskIdOf.get(e.fromNode) ?? e.fromNode,
      toNode: taskIdOf.get(e.toNode) ?? e.toNode,
    }))
    // An edge the digest just consumed is replaced by the canonical
    // `e-t-<parent>-<child>` the rebuild writes; keeping it would double the
    // line on screen.
    .filter((e) => !(taskNodeIds.has(e.fromNode) && taskNodeIds.has(e.toNode)))
    .filter((e) => !String(e.id).startsWith(TASK_EDGE_PREFIX));

  await plugin.app.vault.modify(
    file,
    JSON.stringify({ nodes: outNodes, edges: outEdges }, null, 2)
  );
}

/** Re-run the normal build over the same file, then show the result. */
async function rebuild(plugin: FiloPlugin, rootTaskId: string, file: TFile): Promise<void> {
  const out = await importTaskTreeToCanvas(plugin, rootTaskId, file);
  if (out) await revealCanvas(plugin, out);
}
