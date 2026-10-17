jest.mock("vscode", () => ({
  window: {},
  commands: {
    executeCommand: jest.fn(),
  },
  Uri: {
    file: (p: string) => ({ scheme: "file", path: p }),
  },
}));

import * as vscode from "vscode";
import { EXTENSION_VERSION } from "../src/constants";
import { getWebviewHtml, SettingsViewProvider } from "../src/settings-view";

const mockExecuteCommand = vscode.commands.executeCommand as jest.Mock;

function makeSecrets(keys: string[] = []) {
  let stored: string[] = [...keys];
  return {
    get: jest.fn(async (key: string) => {
      if (key === "amd-tokenfactory.apiKeys") {
        return JSON.stringify(stored);
      }
      return undefined;
    }),
    store: jest.fn(async (key: string, value: string) => {
      if (key === "amd-tokenfactory.apiKeys") {
        stored = JSON.parse(value) as string[];
      }
    }),
    delete: jest.fn(),
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
  };
}

function makeContext() {
  return {
    globalState: {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
      update: jest.fn(),
    },
  } as never;
}

function makeWebviewView() {
  const posted: unknown[] = [];
  const handlers: Array<(message: { type?: string; key?: string; index?: number }) => void> = [];
  const webview = {
    options: {},
    html: "",
    cspSource: "https://file+.vscode-resource.vscode-cdn.net",
    postMessage: jest.fn(async (message: unknown) => {
      posted.push(message);
    }),
    onDidReceiveMessage: jest.fn(
      (handler: (message: { type?: string; key?: string; index?: number }) => void) => {
        handlers.push(handler);
        return { dispose: jest.fn() };
      },
    ),
  };
  const view = {
    webview,
    visible: true,
    onDidChangeVisibility: jest.fn(),
  } as never;
  return { view, webview, posted, handlers };
}

beforeEach(() => {
  jest.clearAllMocks();
});

async function flushAsync() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("SettingsViewProvider", () => {
  it("renders the initial state on resolve", async () => {
    const { view, webview, posted } = makeWebviewView();
    const provider = new SettingsViewProvider(makeContext(), makeSecrets() as never);

    provider.resolveWebviewView(view);
    await flushAsync();

    expect(webview.options).toEqual({ enableScripts: true });
    expect(webview.html).toContain("API Keys");
    const stateMessage = posted.find((m) => (m as { type?: string }).type === "state") as {
      state: { keys: string[]; version: string; modelCount: number };
    };
    expect(stateMessage.state).toEqual({ keys: [], version: EXTENSION_VERSION, modelCount: 0 });
  });

  it("adds a key and reports the masked list", async () => {
    const { view, posted, handlers } = makeWebviewView();
    const onKeysChanged = jest.fn();
    const provider = new SettingsViewProvider(makeContext(), makeSecrets() as never, onKeysChanged);

    provider.resolveWebviewView(view);
    handlers.forEach((h) => h({ type: "getState" }));
    await flushAsync();

    const fullKey = "rc-0123456789abcdef0123456789abcdef0123456789abcdef";
    await handlers[0]({ type: "addKey", key: fullKey });

    const states = posted.filter((m) => (m as { type?: string }).type === "state");
    const last = states[states.length - 1] as { state: { keys: string[] } };
    expect(last.state.keys).toHaveLength(1);
    expect(last.state.keys[0]).not.toContain(fullKey);
    expect(last.state.keys[0]).toMatch(/^rc-/);
    expect(onKeysChanged).toHaveBeenCalled();
  });

  it("rejects a duplicate key", async () => {
    const fullKey = "rc-0123456789abcdef0123456789abcdef0123456789abcdef";
    const { view, posted, handlers } = makeWebviewView();
    const provider = new SettingsViewProvider(makeContext(), makeSecrets([fullKey]) as never);

    provider.resolveWebviewView(view);
    await handlers[0]({ type: "addKey", key: fullKey });

    const notice = posted.find((m) => (m as { type?: string }).type === "notice") as {
      notice: string;
    };
    expect(notice.notice).toMatch(/already configured/);
  });

  it("removes a key by index", async () => {
    const fullKey = "rc-0123456789abcdef0123456789abcdef0123456789abcdef";
    const { view, posted, handlers } = makeWebviewView();
    const provider = new SettingsViewProvider(makeContext(), makeSecrets([fullKey]) as never);

    provider.resolveWebviewView(view);
    await handlers[0]({ type: "removeKey", index: 0 });

    const states = posted.filter((m) => (m as { type?: string }).type === "state");
    const last = states[states.length - 1] as { state: { keys: string[] } };
    expect(last.state.keys).toHaveLength(0);
  });

  it("forwards refresh and update actions to commands", async () => {
    const { view, handlers } = makeWebviewView();
    const provider = new SettingsViewProvider(makeContext(), makeSecrets() as never);

    provider.resolveWebviewView(view);
    await handlers[0]({ type: "refreshModels" });
    await handlers[0]({ type: "checkForUpdates" });

    expect(mockExecuteCommand).toHaveBeenCalledWith("amd-tokenfactory.refreshModels");
    expect(mockExecuteCommand).toHaveBeenCalledWith("amd-tokenfactory.checkForUpdates");
  });
});

describe("getWebviewHtml", () => {
  it("embeds a strict CSP with a nonce and no full keys", () => {
    const html = getWebviewHtml({
      cspSource: "https://file+.vscode-resource.vscode-cdn.net",
    } as vscode.Webview);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("nonce-");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/rc-[0-9a-f]{8}/);
  });
});
