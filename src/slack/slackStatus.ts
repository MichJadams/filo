import { Notice, requestUrl } from "obsidian";
import type FiloPlugin from "../main";
import { Task } from "../types";

const ENDPOINT = "https://slack.com/api/users.profile.set";

/** Slack caps custom status text at 100 characters. */
const MAX_STATUS_LEN = 100;

/**
 * Slack error codes worth translating. The raw code is accurate but says
 * nothing about what to do next, and every one of these is fixed in Filo's
 * settings or in the Slack app config rather than in the vault.
 */
const ERROR_HINTS: Record<string, string> = {
  not_authed: "no token — add one in Filo's settings",
  invalid_auth: "the token was rejected — check it in Filo's settings",
  token_revoked: "the token was revoked — reinstall the Slack app for a new one",
  token_expired: "the token expired — reinstall the Slack app for a new one",
  missing_scope: "the token is missing the users.profile:write scope",
  invalid_profile: "Slack rejected the status — is the emoji name real?",
  profile_set_failed: "Slack refused the update; try again in a moment",
  ratelimited: "too many updates — wait a moment and try again",
};

/**
 * Fit a task title into Slack's 100-character status field, flattened onto one
 * line so a multi-line title doesn't arrive with newlines in it.
 */
export function statusTextFor(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  return flat.length > MAX_STATUS_LEN ? flat.slice(0, MAX_STATUS_LEN - 1) + "…" : flat;
}

type SlackResult = { ok: true } | { ok: false; message: string };

/**
 * Write the custom status. Empty strings for both fields is how Slack clears
 * one; there's no separate delete method.
 *
 * `users.profile.set` requires a **user** token (`xoxp-`) carrying
 * `users.profile:write` — a bot token cannot set a human's status at all. The
 * token is pasted into settings from a Slack app installed to the workspace, so
 * there's no OAuth redirect for the plugin to host.
 */
async function setProfileStatus(
  token: string,
  text: string,
  emoji: string
): Promise<SlackResult> {
  let res;
  try {
    res = await requestUrl({
      url: ENDPOINT,
      method: "POST",
      contentType: "application/json; charset=utf-8",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ profile: { status_text: text, status_emoji: emoji } }),
      // Slack reports application errors as `ok: false` inside a 200, so the
      // body is the real result; letting a non-2xx throw would only lose the
      // reason for it.
      throw: false,
    });
  } catch (e) {
    // Network-level failure: offline, DNS, TLS.
    console.error("[Filo] Slack request failed", e);
    return { ok: false, message: "couldn't reach Slack" };
  }

  // `res.json` parses lazily and throws on a non-JSON body (an HTML error page
  // from a proxy, say), which would otherwise read as a crash rather than a
  // failed update.
  let body: { ok?: boolean; error?: string } | null = null;
  try {
    body = res.json;
  } catch {
    body = null;
  }

  if (!body?.ok) {
    const code = body?.error ?? `HTTP ${res.status}`;
    console.error("[Filo] Slack rejected the status update", res.status, res.text);
    return { ok: false, message: ERROR_HINTS[code] ?? code };
  }
  return { ok: true };
}

/**
 * Push `task`'s title to Slack as the custom status, and record that Filo owns
 * what's there — see `clearSlackStatus`.
 *
 * Reports its own outcome via Notice, success or failure, since the button that
 * calls it has no other feedback.
 */
export async function postTaskToSlack(plugin: FiloPlugin, task: Task): Promise<void> {
  const token = plugin.settings.slackToken.trim();
  if (!token) {
    new Notice("Filo: add a Slack user token in settings first.");
    return;
  }

  const text = statusTextFor(task.title);
  const result = await setProfileStatus(token, text, plugin.settings.slackStatusEmoji);
  if (!result.ok) {
    new Notice(`Filo: Slack status failed — ${result.message}.`);
    return;
  }

  await plugin.setSlackStatusText(text);
  new Notice(`Filo: Slack status set to "${text}".`);
}

/**
 * Clear the Slack status when a timer stops.
 *
 * Only clears a status **Filo set** — the text it last posted is remembered in
 * `data.json`, and a stop with nothing recorded is a silent no-op. Without that
 * ownership check, stopping a timer would wipe whatever you'd set by hand ("In
 * a meeting", "Out sick"), which is not something a stop button should do.
 *
 * The check is bookkeeping, not a read of your live status: verifying against
 * Slack would need the `users.profile:read` scope, and adding a scope means
 * reinstalling the app for a new token. So a status you change by hand *after*
 * posting from Filo still gets cleared on the next stop.
 */
export async function clearSlackStatus(plugin: FiloPlugin): Promise<void> {
  const token = plugin.settings.slackToken.trim();
  if (!token || plugin.slackStatusText === null) return;

  // Release ownership before the request, so a status posted while this one is
  // in flight isn't cleared by a late-landing response. Restored on failure so
  // the next stop retries rather than giving up on a stale status.
  const owned = plugin.slackStatusText;
  await plugin.setSlackStatusText(null);

  const result = await setProfileStatus(token, "", "");
  if (!result.ok) {
    if (plugin.slackStatusText === null) await plugin.setSlackStatusText(owned);
    new Notice(`Filo: couldn't clear Slack status — ${result.message}.`);
    return;
  }
  new Notice("Filo: Slack status cleared.");
}
