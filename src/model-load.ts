import {
  MODEL_LOAD_POLL_INTERVAL_MS,
  MODEL_LOAD_TIMEOUT_MS,
  MODEL_LOAD_URL,
  PROVIDER_DISPLAY_NAME,
} from "./constants";
import { abortReasonOf, errorMessage, toError } from "./errors";
import { debugLog } from "./output-channel";

/**
 * Load state AMD reports per model on the TokenFactory page. The website renders the same three
 * values as green / orange / red bars labelled "Idle" / "Busy" / "At capacity".
 */
export type ModelLoadState = "idle" | "busy" | "full";

export interface ModelLoadEntry {
  /** Key exactly as the endpoint spells it: a display name ("DeepSeek-V4.1-Flash"), not a model id. */
  key: string;
  state: ModelLoadState;
  label: string;
  /** Percentage the website shows next to the bar, when the payload carries it. */
  utilization?: number;
}

export interface ModelLoadSnapshot {
  /** "fleet" today: the numbers cover AMD's whole deployment, not the caller's account. */
  scope: string;
  entries: ModelLoadEntry[];
  /** Local time the response arrived; the payload carries no timestamp of its own. */
  fetchedAt: number;
}

/** The subset of a normalized model the load data is matched against. */
export interface LoadableModel {
  id: string;
  displayName: string;
}

/** A model offered in the picker, paired with the fleet entry it was matched to (if any). */
export interface ModelLoadRow {
  model: LoadableModel;
  entry?: ModelLoadEntry;
}

export interface ModelLoadMatch {
  rows: ModelLoadRow[];
  /** Fleet entries that no cached model matched, e.g. models that appeared since the last refresh. */
  unmatched: ModelLoadEntry[];
}

const LOAD_STATES: readonly ModelLoadState[] = ["idle", "busy", "full"];

const DEFAULT_LABELS: Record<ModelLoadState, string> = {
  idle: "Idle",
  busy: "Busy",
  full: "At capacity",
};

/** State order used when rendering: usable models first, at-capacity ones last. */
const STATE_ORDER: Record<ModelLoadState, number> = { idle: 0, busy: 1, full: 2 };

/**
 * Reduce a model id, a display name or a fleet key to a comparable token.
 *
 * The endpoint keys display names while `/v1/models` ids are lowercase paths, so
 * `"DeepSeek-V4.1-Flash"`, `"deepseek-ai/deepseek-v4.1-flash"` and `"DeepSeek V4.1 Flash"` have to
 * collapse onto the same string: letters and digits only.
 */
export function normalizeLoadKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clampPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

/**
 * Read a `/radeon/api/tokenfactory/load` payload. Returns null when the shape is not recognisable
 * (a gateway error page, an empty `models` map, or every entry malformed) so callers can tell
 * "no data" from "zero load".
 */
export function parseModelLoad(payload: unknown, fetchedAt = Date.now()): ModelLoadSnapshot | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const models = (payload as { models?: unknown }).models;
  if (models === null || typeof models !== "object" || Array.isArray(models)) {
    return null;
  }

  const entries: ModelLoadEntry[] = [];
  for (const [key, raw] of Object.entries(models as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object") {
      continue;
    }
    const candidate = raw as { state?: unknown; label?: unknown; utilization?: unknown };
    const state = typeof candidate.state === "string" ? candidate.state.toLowerCase() : "";
    if (!LOAD_STATES.includes(state as ModelLoadState)) {
      continue;
    }
    const utilization =
      typeof candidate.utilization === "number" && Number.isFinite(candidate.utilization)
        ? clampPercent(candidate.utilization)
        : undefined;
    const label =
      typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label
        : DEFAULT_LABELS[state as ModelLoadState];
    entries.push({ key, state: state as ModelLoadState, label, utilization });
  }

  if (entries.length === 0) {
    return null;
  }

  const scopeValue = (payload as { scope?: unknown }).scope;
  const scope = typeof scopeValue === "string" && scopeValue ? scopeValue : "fleet";
  return { scope, entries, fetchedAt };
}

