jest.mock("node:fs", () => ({
  promises: { writeFile: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("vscode", () => ({
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    withProgress: jest.fn(async (_options: unknown, task: (progress: unknown) => Promise<void>) =>
      task({}),
    ),
  },
  commands: {
    executeCommand: jest.fn(),
  },
  ProgressLocation: { Notification: 15 },
  Uri: {
    file: (p: string) => ({ scheme: "file", path: p }),
  },
}));

import * as vscode from "vscode";
import { EXTENSION_VERSION, UPDATE_CHECK_STATE_KEY } from "../src/constants";
import {
  checkForUpdates,
  fetchLatestRelease,
  isNewerVersion,
  parseVersion,
  versionFromAssetName,
} from "../src/updater";

const mockShowInformationMessage = vscode.window.showInformationMessage as jest.Mock;
const mockShowErrorMessage = vscode.window.showErrorMessage as jest.Mock;
const mockExecuteCommand = vscode.commands.executeCommand as jest.Mock;

function mockFetchJson(payload: unknown, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as never);
}

function releaseJson(version: string) {
  return {
    assets: [
      {
        name: `amd-tokenfactory-provider-${version}.vsix`,
        browser_download_url: "https://example.com/pkg.vsix",
      },
    ],
  };
}

function makeContext(lastCheck: number) {
  const state = new Map<string, unknown>([[UPDATE_CHECK_STATE_KEY, lastCheck]]);
  return {
    globalState: {
      get: jest.fn((key: string, fallback?: unknown) => state.get(key) ?? fallback),
      update: jest.fn(async (key: string, value: unknown) => {
        state.set(key, value);
      }),
    },
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("parseVersion", () => {
  it("parses plain and v-prefixed versions", () => {
    expect(parseVersion("0.3.8")).toEqual([0, 3, 8]);
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
  });

  it("rejects non-versions", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("compares semver parts numerically", () => {
    expect(isNewerVersion("0.3.8", "0.4.0")).toBe(true);
    expect(isNewerVersion("0.3.8", "0.3.8")).toBe(false);
    expect(isNewerVersion("0.3.8", "0.3.10")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(false);
    expect(isNewerVersion("0.3.8", "not-a-version")).toBe(false);
  });
});

describe("versionFromAssetName", () => {
  it("extracts the version from a vsix file name", () => {
    expect(versionFromAssetName("amd-tokenfactory-provider-0.3.8.vsix")).toBe("0.3.8");
    expect(versionFromAssetName("something-else.zip")).toBeUndefined();
  });
});

describe("fetchLatestRelease", () => {
  it("returns version and download URL from the rolling release", async () => {
    mockFetchJson(releaseJson("0.4.0"));

    const release = await fetchLatestRelease();
    expect(release).toEqual({
      version: "0.4.0",
      downloadUrl: "https://example.com/pkg.vsix",
      assetName: "amd-tokenfactory-provider-0.4.0.vsix",
    });
  });

  it("returns null when the release has no vsix asset", async () => {
    mockFetchJson({ assets: [{ name: "notes.txt" }] });
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("returns null on HTTP errors", async () => {
    mockFetchJson({ message: "Not Found" }, false, 404);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("returns null when the network fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
    expect(await fetchLatestRelease()).toBeNull();
  });
});

describe("checkForUpdates", () => {
  it("skips the check when one ran recently", async () => {
    global.fetch = jest.fn();
    await checkForUpdates(makeContext(Date.now()));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockShowInformationMessage).not.toHaveBeenCalled();
  });

  it("stays silent when already up to date", async () => {
    mockFetchJson(releaseJson(EXTENSION_VERSION));
    await checkForUpdates(makeContext(0));
    expect(mockShowInformationMessage).not.toHaveBeenCalled();
  });

  it("reports up-to-date on a forced check", async () => {
    mockFetchJson(releaseJson(EXTENSION_VERSION));
    await checkForUpdates(makeContext(0), { force: true });
    expect(mockShowInformationMessage).toHaveBeenCalledWith(expect.stringContaining("up to date"));
  });

  it("downloads and installs when the user accepts the update", async () => {
    mockFetchJson(releaseJson("9.9.9"));
    mockShowInformationMessage.mockResolvedValue("Download & Install");

    await checkForUpdates(makeContext(0));

    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("9.9.9"),
      "Download & Install",
      "Ignore",
    );
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      "workbench.extensions.installExtension",
      expect.objectContaining({ scheme: "file" }),
    );
    expect(mockShowErrorMessage).not.toHaveBeenCalled();
  });

  it("does nothing when the user ignores the update", async () => {
    mockFetchJson(releaseJson("9.9.9"));
    mockShowInformationMessage.mockResolvedValue("Ignore");

    await checkForUpdates(makeContext(0));

    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});
