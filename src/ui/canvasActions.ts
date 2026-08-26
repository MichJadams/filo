import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type FiloPlugin from "../main";
import { readCanvas } from "../canvas/canvasImport";
import { digestCanvas } from "../canvas/canvasDigest";

/** Per-leaf state. Rebuilt when a leaf swaps to a different canvas file. */
interface CanvasRecord {
  path: string;
  el: HTMLElement;
}

/**
 * Adds the **digest** button to the action bar of any Filo canvas: draw new
 * cards, hit it, and they become real tasks wired into the tree (see
 * `canvasDigest`).
 *
 * The button only appears on canvases that already hold a Filo task, since the
 * digest needs a root to hang new cards off — an unrelated canvas gets no
 * button at all.
 */
export class CanvasActionManager {
  private plugin: FiloPlugin;
  private records = new Map<WorkspaceLeaf, CanvasRecord>();
  /**
   * Whether a canvas is a Filo board, keyed by path and invalidated by mtime.
   * The check has to read the file, and this runs on every layout change, so
   * an unchanged canvas is answered from here.
   */
  private isFilo = new Map<string, { mtime: number; value: boolean }>();

  constructor(plugin: FiloPlugin) {
    this.plugin = plugin;
  }

  /** Re-sync the button across all open canvas leaves. */
  async update(): Promise<void> {
    const taskIds = new Set((await this.plugin.store.listTasks()).map((t) => t.id));

    const live = new Set<WorkspaceLeaf>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
      const view = leaf.view;
      const file = (view as unknown as { file?: TFile }).file;
      if (!(view instanceof ItemView) || !(file instanceof TFile)) continue;
      live.add(leaf);

      let rec = this.records.get(leaf);
      if (rec && rec.path !== file.path) {
        rec.el.remove();
        this.records.delete(leaf);
        rec = undefined;
      }
      if (!rec) {
        const el = view.addAction("sprout", "Filo: digest canvas into tasks", () =>
          void this.digest(file)
        );
        el.addClass("filo-canvas-digest");
        rec = { path: file.path, el };
        this.records.set(leaf, rec);
      }

      rec.el.style.display = (await this.isFiloCanvas(file, taskIds)) ? "" : "none";
    }

    for (const leaf of Array.from(this.records.keys())) {
      if (!live.has(leaf)) this.records.delete(leaf);
    }
  }

  private async isFiloCanvas(file: TFile, taskIds: Set<string>): Promise<boolean> {
    const hit = this.isFilo.get(file.path);
    if (hit && hit.mtime === file.stat.mtime) return hit.value;

    const canvas = await readCanvas(this.plugin.app, file);
    const value = canvas.nodes.some((n) => taskIds.has(n.id));
    this.isFilo.set(file.path, { mtime: file.stat.mtime, value });
    return value;
  }

  private async digest(file: TFile): Promise<void> {
    try {
      await digestCanvas(this.plugin, file);
    } catch (e) {
      console.error("[Filo] canvas digest failed", e);
      new Notice("Filo: failed to digest canvas");
    }
  }

  /** Remove all buttons (called on plugin unload). */
  destroy(): void {
    for (const rec of this.records.values()) rec.el.remove();
    this.records.clear();
    this.isFilo.clear();
  }
}