function idTail(id: string): string {
  const segment = id.split("/").pop() ?? id;
  return segment;
}

/**
 * Pair the models in the picker with the fleet's per-model load. Matching is by normalized name
 * (display name, then the last path segment of the id), because the two sides spell models
 * differently: `MiniCPM-V-4.7-35B-A3B` on the fleet, `openbmb/MiniCPM-V-4.7-35B-A3B` as an id.
 */
export function matchModelLoad(
  models: readonly LoadableModel[],
  snapshot: ModelLoadSnapshot,
): ModelLoadMatch {
  const byKey = new Map<string, ModelLoadEntry>();
  for (const entry of snapshot.entries) {
    const key = normalizeLoadKey(entry.key);
    if (key && !byKey.has(key)) {
      byKey.set(key, entry);
    }
  }

  const matched = new Set<ModelLoadEntry>();
  const rows = models.map((model): ModelLoadRow => {
    const candidates = [model.displayName, idTail(model.id), model.id];
    for (const candidate of candidates) {
      const entry = byKey.get(normalizeLoadKey(candidate));
      if (entry) {
        matched.add(entry);
        return { model, entry };
      }
    }
    return { model };
  });

  return { rows, unmatched: snapshot.entries.filter((entry) => !matched.has(entry)) };
}

function sortByLoad(rows: readonly ModelLoadRow[]): ModelLoadRow[] {
  return [...rows].sort((a, b) => {
    const stateA = a.entry ? STATE_ORDER[a.entry.state] : 3;
    const stateB = b.entry ? STATE_ORDER[b.entry.state] : 3;
    if (stateA !== stateB) {
      return stateA - stateB;
    }
    const utilA = a.entry?.utilization ?? 0;
    const utilB = b.entry?.utilization ?? 0;
    if (utilA !== utilB) {
      return utilA - utilB;
    }
    return a.model.displayName.localeCompare(b.model.displayName);
  });
}

