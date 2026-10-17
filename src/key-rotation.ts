import type * as vscode from "vscode";
import { API_KEYS_STORAGE_KEY, SECRET_STORAGE_KEY } from "./constants";
import { debugLog } from "./output-channel";

/**
 * Mask an API key for safe display, e.g. `rc-35c3…8e54`.
 * Never log or show the full key.
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) {
    return "••••••••";
  }
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

function parseStoredKeys(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const keys: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === "string" && entry.trim().length > 0 && !keys.includes(entry.trim())) {
        keys.push(entry.trim());
      }
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * Round-robin pool of API keys backed by VS Code SecretStorage.
 *
 * Keys are stored as a JSON array under {@link API_KEYS_STORAGE_KEY}.
 * A legacy single key stored under {@link SECRET_STORAGE_KEY} is migrated
 * into the pool on first load.
 */
export class ApiKeyPool {
  private keys: string[] = [];
  private loaded = false;

  /** Load keys from SecretStorage (idempotent). */
  async load(secrets: vscode.SecretStorage): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.keys = parseStoredKeys(await secrets.get(API_KEYS_STORAGE_KEY));
    if (this.keys.length === 0) {
      const legacy = await secrets.get(SECRET_STORAGE_KEY);
      if (legacy?.trim()) {
        this.keys = [legacy.trim()];
        await this.persist(secrets);
        debugLog("ApiKeyPool", "migrated legacy single API key into the key pool");
      }
    }
    debugLog("ApiKeyPool", `loaded ${this.keys.length} API key(s)`);
  }

  /** A copy of the keys currently in the pool. */
  getKeys(): string[] {
    return [...this.keys];
  }

  get size(): number {
    return this.keys.length;
  }

  /**
   * Add a key to the pool. Returns false when the key is empty or already
   * present.
   */
  async addKey(secrets: vscode.SecretStorage, key: string): Promise<boolean> {
    const trimmed = key.trim();
    if (!trimmed || this.keys.includes(trimmed)) {
      return false;
    }
    this.keys.push(trimmed);
    await this.persist(secrets);
    return true;
  }

  /**
   * Remove the key at `index`. Returns the removed key, or undefined when the
   * index is out of range.
   */
  async removeKey(secrets: vscode.SecretStorage, index: number): Promise<string | undefined> {
    if (index < 0 || index >= this.keys.length) {
      return undefined;
    }
    const [removed] = this.keys.splice(index, 1);
    await this.persist(secrets);
    return removed;
  }

  private async persist(secrets: vscode.SecretStorage): Promise<void> {
    await secrets.store(API_KEYS_STORAGE_KEY, JSON.stringify(this.keys));
  }
}
