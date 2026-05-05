# OpenAI-Compatible Provider Design

## Goal

This spec defines the first real remote provider slice for BukitJalil:

- keep the existing fake provider;
- add one real `OpenAI-compatible` provider;
- store provider configuration in existing app settings;
- allow the workspace to switch between fake and real provider without changing chat flow.

This slice is intentionally limited to a single provider style and a single chat-completions path.

## Scope

The implementation includes:

- three persisted provider settings:
  - `ProviderBaseUrl`
  - `ProviderApiKey`
  - `ProviderModel`
- one new `OpenAI-compatible` provider;
- registry support for both:
  - `fake`
  - `openai-compatible`
- workspace support for selecting and using the real provider;
- local validation for missing provider configuration;
- response parsing for the first assistant text message.

The implementation excludes:

- secure storage;
- streaming responses;
- tool calling;
- structured schema generation;
- multiple real provider implementations;
- advanced retry or rate-limit policies.

## Recommended Approach

### Option A: OpenAI-only provider

Implement a provider hard-wired to OpenAI endpoints and configuration.

Pros:

- smallest real-network slice.

Cons:

- narrower than the existing product direction;
- creates migration work if other compatible providers are added later.

### Option B: OpenAI-compatible provider

Implement one provider driven by `BaseUrl + ApiKey + Model` and use the standard `/chat/completions` shape.

Pros:

- aligns with existing docs and old implementation direction;
- supports OpenAI and compatible backends with one abstraction;
- keeps scope small enough for one slice.

Cons:

- requires a small amount of validation and transport plumbing.

### Option C: Multiple real providers at once

Implement separate providers for OpenAI and one or more compatible backends.

Pros:

- broader coverage immediately.

Cons:

- too much scope for one slice;
- mixes transport, config, and provider-specific behavior too early.

### Recommendation

Choose **Option B**.

It matches the current BukitJalil architecture direction and old AIBuilding experience while keeping implementation small and testable.

## Architecture

### Core

`Core` continues to own provider contracts and app configuration models.

Changes:

- extend `AppSettings` with:
  - `ProviderBaseUrl`
  - `ProviderApiKey`
  - `ProviderModel`

Rules:

- `ILlmProvider` stays unchanged;
- no HTTP or JSON transport details belong in `Core`.

### Infrastructure

`Infrastructure` owns transport, settings lookup, and provider registration.

Planned additions:

- `OpenAiCompatibleLlmProvider`
- registry update to include both fake and real provider
- minimal settings-to-request mapping

Rules:

- provider reads its configuration through `ISettingsStore`;
- provider uses `HttpClient` for outbound requests;
- provider must not mutate settings;
- provider returns a normal `LlmChatResponse` on success;
- provider throws or returns clear failure content only for expected user-facing configuration issues.

### App

`App` keeps the existing chat shell and settings page.

Changes:

- `Settings` page adds fields for:
  - base URL
  - API key
  - model
- `Workspace` page continues to bind through `WorkspaceSession`

Rules:

- do not add provider-specific logic directly into the page;
- workspace behavior should remain the same whether fake or real provider is selected.

## Configuration Model

`AppSettings` becomes the storage location for the first real provider configuration.

Required fields:

- `DefaultProvider`
- `ProviderBaseUrl`
- `ProviderApiKey`
- `ProviderModel`

Validation policy:

- missing or blank `BaseUrl`, `ApiKey`, or `Model` means the real provider is not ready;
- validation happens at send time in the provider path;
- this slice does not require deep URL validation beyond a syntactically valid absolute URI.

## Request Flow

When the selected provider is `openai-compatible`:

1. `WorkspaceSession` calls the provider through `ILlmProvider`.
2. Provider loads current settings from `ISettingsStore`.
3. Provider validates `BaseUrl`, `ApiKey`, and `Model`.
4. Provider builds a `POST` request to:

```text
{BaseUrl}/chat/completions
```

5. Provider sends a standard JSON body:

```json
{
  "model": "the configured model",
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

6. Provider parses the first assistant content from `choices[0].message.content`.
7. Provider returns an `LlmChatResponse`.
8. `WorkspaceSession` appends the assistant reply.

## Error Handling

This slice needs only simple, predictable behavior.

### Missing Configuration

If `BaseUrl`, `ApiKey`, or `Model` is missing:

- do not send a network request;
- return a clear assistant-facing failure message telling the user to update `Settings`.

Example message:

```text
OpenAI-compatible provider is not configured. Add Base URL, API key, and model in Settings.
```

### Invalid Base URL

If `BaseUrl` is not a valid absolute URI:

- do not send a network request;
- return a clear failure message.

### Transport Failure

If the request fails or returns a non-success status:

- return a failure message that keeps the conversation intact;
- include lightweight context suitable for the user, not raw stack traces.

### Parse Failure

If the JSON payload does not contain a usable assistant response:

- return a failure message indicating the provider response could not be parsed.

## Testing Strategy

Follow TDD with targeted non-network coverage.

Required tests:

- `SettingsStore` round-trips:
  - `ProviderBaseUrl`
  - `ProviderApiKey`
  - `ProviderModel`
- `ProviderRegistry` lists and resolves `openai-compatible`
- `OpenAiCompatibleLlmProvider` returns a clear message when configuration is missing
- `OpenAiCompatibleLlmProvider` parses a minimal successful response

Use a controllable `HttpMessageHandler` or equivalent injected HTTP path for provider tests.

Avoid:

- real network tests;
- UI-heavy component tests;
- secure-storage tests in this slice.

## Acceptance Criteria

This slice is complete when:

- `Settings` page persists base URL, API key, and model;
- `ProviderRegistry` exposes both `fake` and `openai-compatible`;
- `Workspace` can select `openai-compatible`;
- missing configuration produces a clear assistant-facing message;
- valid mocked HTTP response produces an assistant reply in the transcript;
- tests for settings round-trip, registry behavior, and provider response parsing pass.

## Out of Scope Follow-up

This slice prepares the system for:

- secure key storage;
- stream rendering;
- richer provider settings;
- tool calling;
- schema-aware generation requests;
- more compatible providers.

## Summary

This design adds the first real remote provider without changing the core workspace flow:

- settings own provider config;
- infrastructure owns HTTP transport;
- workspace keeps one stable chat path;
- fake and real providers coexist behind the same interface.
