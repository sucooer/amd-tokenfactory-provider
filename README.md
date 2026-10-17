# AMD TokenFactory Provider

VS Code extension that adds an AMD TokenFactory (Radeon Cloud) provider to Copilot Chat.

> Forked from [hidenobunagai/nvidia-nim-provider](https://github.com/hidenobunagai/nvidia-nim-provider)
> and adapted for AMD's OpenAI-compatible API.

## Requirements

- VS Code 1.104.0 or later
- GitHub Copilot extension installed and active
- An AMD TokenFactory API key from [developer.amd.com.cn/radeon/tokenfactory](https://developer.amd.com.cn/radeon/tokenfactory)
  (keys start with `rc-`)

## Installation

### From Source

1. Clone this repository.
2. Run `bun install --ignore-scripts && bun run compile`.
3. Press `F5` in VS Code to launch the Extension Development Host.

### From VSIX

1. Run `bun install --ignore-scripts && bun run package:vsix`.
2. Install the generated `.vsix` file via the Extensions view (`Install from VSIX...`).

## Setup

1. Open Copilot Chat and choose the model picker.
2. Select **Manage Models**, then add/configure **AMD TokenFactory**.
3. Paste the API key obtained from the TokenFactory page.
4. Select one of the AMD TokenFactory models returned by your account.

You can also run `AMD TokenFactory: Manage AMD TokenFactory API Key` from the Command Palette.

## Multiple API keys (rotation)

Run `AMD TokenFactory: Manage AMD TokenFactory API Key` and choose **Add API key**
to store additional keys. Chat requests rotate across all configured keys in
round-robin order, which spreads load under the per-key rate limit
(~30 requests/minute). If a request fails with an authentication or
rate-limit error, it is automatically retried with the next key.

Keys are stored in VS Code SecretStorage and shown masked
(e.g. `rc-35c3…8e54`). A previously configured single key is migrated into
the rotation pool automatically.

## Supported Models

The extension dynamically fetches available models from
`https://developer.amd.com.cn/radeon/api/v1/models`.
It does not ship a hardcoded model catalog: the Copilot Chat model picker shows the models
returned by your AMD TokenFactory account.

Unlike NVIDIA's catalog, AMD's `GET /v1/models` response is self-describing —
every entry already reports `context_length`, `supported_parameters` and per-provider
capability flags (`tools` / `vision` / `reasoning` / `streaming`), so no static
override table is needed. Non-chat model ids (embedding, rerank, guard, etc.)
are filtered out of the picker.

Reasoning models (DeepSeek R1/V4, Kimi K3/K2.6, GLM 5.x, GPT-OSS, QwQ, …) get a
minimum output budget floor and silent retries so long thinking steps cannot
truncate the visible response.

## API notes

- Base URL: `https://developer.amd.com.cn/radeon/api/v1`
- Auth: `Authorization: Bearer <api-key>`
- Chat completions: `POST /v1/chat/completions` (OpenAI-compatible, SSE streaming supported)
- The gateway silently drops parameters outside its allowlist
  (`stop`, `seed`, `logit_bias`, `logprobs`, …); `system` messages must come first.
- Rate limits: ~30 requests/minute per key, 8 concurrent requests per key.

## Development

```bash
bun install --ignore-scripts
bun run compile
bun run lint
bun run test
```

Press `F5` in VS Code to launch the Extension Development Host.

### Available Scripts

- `bun run compile` – TypeScript compile
- `bun run watch` – compile with file watching
- `bun run test` – run tests
- `bun run format` – Prettier format
- `bun run package:vsix` – build the VSIX package

## Privacy

- Your API key is stored securely through VS Code's language model provider configuration and, for
  legacy command-palette setup, VS Code SecretStorage.
- Chat completions and model discovery requests are sent to `https://developer.amd.com.cn/radeon/api/v1`.