function formatTime(fetchedAt: number): string {
  const date = new Date(fetchedAt);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Markdown for the status bar tooltip: which models can be used right now, grouped by state.
 *
 * Markdown rather than a tree/table because tooltips are the only surface a status bar item has;
 * the caller must enable `supportThemeIcons` for the `$(...)` glyphs to render.
 */
export function formatModelLoad(
  match: ModelLoadMatch,
  snapshot: ModelLoadSnapshot,
  options: { total?: number } = {},
): string {
  const total = options.total ?? match.rows.length;
  const known = match.rows.filter((row) => row.entry);
  const unknown = match.rows.filter((row) => !row.entry);
  const count = (state: ModelLoadState): number =>
    known.filter((row) => row.entry?.state === state).length;

  const lines: string[] = [];
  lines.push(`**${PROVIDER_DISPLAY_NAME} fleet load** · ${formatTime(snapshot.fetchedAt)}`);
  // "N of M usable" alone reads as "the rest are unusable"; the breakdown keeps "at capacity"
  // (a real verdict) apart from "not reported" (no verdict at all).
  const summary = [`${count("idle") + count("busy")} of ${total} usable`];
  if (count("full") > 0) {
    summary.push(`${count("full")} at capacity`);
  }
  if (unknown.length > 0) {
    summary.push(`${unknown.length} not reported`);
  }
  lines.push(
    `AMD-wide capacity (scope \`${snapshot.scope}\`), not your account's quota. ` +
      `${summary.join(" · ")}.`,
  );

  const groups: Array<{ state: ModelLoadState; icon: string; title: string }> = [
    { state: "idle", icon: "$(check)", title: "Available" },
    { state: "busy", icon: "$(warning)", title: "Busy — slower, still answers" },
    { state: "full", icon: "$(error)", title: "At capacity — expect 429 / queueing" },
  ];

  for (const group of groups) {
    const rows = sortByLoad(known.filter((row) => row.entry?.state === group.state));
    if (rows.length === 0) {
      continue;
    }
    lines.push("");
    lines.push(`**${group.icon} ${group.title}**`);
    for (const row of rows) {
      const percent = row.entry?.utilization;
      lines.push(
        `- ${row.model.displayName}${typeof percent === "number" ? ` · ${percent}%` : ""}`,
      );
    }
  }

  if (unknown.length > 0) {
    lines.push("");
    lines.push("**No load data** — not listed by the fleet, so availability is unknown:");
    for (const row of unknown.slice(0, 8)) {
      lines.push(`- ${row.model.displayName}`);
    }
    if (unknown.length > 8) {
      lines.push(`- …and ${unknown.length - 8} more`);
    }
  }

  if (match.unmatched.length > 0) {
    lines.push("");
    lines.push("**Also on the fleet** (not in your model list):");
    for (const entry of match.unmatched.slice(0, 6)) {
      const percent = typeof entry.utilization === "number" ? ` · ${entry.utilization}%` : "";
      lines.push(`- ${entry.key} · ${entry.label}${percent}`);
    }
    if (match.unmatched.length > 6) {
      lines.push(`- …and ${match.unmatched.length - 6} more`);
    }
  }

  return lines.join("\n");
}

/**
 * Read the fleet load. The endpoint needs no API key (it is the public data behind the website's
 * gauges), answers in ~25s because it queries live GPU metrics, and carries `no-store`.
 * Returns null when the request fails or the payload is unrecognisable; a caller cancellation is
 * rethrown so it stays recognisable downstream.
 */
export async function fetchModelLoad(signal?: AbortSignal): Promise<ModelLoadSnapshot | null> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), MODEL_LOAD_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await fetch(MODEL_LOAD_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: combinedSignal,
    });
    if (!response.ok) {
      debugLog("model-load", `Fleet load request failed: HTTP ${response.status}`);
      return null;
    }
    return parseModelLoad(await response.json());
  } catch (error) {
    if (signal?.aborted) {
      throw abortReasonOf(signal);
    }
    debugLog("model-load", `Fleet load unavailable: ${errorMessage(toError(error))}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface ModelLoadWatcherOptions {
  /** Called with null when a fetch failed, so the caller can show "unavailable" instead of "loading". */
  onSnapshot: (snapshot: ModelLoadSnapshot | null) => void;
  /** Injectable for tests. */
  fetchLoad?: (signal?: AbortSignal) => Promise<ModelLoadSnapshot | null>;
  intervalMs?: number;
}

export interface ModelLoadWatcher {
  /** Re-read now instead of waiting for the next interval (used by a manual model refresh). */
  refreshNow(): void;
  dispose(): void;
}

/**
 * Poll the fleet load in the background. A chained timeout rather than `setInterval`: each request
 * can take longer than the interval, and overlapping 25s requests would only queue on the server.
 */
export function watchModelLoad(options: ModelLoadWatcherOptions): ModelLoadWatcher {
  const intervalMs = options.intervalMs ?? MODEL_LOAD_POLL_INTERVAL_MS;
  const fetchLoad = options.fetchLoad ?? fetchModelLoad;
  let disposed = false;
  let inFlight = false;
  let queued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    if (disposed) {
      return;
    }
    timer = setTimeout(() => void run(), intervalMs);
  };

  const run = async (): Promise<void> => {
    if (inFlight) {
      // One queued re-read at most: a second click during a 25s request must not stack requests.
      queued = true;
      return;
    }
    inFlight = true;
    let snapshot: ModelLoadSnapshot | null = null;
    try {
      snapshot = await fetchLoad();
    } catch {
      snapshot = null;
    }
    inFlight = false;
    if (disposed) {
      return;
    }
    options.onSnapshot(snapshot);
    if (queued) {
      queued = false;
      void run();
      return;
    }
    schedule();
  };

  void run();

  return {
    refreshNow(): void {
      if (disposed) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      void run();
    },

    dispose(): void {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
