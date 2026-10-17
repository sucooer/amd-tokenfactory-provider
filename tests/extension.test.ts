import { fetchModels } from "../src/api";
import { AmdTokenFactoryChatModelProvider } from "../src/provider";

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
const mockCreateOutputChannel = jest.fn(() => ({
  appendLine: jest.fn(),
  show: jest.fn(),
  dispose: jest.fn(),
}));
const mockShowInformationMessage = jest.fn();
const mockShowWarningMessage = jest.fn();
const mockShowErrorMessage = jest.fn();
const mockShowInputBox = jest.fn();
const mockShowQuickPick = jest.fn();
const mockRegisterCommand = jest.fn(
  (command: string, callback: (...args: unknown[]) => unknown) => {
    registeredCommands.set(command, callback);
    return { dispose: jest.fn() };
  },
);
const mockExecuteCommand = jest.fn();
const mockRegisterLanguageModelChatProvider = jest.fn(() => ({ dispose: jest.fn() }));

jest.mock("../src/api", () => ({
  fetchModels: jest.fn(),
}));

jest.mock("../src/provider", () => ({
  AmdTokenFactoryChatModelProvider: jest.fn().mockImplementation(() => ({
    fireModelInfoChanged: jest.fn(),
  })),
}));

jest.mock("../src/tools", () => ({
  registerAmdTokenFactoryTools: jest.fn(() => ({ dispose: jest.fn() })),
}));

const mockStatusBarOk = jest.fn();
const mockStatusBarRefresh = jest.fn();
const mockStatusBarError = jest.fn();
const mockStatusBarDispose = jest.fn();

jest.mock("../src/status-bar", () => ({
  StatusBarManager: jest.fn().mockImplementation(() => ({
    showOk: mockStatusBarOk,
    showRefreshing: mockStatusBarRefresh,
    showError: mockStatusBarError,
    dispose: mockStatusBarDispose,
  })),
}));

jest.mock("vscode", () => ({
  version: "1.104.0",
  window: {
    createOutputChannel: mockCreateOutputChannel,
    showInformationMessage: mockShowInformationMessage,
    showWarningMessage: mockShowWarningMessage,
    showErrorMessage: mockShowErrorMessage,
    showInputBox: mockShowInputBox,
    showQuickPick: mockShowQuickPick,
  },
  commands: {
    registerCommand: mockRegisterCommand,
    executeCommand: mockExecuteCommand,
  },
  lm: {
    registerLanguageModelChatProvider: mockRegisterLanguageModelChatProvider,
  },
}));

