export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface AmdTokenFactoryContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface AmdTokenFactoryChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | AmdTokenFactoryContentPart[];
  name?: string;
  tool_calls?: AmdTokenFactoryToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface AmdTokenFactoryToolCall {
  id: string;
  /** Optional index used in streaming tool call deltas */
  index?: number;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AmdTokenFactoryTool {
  type: "function";
  function: { name: string; description?: string; parameters?: JsonObject };
}

export interface AmdTokenFactoryChatRequest {
  model: string;
  messages: AmdTokenFactoryChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: AmdTokenFactoryTool[];
  tool_choice?: "auto" | "none" | "required" | { type: string; function: { name: string } };
}

export interface AmdTokenFactoryStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: AmdTokenFactoryToolCall[];
  };
  finish_reason: string | null;
}

export interface AmdTokenFactoryStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: AmdTokenFactoryStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Capability flags reported per provider entry in the AMD TokenFactory
 * `GET /v1/models` catalog.
 */
export interface AmdModelProviderEntry {
  providerId?: string;
  externalId?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
  };
  streaming?: boolean;
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  stability?: string;
}

/**
 * One entry of the AMD TokenFactory `GET /v1/models` response, which is a
 * bare JSON array (no `{ data: [...] }` envelope).
 */
export interface AmdModelSummary {
  id: string;
  name?: string;
  aliases?: string[];
  description?: string;
  family?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
  };
  providers?: AmdModelProviderEntry[];
  /** Context window in tokens, reported directly by the catalog. */
  context_length?: number;
  /** Parameters accepted by `POST /v1/chat/completions` for this model. */
  supported_parameters?: string[];
  json_output?: boolean;
  structured_outputs?: boolean;
  free?: boolean;
  stability?: string;
}
