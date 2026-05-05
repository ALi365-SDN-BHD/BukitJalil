# Workspace Chat Shell Design

## Goal

This spec defines the first real implementation slice for the BukitJalil workspace:

- a stable workspace chat shell;
- provider contracts in `Core`;
- a registry in `Infrastructure`;
- one local `Fake` provider for development and testing.

This slice intentionally stops before:

- real API integration;
- tool calling;
- chat persistence;
- preview/code/file/build panels beyond placeholders.

The goal is to complete `BJ-V1-017`, `BJ-V1-018`, `BJ-V1-020`, and `BJ-V1-021` with a minimal but realistic execution path.

## Scope

The implementation includes:

- provider contracts and chat message models;
- provider discovery through a registry;
- one fake provider registered by default;
- a workspace page with:
  - provider selection;
  - message list;
  - text input;
  - send button;
- local message flow:
  - append user message;
  - call selected provider;
  - append assistant reply.

The implementation excludes:

- external provider credentials and API calls;
- tool definitions and tool execution;
- persisted chat sessions;
- multi-project workspace switching;
- advanced error recovery.

## Recommended Approach

### Option A: UI-only shell

Build the page with a provider dropdown and local echo behavior only.

Pros:

- fastest to build;
- lowest risk.

Cons:

- does not validate provider abstraction;
- does not exercise async provider flow;
- creates throwaway UI logic.

### Option B: Shell plus fake provider

Build the page together with provider contracts, a registry, and one fake provider.

Pros:

- validates the architecture without real API complexity;
- enables meaningful tests;
- creates a clean upgrade path to real providers.

Cons:

- slightly larger than a pure UI shell.

### Option C: Shell plus first real provider

Build the shell and connect a real provider immediately.

Pros:

- real end-to-end experience earlier.

Cons:

- pulls settings, credentials, transport, and error handling into the same slice;
- increases implementation and debugging cost too early.

### Recommendation

Choose **Option B**.

It gives BukitJalil a real provider boundary and realistic async chat flow while keeping the slice small enough to complete safely in one pass.

## Architecture

### Core

`Core` owns contracts and value models only.

Planned types:

- `LlmRole`
- `LlmMessage`
- `LlmChatRequest`
- `LlmChatResponse`
- `ProviderDescriptor`
- `ILlmProvider`
- `IProviderRegistry`

Rules:

- contracts must not depend on MAUI, LiteDB, or HTTP libraries;
- provider selection must happen through registry lookup, not direct page instantiation.

### Infrastructure

`Infrastructure` owns concrete provider implementations and registration.

Planned types:

- `FakeLlmProvider`
- `ProviderRegistry`

Rules:

- registry returns a list of available descriptors for UI binding;
- registry resolves providers by stable identifier;
- fake provider remains deterministic and local.

### App

`App` owns page composition and temporary view state.

Planned types:

- `WorkspaceSession` or equivalently small state class for chat flow;
- updated `/workspace` page.

Rules:

- do not put provider enumeration and send-flow logic directly into markup;
- keep page responsibilities to binding and event forwarding;
- keep the state object simple enough to test without Razor rendering.

## Interaction Flow

1. Workspace page loads.
2. Page asks `IProviderRegistry` for available providers.
3. Default provider is `fake`.
4. User enters a message and clicks send.
5. User message is appended locally.
6. Selected provider receives the request.
7. Provider returns a response.
8. Assistant message is appended locally.
9. Input is cleared.

## Fake Provider Behavior

The fake provider should return a short structured reply containing:

- acknowledgement of the request;
- a lightweight suggested next step;
- a note that the response is simulated.

This response should be deterministic enough for tests and obvious enough in the UI that it is not a real model result.

## Error Handling

This slice only needs basic errors:

- unknown provider id;
- empty user input;
- provider execution failure.

Handling rules:

- ignore empty input;
- if provider resolution fails, show a single assistant-style error message in the conversation;
- if provider throws, append a single assistant-style failure message and keep previous messages intact.

## Testing Strategy

Follow TDD with focused non-slop coverage.

Required tests:

- `ProviderRegistry` lists the fake provider;
- `ProviderRegistry` resolves the fake provider by id;
- `FakeLlmProvider` returns a non-empty deterministic response;
- `WorkspaceSession` appends user and assistant messages in order.

Avoid:

- heavy Razor component tests for this slice;
- tests that only restate property assignments;
- real network tests.

## Acceptance Criteria

This slice is complete when:

- `/workspace` shows a provider selector, message list, input box, and send button;
- provider selector is populated from `IProviderRegistry`;
- user message appears immediately after send;
- fake assistant response appears after provider call;
- provider contracts live in `Core`;
- fake provider and registry live in `Infrastructure`;
- tests for registry, fake provider, and session flow pass.

## Out of Scope Follow-up

The next slice can build on this foundation to add:

- persistent chat sessions;
- real provider settings and transport;
- tool-aware request/response models;
- tool execution coordinator;
- preview and code panels tied to generation output.

## Summary

This design keeps the first workspace implementation narrow:

- real contracts;
- real provider registry;
- fake execution path;
- real chat shell UI.

That is enough to validate the architecture and prepare BukitJalil for the next step without pulling in external API complexity too early.