const flushAsyncWork = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
  }
};

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("activate", () => {
  beforeEach(() => {
    registeredCommands.clear();
    jest.clearAllMocks();
    delete process.env.AMD_TOKENFACTORY_DEBUG;
  });

  it("registers the AMD TokenFactory provider and management command on activation", async () => {
    const secrets = {
      get: jest.fn(async () => undefined),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);

    expect(mockRegisterLanguageModelChatProvider).toHaveBeenCalledWith(
      "amd-tokenfactory",
      expect.anything(),
    );
    expect(mockRegisterCommand).toHaveBeenCalledWith(
      "amd-tokenfactory.manage",
      expect.any(Function),
    );
    expect(process.env.AMD_TOKENFACTORY_DEBUG).toBe("0");
  });

  it("migrates a legacy API key into the VS Code language model provider group on activation", async () => {
    const secrets = {
      get: jest.fn(async (key: string) =>
        key === "amd-tokenfactory.apiKey" ? "test-key" : undefined,
      ),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    expect(mockExecuteCommand).toHaveBeenCalledWith("lm.migrateLanguageModelsProviderGroup", {
      vendor: "amd-tokenfactory",
      name: "AMD TokenFactory",
      apiKey: "test-key",
    });
    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.legacyMigrationDone", true);
  });

  it("skips legacy API key migration on activation after the one-time migration has run", async () => {
    const secrets = {
      get: jest.fn(async (key: string) =>
        key === "amd-tokenfactory.apiKey" ? "test-key" : undefined,
      ),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === "amd-tokenfactory.debug") return false;
        if (key === "amd-tokenfactory.legacyMigrationDone") return true;
        return fallback;
      }),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    expect(mockExecuteCommand).not.toHaveBeenCalledWith(
      "lm.migrateLanguageModelsProviderGroup",
      expect.anything(),
    );
  });

  it("treats an already-existing VS Code model group as migrated", async () => {
    mockExecuteCommand.mockRejectedValueOnce(
      new Error(
        "Language model group with name AMD TokenFactory already exists for vendor amd-tokenfactory",
      ),
    );
    (fetchModels as jest.Mock).mockResolvedValue(null);
    const secrets = {
      get: jest.fn(async (key: string) =>
        key === "amd-tokenfactory.apiKey" ? "test-key" : undefined,
      ),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.legacyMigrationDone", true);
  });

  it("declares an API key configuration schema for VS Code model settings", () => {
    const packageJson = require("../package.json") as {
      activationEvents?: string[];
      contributes?: {
        languageModelChatProviders?: Array<{
          vendor?: string;
          managementCommand?: string;
          configuration?: {
            properties?: Record<string, { secret?: boolean; type?: string }>;
            required?: string[];
          };
        }>;
      };
    };

    expect(packageJson.activationEvents).toContain("onLanguageModelChatProvider:amd-tokenfactory");

    const providerContribution = packageJson.contributes?.languageModelChatProviders?.find(
      (provider) => provider.vendor === "amd-tokenfactory",
    );

    expect(providerContribution?.managementCommand).toBeUndefined();
    expect(providerContribution?.configuration?.properties?.apiKey).toEqual(
      expect.objectContaining({
        type: "string",
        secret: true,
      }),
    );
    expect(providerContribution?.configuration?.required).toContain("apiKey");
  });

  it("refreshes cached models in the background on activation when an API key exists", async () => {
    const rawModels = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick",
        context_length: 128000,
        supported_parameters: ["temperature", "max_tokens", "tools"],
        providers: [{ vision: true, tools: true }],
      },
      {
        id: "nvidia/nv-embedqa-e5-v5",
        name: "Embed QA",
      },
    ];
    (fetchModels as jest.Mock).mockResolvedValue(rawModels);

    const secrets = {
      get: jest.fn(async (key: string) =>
        key === "amd-tokenfactory.apiKey" ? "test-key" : undefined,
      ),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    const providerInstance = (AmdTokenFactoryChatModelProvider as jest.Mock).mock.results[0]?.value;
    const { version } = require("../package.json");
    expect(fetchModels).toHaveBeenCalledWith(
      "test-key",
      undefined,
      `amd-tokenfactory-provider/${version} VSCode/1.104.0`,
    );
    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.rawModels", rawModels);
    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.models", [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick",
        contextWindow: 128000,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: true,
        free: false,
      },
    ]);
    expect(providerInstance.fireModelInfoChanged).toHaveBeenCalled();
    expect(mockShowErrorMessage).not.toHaveBeenCalled();
  });

  it("refreshes cached models in the background on activation when keys are in the rotation pool", async () => {
    const rawModels = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick",
        context_length: 128000,
        supported_parameters: ["temperature", "max_tokens", "tools"],
        providers: [{ vision: true, tools: true }],
      },
    ];
    (fetchModels as jest.Mock).mockResolvedValue(rawModels);

    const secrets = {
      get: jest.fn(async (key: string) =>
        key === "amd-tokenfactory.apiKeys"
          ? JSON.stringify(["pool-key-one", "pool-key-two"])
          : undefined,
      ),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    expect(fetchModels).toHaveBeenCalledWith(
      "pool-key-one",
      undefined,
      expect.stringContaining("amd-tokenfactory-provider/"),
    );
    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.models", [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick",
        contextWindow: 128000,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: true,
        free: false,
      },
    ]);
  });

  it("stores raw and normalized model caches when the refresh command succeeds", async () => {
    let getCallCount = 0;
    const rawModels = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick",
        context_length: 128000,
        supported_parameters: ["temperature", "max_tokens", "tools"],
        providers: [{ vision: true, tools: true }],
      },
      {
        id: "nvidia/nv-embedqa-e5-v5",
        name: "Embed QA",
      },
    ];
    (fetchModels as jest.Mock).mockResolvedValue(rawModels);

    const secrets = {
      get: jest.fn(async () => {
        getCallCount += 1;
        // Activation (pool.load x2 + legacy fallback) sees no key; the manual
        // refresh afterwards finds the key via pool migration.
        return getCallCount <= 3 ? undefined : "test-key";
      }),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    const refresh = registeredCommands.get("amd-tokenfactory.refreshModels");
    expect(refresh).toBeDefined();

    await refresh?.();

    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.rawModels", rawModels);
    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.models", [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick",
        contextWindow: 128000,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: true,
        free: false,
      },
    ]);
    expect(mockShowInformationMessage).toHaveBeenCalledWith("Refreshed 1 AMD TokenFactory models.");
  });

  it("clears raw and normalized model caches when the refresh command returns an empty model list", async () => {
    let getCallCount = 0;
    (fetchModels as jest.Mock).mockResolvedValue([]);

    const secrets = {
      get: jest.fn(async () => {
        getCallCount += 1;
        // Activation (pool.load x2 + legacy fallback) sees no key; the manual
        // refresh afterwards finds the key via pool migration.
        return getCallCount <= 3 ? undefined : "test-key";
      }),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    const refresh = registeredCommands.get("amd-tokenfactory.refreshModels");
    expect(refresh).toBeDefined();

    await refresh?.();

    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.rawModels", []);
    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.models", []);
    expect(mockShowInformationMessage).toHaveBeenCalledWith("Refreshed 0 AMD TokenFactory models.");
  });

  it("keeps existing caches untouched when refresh fails after a previous successful cache", async () => {
    (fetchModels as jest.Mock).mockRejectedValue(new Error("network down"));

    const secrets = {
      get: jest.fn(async (key: string) =>
        key === "amd-tokenfactory.apiKey" ? "test-key" : undefined,
      ),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === "amd-tokenfactory.debug") {
          return false;
        }
        if (key === "amd-tokenfactory.models") {
          return [
            {
              id: "cached-model",
              displayName: "Cached Model",
              contextWindow: 131072,
              maxOutputTokens: 16384,
              supportsTools: true,
              supportsVision: false,
              free: false,
            },
          ];
        }
        if (key === "amd-tokenfactory.rawModels") {
          return [{ id: "cached-model", name: "Cached Model" }];
        }
        return fallback;
      }),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    const refresh = registeredCommands.get("amd-tokenfactory.refreshModels");
    expect(refresh).toBeDefined();

    await refresh?.();

    expect(globalState.update).not.toHaveBeenCalledWith(
      "amd-tokenfactory.rawModels",
      expect.anything(),
    );
    expect(globalState.update).not.toHaveBeenCalledWith(
      "amd-tokenfactory.models",
      expect.anything(),
    );
    expect(mockShowErrorMessage).toHaveBeenCalledWith("Failed to refresh models: network down");
  });

  it("rolls back the raw cache if normalized cache persistence fails", async () => {
    let getCallCount = 0;
    const rawModels = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick",
        context_length: 128000,
        supported_parameters: ["temperature", "max_tokens", "tools"],
        providers: [{ vision: true, tools: true }],
      },
    ];
    (fetchModels as jest.Mock).mockResolvedValue(rawModels);

    const previousRawModels = [{ id: "cached-model", name: "Cached Model" }];
    const update = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("persist normalized failed"))
      .mockResolvedValueOnce(undefined);
    const secrets = {
      get: jest.fn(async () => {
        getCallCount += 1;
        // Activation (pool.load x2 + legacy fallback) sees no key; the manual
        // refresh afterwards finds the key via pool migration.
        return getCallCount <= 3 ? undefined : "test-key";
      }),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === "amd-tokenfactory.debug") {
          return false;
        }
        if (key === "amd-tokenfactory.rawModels") {
          return previousRawModels;
        }
        if (key === "amd-tokenfactory.models") {
          return [
            {
              id: "cached-model",
              displayName: "Cached Model",
              contextWindow: 131072,
              maxOutputTokens: 16384,
              supportsTools: false,
              supportsVision: false,
              free: false,
            },
          ];
        }
        return fallback;
      }),
      update,
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    const refresh = registeredCommands.get("amd-tokenfactory.refreshModels");
    expect(refresh).toBeDefined();

    await refresh?.();

    expect(update).toHaveBeenNthCalledWith(1, "amd-tokenfactory.rawModels", rawModels);
    expect(update).toHaveBeenNthCalledWith(2, "amd-tokenfactory.models", [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick",
        contextWindow: 128000,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: true,
        free: false,
      },
    ]);
    expect(update).toHaveBeenNthCalledWith(3, "amd-tokenfactory.rawModels", previousRawModels);
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      "Failed to refresh models: persist normalized failed",
    );
  });

  it("waits for an in-flight refresh before starting another refresh", async () => {
    const firstRawModels = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick",
        context_length: 128000,
        supported_parameters: ["temperature", "max_tokens", "tools"],
        providers: [{ vision: true, tools: true }],
      },
    ];
    const secondRawModels = [
      {
        id: "meta/llama-3.1-8b-instruct",
        name: "Llama 3.1 8B Instruct",
        context_length: 64000,
        supported_parameters: ["temperature", "max_tokens"],
        providers: [{ vision: false, tools: false }],
      },
    ];
    const firstModelsWrite = createDeferred<void>();
    (fetchModels as jest.Mock)
      .mockResolvedValueOnce(firstRawModels)
      .mockResolvedValueOnce(secondRawModels);

    const secrets = {
      get: jest.fn(async (key: string) =>
        key === "amd-tokenfactory.apiKey" ? "test-key" : undefined,
      ),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async (key: string, value: unknown) => {
        if (
          key === "amd-tokenfactory.models" &&
          Array.isArray(value) &&
          value.some(
            (model) =>
              typeof model === "object" &&
              model !== null &&
              (model as { id?: string }).id === "meta/llama-4-maverick-17b-128e-instruct",
          )
        ) {
          return firstModelsWrite.promise;
        }
        return undefined;
      }),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    const refresh = registeredCommands.get("amd-tokenfactory.refreshModels");
    expect(refresh).toBeDefined();

    const refreshPromise = refresh?.();
    await flushAsyncWork();

    expect(fetchModels).toHaveBeenCalledTimes(1);

    firstModelsWrite.resolve();
    await refreshPromise;

    expect(fetchModels).toHaveBeenCalledTimes(2);
    expect(mockShowInformationMessage).toHaveBeenCalledWith("Refreshed 1 AMD TokenFactory models.");
  });

  it("preserves the normalized cache write error when rollback also fails", async () => {
    let getCallCount = 0;
    const rawModels = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick",
        context_length: 128000,
        supported_parameters: ["temperature", "max_tokens", "tools"],
        providers: [{ vision: true, tools: true }],
      },
    ];
    (fetchModels as jest.Mock).mockResolvedValue(rawModels);

    const normalizedWriteError = new Error("persist normalized failed");
    const rollbackWriteError = new Error("rollback failed");
    const secrets = {
      get: jest.fn(async () => {
        getCallCount += 1;
        // Activation (pool.load x2 + legacy fallback) sees no key; the manual
        // refresh afterwards finds the key via pool migration.
        return getCallCount <= 3 ? undefined : "test-key";
      }),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === "amd-tokenfactory.debug") {
          return false;
        }
        if (key === "amd-tokenfactory.rawModels") {
          return [{ id: "cached-model", name: "Cached Model" }];
        }
        return fallback;
      }),
      update: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(normalizedWriteError)
        .mockRejectedValueOnce(rollbackWriteError),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    const refresh = registeredCommands.get("amd-tokenfactory.refreshModels");
    expect(refresh).toBeDefined();

    await refresh?.();

    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      "Failed to refresh models: persist normalized failed",
    );
  });

  it("does not attempt a background refresh on activation when no API key is configured", async () => {
    const secrets = {
      get: jest.fn(async () => undefined),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    expect(fetchModels).not.toHaveBeenCalled();
    expect(globalState.update).not.toHaveBeenCalledWith(
      "amd-tokenfactory.models",
      expect.anything(),
    );
  });

  it("adds an API key to the rotation pool from the manage command", async () => {
    mockShowQuickPick.mockResolvedValue({ action: "add", label: "Add" });
    mockShowInputBox.mockResolvedValue("new-key");
    const secrets = {
      get: jest.fn(async () => undefined),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);

    const manage = registeredCommands.get("amd-tokenfactory.manage");
    expect(manage).toBeDefined();

    await manage?.();

    expect(secrets.store).toHaveBeenCalledWith(
      "amd-tokenfactory.apiKeys",
      JSON.stringify(["new-key"]),
    );
    expect(secrets.delete).not.toHaveBeenCalled();
  });

  it("migrates a newly saved API key into the VS Code language model provider group", async () => {
    mockShowQuickPick.mockResolvedValue({ action: "add", label: "Add" });
    mockShowInputBox.mockResolvedValue("new-key");
    const secrets = {
      get: jest.fn(async () => undefined),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);

    const manage = registeredCommands.get("amd-tokenfactory.manage");
    expect(manage).toBeDefined();

    await manage?.();

    expect(mockExecuteCommand).toHaveBeenCalledWith("lm.migrateLanguageModelsProviderGroup", {
      vendor: "amd-tokenfactory",
      name: "AMD TokenFactory",
      apiKey: "new-key",
    });
    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.legacyMigrationDone", true);
  });

  it("removes the selected API key from the rotation pool", async () => {
    mockShowQuickPick
      .mockResolvedValueOnce({ action: "remove", label: "Remove" })
      .mockResolvedValueOnce({ label: "rc-abc12…7890", index: 1 });
    const secrets = {
      get: jest.fn(async (key: string) =>
        key === "amd-tokenfactory.apiKeys" ? JSON.stringify(["key-one", "key-two"]) : undefined,
      ),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);
    await flushAsyncWork();

    const manage = registeredCommands.get("amd-tokenfactory.manage");
    expect(manage).toBeDefined();

    await manage?.();

    expect(secrets.store).toHaveBeenCalledWith(
      "amd-tokenfactory.apiKeys",
      JSON.stringify(["key-one"]),
    );
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("removed (1 remaining)"),
    );
  });

  it("toggles AMD TokenFactory debug logging state and env var", async () => {
    const secrets = {
      get: jest.fn(async () => undefined),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);

    const toggleDebug = registeredCommands.get("amd-tokenfactory.toggleDebugLogging");
    expect(toggleDebug).toBeDefined();

    await toggleDebug?.();

    expect(globalState.update).toHaveBeenCalledWith("amd-tokenfactory.debug", true);
    expect(process.env.AMD_TOKENFACTORY_DEBUG).toBe("1");
  });

  it("creates and registers status bar item on activation", async () => {
    const secrets = {
      get: jest.fn(async () => undefined),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const globalState = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === "amd-tokenfactory.debug" ? false : fallback,
      ),
      update: jest.fn(async () => undefined),
    };
    const context = {
      secrets,
      globalState,
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    const { activate } = await import("../src/extension");
    activate(context as never);

    const { StatusBarManager } = await import("../src/status-bar");
    expect(StatusBarManager).toHaveBeenCalled();
    const hasStatusBarDisposable = context.subscriptions.some(
      (s) => typeof s.dispose === "function",
    );
    expect(hasStatusBarDisposable).toBe(true);
  });
});
