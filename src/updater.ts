import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  EXTENSION_VERSION,
  PROVIDER_DISPLAY_NAME,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_STATE_KEY,
  UPDATE_RELEASES_API_URL,
} from "./constants";
import { errorMessage } from "./errors";
import { debugLog } from "./output-channel";

/** Parse "1.2.3" / "v1.2.3" into numeric parts; null when unparsable. */
export function parseVersion(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(current: string, candidate: string): boolean {
  const currentParts = parseVersion(current);
  const candidateParts = parseVersion(candidate);
  if (!currentParts || !candidateParts) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (candidateParts[i] !== currentParts[i]) {
      return candidateParts[i] > currentParts[i];
    }
  }
  return false;
}

/** Extract "0.3.8" from an asset name like "amd-tokenfactory-provider-0.3.8.vsix". */
export function versionFromAssetName(name: string): string | undefined {
  const match = /(\d+\.\d+\.\d+)\.vsix$/i.exec(name);
  return match?.[1];
}

export interface ReleaseInfo {
  version: string;
  downloadUrl: string;
  assetName: string;
}

/**
 * The latest published GitHub release. Returns null when unavailable
 * (offline, no release published yet, API rate limited, ...). Never throws.
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(UPDATE_RELEASES_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const asset = data.assets?.find(
      (entry) => typeof entry.name === "string" && entry.name.toLowerCase().endsWith(".vsix"),
    );
    const assetName = asset?.name;
    if (!assetName || !asset?.browser_download_url) {
      return null;
    }
    const version = versionFromAssetName(assetName);
    if (!version) {
      return null;
    }
    return { version, downloadUrl: asset.browser_download_url, assetName };
  } catch (error) {
    debugLog("updater", `fetchLatestRelease failed: ${errorMessage(error)}`);
    return null;
  }
}

async function downloadVsix(downloadUrl: string, assetName: string): Promise<string> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const filePath = path.join(os.tmpdir(), assetName);
  await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  return filePath;
}

/**
 * Check for a newer release (throttled to once per day unless `force`) and
 * offer a one-click download & install. Silent when up to date or when the
 * check itself fails.
 */
export async function checkForUpdates(
  context: vscode.ExtensionContext,
  options?: { force?: boolean },
): Promise<void> {
  const now = Date.now();
  if (!options?.force) {
    const lastCheck = context.globalState.get<number>(UPDATE_CHECK_STATE_KEY, 0);
    if (now - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
      return;
    }
  }
  await context.globalState.update(UPDATE_CHECK_STATE_KEY, now);

  const release = await fetchLatestRelease();
  if (!release || !isNewerVersion(EXTENSION_VERSION, release.version)) {
    if (options?.force) {
      vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} is up to date (${EXTENSION_VERSION}).`,
      );
    }
    return;
  }

  const installAction = "Download & Install";
  const choice = await vscode.window.showInformationMessage(
    `${PROVIDER_DISPLAY_NAME} ${release.version} is available (current: ${EXTENSION_VERSION}).`,
    installAction,
    "Ignore",
  );
  if (choice !== installAction) {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${PROVIDER_DISPLAY_NAME} downloading update…`,
      },
      async () => {
        const filePath = await downloadVsix(release.downloadUrl, release.assetName);
        try {
          await vscode.commands.executeCommand(
            "workbench.extensions.installExtension",
            vscode.Uri.file(filePath),
          );
        } catch {
          // Fall back to opening the vsix, which shows the install prompt.
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath));
        }
      },
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `${PROVIDER_DISPLAY_NAME} update failed: ${errorMessage(error)}`,
    );
  }
}
