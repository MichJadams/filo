/**
 * The readable part of a thrown value, for putting in a Notice.
 *
 * A notice that only says "failed" sends you to the developer console to find
 * out what actually happened — and for a plugin that mostly runs on someone
 * else's machine, that's the difference between a bug report you can act on and
 * one you can't. The full value still goes to the console for the stack.
 */
export function describeError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  const s = String(e);
  return s && s !== "[object Object]" ? s : "unknown error";
}
