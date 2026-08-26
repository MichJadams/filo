import { TimeSession } from "../types";

/**
 * Matches the fenced ```t-time block anywhere in the file body and captures its
 * inner lines. The legacy ```timekeeper spelling is still parsed so older task
 * files keep working; anything we write back uses `t-time` (so a legacy block is
 * upgraded in place the first time its sessions change).
 *
 * The `(?![\w-])` guard stops `t-timeline` from matching, and the trailing
 * `[^\n]*` tolerates anything the user might type on the fence line itself.
 * Non-greedy body so we stop at the first closing fence.
 */
const TIME_FENCE = /```(?:t-time|timekeeper)(?![\w-])[^\n]*\n([\s\S]*?)```/;

/**
 * Parse the t-time block out of a full file's content into discrete start/stop
 * sessions.
 *
 * The block is a flat list of `start:`/`stop:` lines. We pair them in order:
 *   - a `start:` opens a new session;
 *   - the next `stop:` closes it;
 *   - `stop: running` (or an empty stop value) leaves the session open;
 *   - a `start:` that arrives while a session is still open implies the prior
 *     start was never stopped, so that prior session is left running too.
 * A stray `stop:` with no open session is ignored.
 */
export function parseSessions(content: string): TimeSession[] {
  const m = content.match(TIME_FENCE);
  if (!m) return [];

  const sessions: TimeSession[] = [];
  let current: TimeSession | null = null;

  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const key = line.slice(0, ci).trim().toLowerCase();
    const val = line.slice(ci + 1).trim();

    if (key === "start") {
      if (current) sessions.push(current); // previous start had no stop -> running
      current = { start: val, stop: null };
    } else if (key === "stop") {
      if (current) {
        current.stop = val.toLowerCase() === "running" || val === "" ? null : val;
        sessions.push(current);
        current = null;
      }
    }
  }
  if (current) sessions.push(current); // trailing start with no stop -> running
  return sessions;
}

/** Serialize sessions back into the inner lines of a t-time block. */
export function serializeSessions(sessions: TimeSession[]): string {
  return sessions
    .map((s) => `start: ${s.start}\nstop: ${s.stop ?? "running"}`)
    .join("\n");
}

/**
 * Return a copy of `content` with the t-time block rewritten to reflect
 * `sessions`. Crucially this replaces ONLY the fenced block (or appends a new
 * one if none exists) so the rest of the body is preserved verbatim.
 */
export function writeSessions(content: string, sessions: TimeSession[]): string {
  const inner = sessions.length ? serializeSessions(sessions) + "\n" : "";
  const block = "```t-time\n" + inner + "```";

  if (TIME_FENCE.test(content)) {
    return content.replace(TIME_FENCE, block);
  }
  // No block yet: append one after the existing body.
  return content.replace(/\s*$/, "") + "\n\n" + block + "\n";
}

export interface TotalResult {
  /** Total tracked milliseconds (running session counted up to `now`, capped). */
  ms: number;
  /** True if a running session has exceeded the safety cap. */
  flagged: boolean;
  /** True if there is an open (running) session. */
  running: boolean;
}

/**
 * Sum the tracked time that falls inside `[fromMs, toMs)`.
 *
 * Sessions are *clipped* to the window rather than counted whole, so a session
 * running from 23:00 to 01:00 contributes an hour to each day — which is what
 * makes "how long did I work today" answerable at all.
 *
 * Completed sessions contribute `stop - start`. A running session runs to `now`,
 * but no longer than `capMs` from its start: past that it's treated as a timer
 * someone forgot to stop, counted only up to the cap and `flagged`.
 *
 * `running` reports an open session *overlapping this window* — a timer running
 * now doesn't make last Tuesday's total live.
 */
export function computeTotalInRange(
  sessions: TimeSession[],
  capMs: number,
  fromMs: number,
  toMs: number,
  nowMs: number = Date.now()
): TotalResult {
  let ms = 0;
  let flagged = false;
  let running = false;

  for (const s of sessions) {
    const start = Date.parse(s.start);
    if (isNaN(start)) continue;

    let stop: number;
    if (s.stop === null) {
      const capped = nowMs - start > capMs;
      stop = capped ? start + capMs : nowMs;
      if (start < toMs && stop > fromMs) {
        running = true;
        if (capped) flagged = true;
      }
    } else {
      stop = Date.parse(s.stop);
      if (isNaN(stop)) continue;
    }

    const a = Math.max(start, fromMs);
    const b = Math.min(stop, toMs);
    if (b > a) ms += b - a;
  }
  return { ms, flagged, running };
}

/** Total tracked time over all of history. */
export function computeTotal(
  sessions: TimeSession[],
  capMs: number,
  nowMs: number = Date.now()
): TotalResult {
  return computeTotalInRange(sessions, capMs, -Infinity, Infinity, nowMs);
}

/** Human-friendly duration: "1h 05m", "12m 03s", "44s". */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
