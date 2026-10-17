import * as vscode from "vscode";
import { ApiKeyPool, maskApiKey } from "./key-rotation";
import {
  CHECK_FOR_UPDATES_COMMAND_ID,
  EXTENSION_VERSION,
  MIGRATION_DONE_KEY,
  MODELS_STATE_KEY,
  PROVIDER_DISPLAY_NAME,
  PROVIDER_VENDOR,
  REFRESH_MODELS_COMMAND_ID,
} from "./constants";
import { errorMessage } from "./errors";

export interface SettingsViewState {
  keys: string[];
  version: string;
  modelCount: number;
}

interface ViewMessage {
  type?: string;
  key?: string;
  index?: number;
}

/**
 * Sidebar settings panel (WebviewView): manage API keys, refresh models and
 * check for updates without using the Command Palette.
 */
export class SettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "amd-tokenfactory.settings";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly secrets: vscode.SecretStorage,
    private readonly onKeysChanged?: () => void,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    webview.options = { enableScripts: true };
    webview.html = getWebviewHtml(webview);

    const postState = async (): Promise<void> => {
      await webview.postMessage({ type: "state", state: await this.buildState() });
    };

    webview.onDidReceiveMessage(async (message: ViewMessage) => {
      switch (message.type) {
        case "getState":
          await postState();
          break;
        case "addKey":
          await this.addKey(webview, (message.key ?? "").trim());
          await postState();
          break;
        case "removeKey":
          await this.removeKey(webview, message.index ?? -1);
          await postState();
          break;
        case "refreshModels":
          await vscode.commands.executeCommand(REFRESH_MODELS_COMMAND_ID);
          // The refresh runs async; re-read the count shortly after.
          setTimeout(() => void postState(), 1500);
          break;
        case "checkForUpdates":
          await vscode.commands.executeCommand(CHECK_FOR_UPDATES_COMMAND_ID);
          break;
        default:
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void postState();
      }
    });

    void postState();
  }

  private async buildState(): Promise<SettingsViewState> {
    const pool = new ApiKeyPool();
    await pool.load(this.secrets);
    const keys = pool.getKeys();
    const models = this.context.globalState.get<Array<unknown>>(MODELS_STATE_KEY, []);
    return {
      keys: keys.map(maskApiKey),
      version: EXTENSION_VERSION,
      modelCount: models.length,
    };
  }

  private async addKey(webview: vscode.Webview, key: string): Promise<void> {
    if (!key) {
      return;
    }
    const pool = new ApiKeyPool();
    await pool.load(this.secrets);
    const added = await pool.addKey(this.secrets, key);
    if (!added) {
      await webview.postMessage({ type: "notice", notice: "That API key is already configured." });
      return;
    }
    try {
      await vscode.commands.executeCommand("lm.migrateLanguageModelsProviderGroup", {
        vendor: PROVIDER_VENDOR,
        name: PROVIDER_DISPLAY_NAME,
        apiKey: key,
      });
      await this.context.globalState.update(MIGRATION_DONE_KEY, true);
    } catch (error) {
      if (/already exists/i.test(errorMessage(error))) {
        await this.context.globalState.update(MIGRATION_DONE_KEY, true);
      }
    }
    await webview.postMessage({
      type: "notice",
      notice: `API key added (${pool.size} total). Requests will rotate across keys.`,
    });
    this.onKeysChanged?.();
  }

  private async removeKey(webview: vscode.Webview, index: number): Promise<void> {
    const pool = new ApiKeyPool();
    await pool.load(this.secrets);
    const removed = await pool.removeKey(this.secrets, index);
    if (removed !== undefined) {
      await webview.postMessage({
        type: "notice",
        notice: `API key ${maskApiKey(removed)} removed (${pool.size} remaining).`,
      });
      this.onKeysChanged?.();
    }
  }
}

function getNonce(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  // webview.cspSource is referenced to keep the CSP strict; only the nonce'd
  // inline script may run.
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 4px 12px 16px; margin: 0; }
  h2 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.8; margin: 18px 0 8px; }
  h2:first-child { margin-top: 8px; }
  .key-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; margin-bottom: 4px; background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-sideBar-border, transparent); border-radius: 4px; }
  .key-row code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .input-row { display: flex; gap: 6px; margin-top: 8px; }
  input[type="password"], input[type="text"] { flex: 1; min-width: 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 6px 8px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  input:focus { outline: 1px solid var(--vscode-focusBorder); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.danger { background: transparent; color: var(--vscode-errorForeground); padding: 4px 8px; }
  button.danger:hover { background: var(--vscode-toolbar-hoverBackground); }
  .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 4px 0 8px; }
  .notice { margin-top: 8px; padding: 6px 8px; border-radius: 4px; background: var(--vscode-inputValidation-infoBackground); border: 1px solid var(--vscode-inputValidation-infoBorder); font-size: 12px; display: none; }
  .notice.show { display: block; }
  .empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 6px 0; }
</style>
</head>
<body>
  <h2>API Keys</h2>
  <div id="key-list"></div>
  <div class="input-row">
    <input id="key-input" type="password" placeholder="Paste a key (rc-…)" autocomplete="off" spellcheck="false">
    <button id="add-key">Add</button>
  </div>
  <div id="notice" class="notice"></div>

  <h2>Models</h2>
  <div id="model-count" class="meta"></div>
  <button id="refresh-models" class="secondary">Refresh Models</button>

  <h2>Updates</h2>
  <div id="version" class="meta"></div>
  <button id="check-updates" class="secondary">Check for Updates</button>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const keyList = document.getElementById('key-list');
  const keyInput = document.getElementById('key-input');
  const notice = document.getElementById('notice');
  let noticeTimer = 0;

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showNotice(text) {
    notice.textContent = text;
    notice.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.remove('show'), 4000);
  }

  function render(state) {
    document.getElementById('model-count').textContent =
      state.modelCount + (state.modelCount === 1 ? ' model' : ' models') + ' available';
    document.getElementById('version').textContent = 'Installed version: ' + state.version;
    if (state.keys.length === 0) {
      keyList.innerHTML = '<div class="empty">No API keys configured yet.</div>';
    } else {
      keyList.innerHTML = state.keys
        .map((masked, i) =>
          '<div class="key-row"><code>' + escapeHtml(masked) + '</code>' +
          '<button class="danger" data-remove-index="' + i + '" title="Remove this key">Remove</button></div>',
        )
        .join('');
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'state') {
      render(message.state);
    } else if (message.type === 'notice') {
      showNotice(message.notice);
    }
  });

  document.getElementById('add-key').addEventListener('click', () => {
    vscode.postMessage({ type: 'addKey', key: keyInput.value });
    keyInput.value = '';
  });
  keyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      vscode.postMessage({ type: 'addKey', key: keyInput.value });
      keyInput.value = '';
    }
  });
  keyList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-index]');
    if (button) {
      vscode.postMessage({ type: 'removeKey', index: Number(button.dataset.removeIndex) });
    }
  });
  document.getElementById('refresh-models').addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshModels' });
  });
  document.getElementById('check-updates').addEventListener('click', () => {
    vscode.postMessage({ type: 'checkForUpdates' });
  });

  vscode.postMessage({ type: 'getState' });
</script>
</body>
</html>`;
}
