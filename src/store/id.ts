/**
 * Generate a short, stable, random task id (e.g. "t-k3p9af2x").
 *
 * The id is intentionally NOT derived from the title: the filename is
 * `<id>.md` and all parent/child relationships reference the id, so renaming
 * a task's title never breaks links or moves files.
 */
export function generateTaskId(): string {
  const a = Math.random().toString(36).slice(2, 8);
  const b = Math.random().toString(36).slice(2, 4);
  return `t-${a}${b}`;
}
