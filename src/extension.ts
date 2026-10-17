import * as vscode from "vscode";
import { fetchModels } from "./api";
import {
  CHECK_FOR_UPDATES_COMMAND_ID,
  DEBUG_ENV_VAR,
  DEBUG_STATE_KEY,
  EXTENSION_VERSION,
  MANAGE_COMMAND_ID,
  MIGRATION_DONE_KEY,
  MODELS_CACHE_VERSION,
  MODELS_CACHE_VERSION_STATE_KEY,
  MODELS_STATE_KEY,
  OPEN_DEBUG_LOG_COMMAND_ID,
  PROVIDER_DISPLAY_NAME,
  PROVIDER_VENDOR,
  RAW_MODELS_STATE_KEY,
  REFRESH_MODELS_COMMAND_ID,
  SECRET_STORAGE_KEY,
  TOGGLE_DEBUG_LOGGING_COMMAND_ID,
  TOGGLE_SHOW_REASONING_COMMAND_ID,
} from "./constants";
import { errorMessage } from "./errors";
import { ApiKeyPool, maskApiKey } from "./key-rotation";
import { normalizeAmdModels } from "./model-catalog";
import { checkForUpdates } from "./updater";
import { SettingsViewProvider } from "./settings-view";
import { debugLog, disposeOutputChannel, getOutputChannel, outputLog } from "./output-channel";
import { AmdTokenFactoryChatModelProvider } from "./provider";
import { StatusBarManager } from "./status-bar";
import { registerAmdTokenFactoryTools } from "./tools";

let _provider: AmdTokenFactoryChatModelProvider | null = null;
let _refreshQueue: Promise<void> = Promise.resolve();

async function migrateLanguageModelProviderGroup(apiKey: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand("lm.migrateLanguageModelsProviderGroup", {
      vendor: PROVIDER_VENDOR,
      name: PROVIDER_DISPLAY_NAME,
      apiKey,
    });
    outputLog(
      "languageModelGroup",
      `Configured ${PROVIDER_DISPLAY_NAME} language model group from stored API key.`,
    );
    return true;
  } catch (error) {
    const message = errorMessage(error);
    outputLog(
      "languageModelGroup",
      `Could not configure VS Code language model group automatically: ${message}`,
    );
    return /already exists/i.test(message);
  }
}

async function initializeStoredApiKey(
  context: vscode.ExtensionContext,
  ua: string,
  statusBar: StatusBarManager,
): Promise<void> {
  const pool = new ApiKeyPool();
  await pool.load(context.secrets);
  const apiKey = pool.getKeys()[0] ?? (await context.secrets.get(SECRET_STORAGE_KEY));
  if (!apiKey) {
    return;
  }

  const migrationDone = context.globalState.get<boolean>(MIGRATION_DONE_KEY, false);
  if (!migrationDone && (await migrateLanguageModelProviderGroup(apiKey))) {
    await context.globalState.update(MIGRATION_DONE_KEY, true);
  }
  await refreshModelsFromApi(context, ua, statusBar, { showMessages: false, apiKey });
}

async function refreshModelsFromApi(
  context: vscode.ExtensionContext,
  ua: string,
  statusBar: StatusBarManager,
  options: { showMessages: boolean; apiKey?: string },
): Promise<void> {
  const nextRefresh = _refreshQueue
    .catch(() => undefined)
    .then(async () => {
      const pool = new ApiKeyPool();
      await pool.load(context.secrets);
      const apiKey =
        options.apiKey ?? pool.getKeys()[0] ?? (await context.secrets.get(SECRET_STORAGE_KEY));
      if (!apiKey) {
        if (options.showMessages) {
          vscode.window.showWarningMessage(`No ${PROVIDER_DISPLAY_NAME} API key configured.`);
        }
        return;
      }

      statusBar.showRefreshing();
      try {
        const rawModels = await fetchModels(apiKey, undefined, ua);
        if (Array.isArray(rawModels)) {
          const normalizedModels = normalizeAmdModels(rawModels);
          const previousRawModels = context.globalState.get(RAW_MODELS_STATE_KEY);
          await context.globalState.update(RAW_MODELS_STATE_KEY, rawModels);
          try {
            await context.globalState.update(MODELS_STATE_KEY, normalizedModels);
          } catch (normalizedWriteError) {
            try {
              await context.globalState.update(RAW_MODELS_STATE_KEY, previousRawModels);
            } catch (rollbackError) {
              debugLog(
                "refreshModels",
                `Raw cache rollback failed: ${errorMessage(rollbackError)}`,
              );
            }
            throw normalizedWriteError;
          }
          await context.globalState.update(MODELS_CACHE_VERSION_STATE_KEY, MODELS_CACHE_VERSION);
          _provider?.fireModelInfoChanged();
          statusBar.showOk(normalizedModels.length);
          debugLog(
            "refreshModels",
            `Refreshed ${normalizedModels.length} models from ${PROVIDER_DISPLAY_NAME} API.`,
          );
          if (options.showMessages) {
            vscode.window.showInformationMessage(
              `Refreshed ${normalizedModels.length} ${PROVIDER_DISPLAY_NAME} models.`,
            );
          }
          return;
        }

        debugLog("refreshModels", "Model refresh failed or returned malformed data.");
        statusBar.showError("Model refresh failed or returned malformed data.");
        if (options.showMessages) {
          vscode.window.showWarningMessage(
            `Failed to refresh models from ${PROVIDER_DISPLAY_NAME} API.`,
          );
        }
      } catch (error) {
        debugLog("refreshModels", `Model refresh failed: ${errorMessage(error)}`);
        statusBar.showError(errorMessage(error));
        if (options.showMessages) {
          vscode.window.showErrorMessage(`Failed to refresh models: ${errorMessage(error)}`);
        }
      }
    });

  _refreshQueue = nextRefresh.catch(() => undefined);
  return nextRefresh;
}

