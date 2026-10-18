// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../package.json") as { version: string };

export const PROVIDER_VENDOR = "amd-tokenfactory";
export const PROVIDER_DISPLAY_NAME = "AMD TokenFactory";
export const SECRET_STORAGE_KEY = "amd-tokenfactory.apiKey";
/** SecretStorage key holding the JSON array of API keys used for rotation. */
export const API_KEYS_STORAGE_KEY = "amd-tokenfactory.apiKeys";
/** Rolling GitHub release checked for self-updates. */
export const UPDATE_REPO_OWNER = "sucooer";
export const UPDATE_REPO_NAME = "amd-tokenfactory-provider";
export const UPDATE_RELEASES_API_URL = `https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest`;
/** Minimum time between automatic update checks. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_STATE_KEY = "amd-tokenfactory.lastUpdateCheck";
export const CHECK_FOR_UPDATES_COMMAND_ID = "amd-tokenfactory.checkForUpdates";
export const RAW_MODELS_STATE_KEY = "amd-tokenfactory.rawModels";
export const MODELS_STATE_KEY = "amd-tokenfactory.models";
export const MODELS_CACHE_VERSION_STATE_KEY = "amd-tokenfactory.modelsCacheVersion";
export const MODELS_CACHE_VERSION = 6;
export const MIGRATION_DONE_KEY = "amd-tokenfactory.legacyMigrationDone";
export const DEBUG_STATE_KEY = "amd-tokenfactory.debug";
export const DEBUG_ENV_VAR = "AMD_TOKENFACTORY_DEBUG";
export const MANAGE_COMMAND_ID = "amd-tokenfactory.manage";
export const REFRESH_MODELS_COMMAND_ID = "amd-tokenfactory.refreshModels";
export const TOGGLE_DEBUG_LOGGING_COMMAND_ID = "amd-tokenfactory.toggleDebugLogging";
export const OPEN_DEBUG_LOG_COMMAND_ID = "amd-tokenfactory.openDebugLog";
export const TOGGLE_SHOW_REASONING_COMMAND_ID = "amd-tokenfactory.toggleShowReasoning";

export const BASE_URL = "https://developer.amd.com.cn/radeon/api/v1";
export const EXTENSION_VERSION: string = pkg.version;

/**
 * Public fleet-load endpoint behind the "Busy" / "At capacity" gauges on the TokenFactory page.
 * No API key and no cookie are needed, but it reports AMD's whole deployment (`scope: "fleet"`),
 * not the caller's account.
 */
export const MODEL_LOAD_URL = "https://developer.amd.com.cn/radeon/api/tokenfactory/load";

/** The endpoint queries live GPU metrics and answers in ~25s, so the timeout has to allow for it. */
export const MODEL_LOAD_TIMEOUT_MS = 45000;

/** Re-read interval for the fleet load. The website polls every 20s; a tooltip needs far less. */
export const MODEL_LOAD_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Safety margin for context window calculations (in tokens) */
export const CONTEXT_WINDOW_SAFETY_MARGIN = 4096;

/** Maximum retry delay in milliseconds */
export const MAX_RETRY_DELAY_MS = 30000;

/** Base retry delay in milliseconds */
export const BASE_RETRY_DELAY_MS = 1000;

/** Request timeout in milliseconds */
export const REQUEST_TIMEOUT_MS = 120000;

/** Maximum time (ms) between stream chunks before timeout */
export const STREAM_IDLE_TIMEOUT_MS = 120000;

export const STREAM_IDLE_TIMEOUT_MIN_MS = 60000;
export const STREAM_IDLE_TIMEOUT_MAX_MS = 300000;

/**
 * Models that emit `reasoning_content` and consume part of the output budget
 * on internal reasoning before producing visible text/tool calls.  They get a
 * minimum output budget floor so long reasoning steps cannot exhaust the
 * budget and truncate the visible response.
 */
const THINKING_MODEL_ID_PATTERNS = [
  /(^|[\/_-])deepseek-r1([\/_-]|$)/i,
  // DeepSeek V4 (Flash) exposes visible reasoning through reasoning_content
  /(^|[\/_-])deepseek-v4([\/_-]|$)/i,
  // Moonshot Kimi K2 / K3 / K2.6 native thinking mode (1M context, vision)
  /(^|[\/_-])kimi-k\d([.\/_-]|$)/i,
  // Zhipu GLM-5.x reasoning models
  /(^|[\/_-])glm-5([.\/_-]|$)/i,
  // OpenAI GPT-OSS open-weight thinking models
  /(^|[\/_-])gpt-oss([\/_-]|$)/i,
  // MiniMax M3 reasoning model
  /(^|[\/_-])minimax-m3([\/_-]|$)/i,
  // AMD Nemotron 3 reasoning family
  /(^|[\/_-])nemotron-3([\/_-]|$)/i,
  // Llama 3.3 Nemotron Super 49B (reasoning-tuned)
  /(^|[\/_-])nemotron-super([\/_-]|$)/i,
  // AMD Cosmos Reason2 VLM (reasoning + vision, Qwen3-VL based)
  /(^|[\/_-])cosmos-reason\d*([\/_-]|$)/i,
  /(^|[\/_-])qwq([\/_-]|$)/i,
];

export const THINKING_MODELS = {
  has(modelId: string): boolean {
    return THINKING_MODEL_ID_PATTERNS.some((pattern) => pattern.test(modelId));
  },
};

export const STATUS_BAR_DEFAULT_TEXT = `$(loading~spin) AMD TokenFactory`;
export const STATUS_BAR_ERROR_TEXT = `$(error) AMD TokenFactory`;
