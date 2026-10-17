import type { AmdModelProviderEntry, AmdModelSummary } from "./types";

export interface NormalizedAmdModel {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
}

const DEFAULT_CONTEXT_WINDOW = 131072;
export const DEFAULT_MAX_OUTPUT_TOKENS = 65536;
const NON_CHAT_MODEL_ID_PATTERNS = [
  // Embedding / rerank / retrieval / parsing / reward / detector families
  /(^|[/_-])bge([-_/]|$)/i,
  /(^|[/_-])(clip|detector|embed|embedcode|embedqa|embedding|gliner|parse|rerank|retriever|reward)([-_/]|$)/i,
  // nv-prefixed utility models (e.g. nvclip)
  /(^|[/_-])nv(clip|embed|embedcode|embedqa|retriever|rerank)([-_/]|$)/i,
  // Safety / moderation / guard models (not chat models)
  /(^|[/_-])(guard|safety|nemoguard)([-_/]|$)/i,
  // Base / code-completion models without a chat template
  /(^|[/_-])(codegemma|codellama|starcoder\d*)([-_/]|$)/i,
  /(^|[/_-])llama2([-_/]|$)/i,
  /(^|[/_-])(gemma-2b|recurrentgemma|diffusiongemma)([-_/]|$)/i,
  // Speech translation and physics/calibration utilities
  /(^|[/_-])(riva|translate|calibration)([-_/]|$)/i,
];

/**
 * Static per-model overrides.
 *
 * Unlike NVIDIA's catalog, AMD TokenFactory's `GET /v1/models` is
 * self-describing: every entry already reports `context_length`,
 * `supported_parameters` and per-provider capability flags
 * (`tools`/`vision`/`reasoning`/`streaming`). Overrides are therefore only
 * needed for exceptional cases (e.g. a wrong context length for a specific
 * model id). Keep this table minimal and let the live catalog win.
 */
const KNOWN_MODEL_OVERRIDES: Record<string, Partial<NormalizedAmdModel>> = {
  // Example shape (uncomment and adjust once verified against the live catalog):
  // "DeepSeek-V4-Flash": {
  //   displayName: "DeepSeek V4 Flash",
  //   contextWindow: 1048576,
  // },
};

export function normalizeAmdModels(models: AmdModelSummary[]): NormalizedAmdModel[] {
  const seenIds = new Set<string>();
  const normalizedModels: NormalizedAmdModel[] = [];

  for (const model of models) {
    if (seenIds.has(model.id) || !isChatModel(model)) {
      continue;
    }
    seenIds.add(model.id);
    normalizedModels.push(normalizeAmdModel(model));
  }

  return normalizedModels;
}

export function isNormalizedAmdModel(value: unknown): value is NormalizedAmdModel {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<NormalizedAmdModel>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.contextWindow === "number" &&
    typeof candidate.maxOutputTokens === "number" &&
    typeof candidate.supportsTools === "boolean" &&
    typeof candidate.supportsVision === "boolean"
  );
}

export function normalizeAmdModel(model: AmdModelSummary): NormalizedAmdModel {
  const override = KNOWN_MODEL_OVERRIDES[model.id];
  const providerFlags = model.providers ?? [];
  const anyProvider = (flag: (p: AmdModelProviderEntry) => boolean | undefined) =>
    providerFlags.some((p) => flag(p) === true);
  const inputModalities = model.architecture?.input_modalities ?? [];

  return {
    id: model.id,
    displayName: model.name ?? override?.displayName ?? deriveDisplayName(model.id),
    contextWindow:
      getPositiveNumber(model.context_length) ??
      getPositiveNumber(override?.contextWindow) ??
      DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: getPositiveNumber(override?.maxOutputTokens) ?? DEFAULT_MAX_OUTPUT_TOKENS,
    // Default to true so models stay selectable in Copilot Chat Agent mode,
    // matching the original provider's conservative default.
    supportsTools: override?.supportsTools ?? true,
    supportsVision:
      override?.supportsVision ??
      (anyProvider((p) => p.vision) ||
        inputModalities.some((m) => m.toLowerCase().includes("image"))),
  };
}

function isChatModel(model: AmdModelSummary): boolean {
  // AMD's catalog has no explicit chat flag; filter out obviously non-chat
  // model ids (embedding / rerank / guard / TTS / etc.).
  return !isClearlyNonChatModelId(model.id);
}

function isClearlyNonChatModelId(modelId: string): boolean {
  return NON_CHAT_MODEL_ID_PATTERNS.some((pattern) => pattern.test(modelId));
}

function deriveDisplayName(modelId: string): string {
  const lastSegment = modelId.split("/").at(-1);
  return lastSegment && lastSegment.length > 0 ? lastSegment : modelId;
}

function getPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Preferred vision-capable models for the silent image fallback, best first.
 * The AMD `/models` endpoint currently omits capability metadata, so the
 * catalog cannot tell which models actually accept image input; this list
 * keeps the fallback on modern, capable VLMs instead of whatever the API
 * happens to list first (e.g. a small old VLM).
 */
/**
 * Preferred vision-capable models for the silent image fallback, best first.
 * AMD's catalog reports vision support per provider entry, so the generic
 * fallback below (first vision-capable model) is usually enough; add id
 * patterns here once preferred AMD vision models are known.
 */
const VISION_FALLBACK_PREFERENCE_PATTERNS: readonly RegExp[] = [];

export function findPreferredVisionModel(
  models: readonly NormalizedAmdModel[],
): NormalizedAmdModel | undefined {
  for (const pattern of VISION_FALLBACK_PREFERENCE_PATTERNS) {
    const match = models.find((model) => model.supportsVision && pattern.test(model.id));
    if (match) {
      return match;
    }
  }
  return models.find((model) => model.supportsVision);
}