export function activate(context: vscode.ExtensionContext) {
  const ua = `amd-tokenfactory-provider/${EXTENSION_VERSION} VSCode/${vscode.version}`;
  const channel = getOutputChannel();
  context.subscriptions.push(channel);
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);
  const debugEnabled = context.globalState.get<boolean>(DEBUG_STATE_KEY, false);
  process.env[DEBUG_ENV_VAR] = debugEnabled ? "1" : "0";
  debugLog(
    "activate",
    `Extension activated. Debug logging ${debugEnabled ? "enabled" : "disabled"}.`,
  );
  const provider = new AmdTokenFactoryChatModelProvider(context.secrets, ua, context.globalState);
  _provider = provider;

  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === SECRET_STORAGE_KEY) {
        _provider?.fireModelInfoChanged();
      }
    }),
  );

  const registration = vscode.lm.registerLanguageModelChatProvider(PROVIDER_VENDOR, provider);
  context.subscriptions.push(registration);
  context.subscriptions.push(registerAmdTokenFactoryTools(context.secrets, context.globalState));
  context.subscriptions.push(
    vscode.commands.registerCommand(MANAGE_COMMAND_ID, async () => {
      const pool = new ApiKeyPool();
      await pool.load(context.secrets);

      interface ManageChoice extends vscode.QuickPickItem {
        action: "add" | "remove" | "list";
      }
      const choices: ManageChoice[] = [
        {
          label: "$(add) Add API key…",
          description: "Requests rotate across all configured keys",
          action: "add",
        },
      ];
      if (pool.size > 0) {
        choices.push(
          {
            label: `$(list-unordered) List API keys (${pool.size})`,
            description: pool.getKeys().map(maskApiKey).join(", "),
            action: "list",
          },
          { label: "$(trash) Remove API key…", action: "remove" },
        );
      }
      const choice = await vscode.window.showQuickPick(choices, {
        title: `${PROVIDER_DISPLAY_NAME} API Keys`,
        placeHolder: "Manage the API keys used for request rotation",
        ignoreFocusOut: true,
      });
      if (!choice) {
        return;
      }

      if (choice.action === "add") {
        const apiKey = await vscode.window.showInputBox({
          title: `${PROVIDER_DISPLAY_NAME} API Key`,
          prompt: `Enter a new ${PROVIDER_DISPLAY_NAME} API key (starts with rc-)`,
          ignoreFocusOut: true,
          password: true,
          placeHolder: "rc-…",
        });
        if (apiKey === undefined || !apiKey.trim()) {
          return;
        }
        const added = await pool.addKey(context.secrets, apiKey.trim());
        if (!added) {
          vscode.window.showWarningMessage("That API key is already configured.");
          return;
        }
        if (await migrateLanguageModelProviderGroup(apiKey.trim())) {
          await context.globalState.update(MIGRATION_DONE_KEY, true);
        }
        vscode.window.showInformationMessage(
          `${PROVIDER_DISPLAY_NAME} API key added (${pool.size} total). Requests will rotate across keys.`,
        );
        _provider?.fireModelInfoChanged();
        return;
      }

      if (choice.action === "remove") {
        const keys = pool.getKeys();
        const removeChoice = await vscode.window.showQuickPick(
          keys.map((key, index) => ({
            label: maskApiKey(key),
            description: `Key ${index + 1} of ${keys.length}`,
            index,
          })),
          {
            title: `Remove ${PROVIDER_DISPLAY_NAME} API Key`,
            placeHolder: "Select the key to remove",
            ignoreFocusOut: true,
          },
        );
        if (!removeChoice) {
          return;
        }
        const removed = await pool.removeKey(context.secrets, removeChoice.index);
        vscode.window.showInformationMessage(
          removed
            ? `${PROVIDER_DISPLAY_NAME} API key ${maskApiKey(removed)} removed (${pool.size} remaining).`
            : "The selected API key was already removed.",
        );
        _provider?.fireModelInfoChanged();
        return;
      }

      // list
      vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} API keys (${pool.size}): ${pool.getKeys().map(maskApiKey).join(", ")}`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(REFRESH_MODELS_COMMAND_ID, async () => {
      await refreshModelsFromApi(context, ua, statusBar, { showMessages: true });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TOGGLE_DEBUG_LOGGING_COMMAND_ID, async () => {
      const current = context.globalState.get<boolean>(DEBUG_STATE_KEY, false);
      const next = !current;
      await context.globalState.update(DEBUG_STATE_KEY, next);
      process.env[DEBUG_ENV_VAR] = next ? "1" : "0";
      debugLog("toggleDebug", `Debug logging ${next ? "enabled" : "disabled"}.`);
      vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} debug logging ${next ? "enabled" : "disabled"}.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_DEBUG_LOG_COMMAND_ID, () => {
      const output = getOutputChannel();
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TOGGLE_SHOW_REASONING_COMMAND_ID, async () => {
      const config = vscode.workspace.getConfiguration("amd-tokenfactory");
      const current = config.get<boolean>("showReasoning", false);
      await config.update("showReasoning", !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `AMD TokenFactory reasoning content display ${!current ? "enabled" : "disabled"}.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CHECK_FOR_UPDATES_COMMAND_ID, async () => {
      await checkForUpdates(context, { force: true });
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SettingsViewProvider.viewId,
      new SettingsViewProvider(context, context.secrets, () => {
        _provider?.fireModelInfoChanged();
      }),
    ),
  );

  void initializeStoredApiKey(context, ua, statusBar);
  void checkForUpdates(context);
}

export function deactivate() {
  _provider = null;
  _refreshQueue = Promise.resolve();
  disposeOutputChannel();
}
