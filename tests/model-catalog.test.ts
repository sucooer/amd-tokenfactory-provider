import {
  findPreferredVisionModel,
  isNormalizedAmdModel,
  normalizeAmdModels,
} from "../src/model-catalog";
import type { AmdModelSummary } from "../src/types";

describe("normalizeAmdModels", () => {
  it("preserves the free flag from the API", () => {
    const [freeModel, paidModel] = normalizeAmdModels([
      { id: "m/free", name: "Free Model", context_length: 1000, free: true },
      { id: "m/paid", name: "Paid Model", context_length: 1000, free: false },
    ]);
    expect(freeModel.free).toBe(true);
    expect(paidModel.free).toBe(false);
  });

  it("defaults free to false when the API omits it", () => {
    const [model] = normalizeAmdModels([{ id: "m/x", name: "X", context_length: 1000 }]);
    expect(model.free).toBe(false);
  });

  it("normalizes AMD catalog entries with context_length and provider capability flags", () => {
    const raw: AmdModelSummary[] = [
      {
        id: "DeepSeek-V4-Flash",
        name: "DeepSeek V4 Flash",
        context_length: 1048576,
        supported_parameters: ["temperature", "max_tokens", "tools", "stream"],
        providers: [{ providerId: "shared", vision: false, tools: true, streaming: true }],
      },
      {
        id: "some-embed-model",
        context_length: 8192,
      },
    ];

    expect(normalizeAmdModels(raw)).toEqual([
      expect.objectContaining({
        id: "DeepSeek-V4-Flash",
        displayName: "DeepSeek V4 Flash",
        supportsVision: false,
        free: false,
        supportsTools: true,
        contextWindow: 1048576,
      }),
    ]);
  });

  it("detects vision support from provider flags or input modalities", () => {
    const raw: AmdModelSummary[] = [
      {
        id: "Some-VL-Model",
        providers: [{ vision: true, tools: true }],
      },
      {
        id: "Other-VL-Model",
        architecture: { input_modalities: ["text", "image"] },
      },
      {
        id: "Text-Only-Model",
        architecture: { input_modalities: ["text"] },
      },
    ];

    const models = normalizeAmdModels(raw);
    expect(models).toEqual([
      expect.objectContaining({ id: "Some-VL-Model", supportsVision: true }),
      expect.objectContaining({ id: "Other-VL-Model", supportsVision: true }),
      expect.objectContaining({ id: "Text-Only-Model", supportsVision: false }),
    ]);
  });

  it("assumes chat models can use tools when the API omits capability metadata", () => {
    const raw: AmdModelSummary[] = [
      {
        id: "meta/llama-3.1-8b-instruct",
      },
    ];

    expect(normalizeAmdModels(raw)).toEqual([
      {
        id: "meta/llama-3.1-8b-instruct",
        displayName: "llama-3.1-8b-instruct",
        contextWindow: 131072,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: false,
        free: false,
      },
    ]);
  });

  it("prefers the API name over the derived display name", () => {
    const raw: AmdModelSummary[] = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "API Supplied Llama 4 Maverick",
      },
    ];

    expect(normalizeAmdModels(raw)).toEqual([
      expect.objectContaining({
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "API Supplied Llama 4 Maverick",
      }),
    ]);
  });

  it("filters obvious non-chat models by id pattern", () => {
    const raw: AmdModelSummary[] = [
      { id: "baai/bge-m3" },
      { id: "bigcode/starcoder2-15b" },
      { id: "google/codegemma-1.1-7b" },
      { id: "google/diffusiongemma-26b-a4b-it" },
      { id: "google/gemma-2b" },
      { id: "google/recurrentgemma-2b" },
      { id: "meta/codellama-70b" },
      { id: "meta/llama-guard-4-12b" },
      { id: "meta/llama2-70b" },
      { id: "some-embed-model" },
      { id: "some-rerank-model" },
    ];

    expect(normalizeAmdModels(raw)).toEqual([]);
  });

  it("deduplicates exact duplicate model ids from the AMD catalog", () => {
    const raw: AmdModelSummary[] = [{ id: "openai/gpt-oss-120b" }, { id: "openai/gpt-oss-120b" }];

    expect(normalizeAmdModels(raw)).toEqual([
      expect.objectContaining({
        id: "openai/gpt-oss-120b",
        displayName: "gpt-oss-120b",
      }),
    ]);
  });

  it("falls back to the first vision-capable model for the image fallback", () => {
    const models = normalizeAmdModels([
      { id: "text-model-a" },
      { id: "vision-model-b", providers: [{ vision: true }] },
      { id: "vision-model-c", providers: [{ vision: true }] },
    ]);

    expect(findPreferredVisionModel(models)?.id).toBe("vision-model-b");
    expect(findPreferredVisionModel(normalizeAmdModels([{ id: "text-model-a" }]))).toBe(undefined);
  });

  it("detects whether cached values match the normalized AMD model shape", () => {
    expect(
      isNormalizedAmdModel({
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        contextWindow: 262144,
        maxOutputTokens: 262144,
        supportsTools: true,
        supportsVision: true,
        free: false,
      }),
    ).toBe(true);
    expect(
      isNormalizedAmdModel({
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        contextWindow: 262144,
        maxOutputTokens: "262144",
        supportsTools: true,
        supportsVision: true,
        free: false,
      }),
    ).toBe(false);
  });
});
