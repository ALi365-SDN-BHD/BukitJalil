# Workspace Multi-Conversation Persistence Design

## Goal

This spec defines the next BukitJalil workspace slice:

- persist multiple workspace conversations locally;
- provide a complete but minimal conversation shell in the workspace UI;
- preserve the current provider-driven chat flow while moving conversation state from memory-only to LiteDB-backed storage.

The goal is to evolve `/workspace` from a single in-memory chat shell into a reusable desktop conversation workspace that survives app restarts.

## Scope

The implementation includes:

- multiple persisted conversations;
- restoring the previously active conversation on app start;
- creating a new conversation;
- switching between conversations;
- deleting a conversation;
- persisting conversation messages and per-conversation selected provider;
- a complete but minimal conversation shell UI around the current chat panel.

The implementation excludes:

- server-side sync;
- cloud backup;
- AI-generated conversation titles;
- manual rename of conversations;
- search, pinning, sorting controls beyond a simple recent-first default;
- attachments, files, or structured outputs;
- branching conversations.

## Approaches

### Option A: Minimal complete shell with LiteDB persistence

Add a local multi-conversation store, a shell state object that manages the conversation list and current conversation, and a minimal workspace UI that supports create, switch, and delete.

Pros:

- highest user value for this slice;
- aligns with the existing store pattern and desktop-first architecture;
- keeps complexity bounded.

Cons:

- introduces one more UI state object in addition to `WorkspaceSession`.

### Option B: Data layer first, thinner UI second

Build the persistence layer now and expose only limited current-conversation recovery in the UI.

Pros:

- easier to implement incrementally.

Cons:

- does not satisfy the explicit requirement for a full conversation shell;
- delays the main user-visible benefit.

### Option C: Richer shell with titles and metadata

Implement conversation persistence together with richer shell affordances such as generated titles, rename, timestamps, and stronger session chrome.

Pros:

- more polished end result in one pass.

Cons:

- too much surface area for one slice;
- significantly larger testing and UX scope.

### Recommendation

Choose **Option A**.

It satisfies the requirement for multi-conversation persistence and a complete shell while preserving YAGNI discipline.

## Architecture

### Core Models

Add a workspace conversation domain model in `BukitJalil.Core`.

Recommended types:

- `WorkspaceConversation`
- `WorkspaceConversationMessage`
- `IWorkspaceConversationStore`

`WorkspaceConversation` should contain:

- `Id`
- `Title`
- `SelectedProviderId`
- `Messages`
- `CreatedAtUtc`
- `UpdatedAtUtc`

`WorkspaceConversationMessage` should contain:

- `Role`
- `Content`

The model stays intentionally small. It represents persisted chat state, not view-only concerns such as send-state, prompt focus, or transient status banners.

### Persistence Layer

Implement a LiteDB-backed `IWorkspaceConversationStore` in `BukitJalil.Infrastructure`.

Responsibilities:

- save and load all conversations;
- save and load the current active conversation id;
- create new empty conversations;
- update existing conversations;
- delete conversations;
- ensure the app always has one valid current conversation.

The persistence shape should follow the existing repository/store pattern already used for settings, projects, and platforms.

### Interaction State

Split workspace interaction into two layers:

- `WorkspaceShellState`: manages the list of conversations and which one is active;
- `WorkspaceSession`: manages send-state and provider interaction for the active conversation only.

This keeps boundaries clear:

- shell state owns create/switch/delete/persist concerns;
- session owns send/clear/status concerns for one active conversation.

`WorkspaceSession` should no longer be the source of truth for long-lived messages by itself. Instead, it should work against the currently active persisted conversation owned by shell state.

### App Layer

The `/workspace` page becomes a full conversation shell.

Minimal required UI regions:

- conversation list;
- new conversation action;
- current conversation panel;
- prompt and provider controls;
- delete current conversation action.

The page should remain a binding layer where possible, with business decisions staying in `WorkspaceShellState` and `WorkspaceSession`.

### Browser Helpers

Existing `workspace.js` remains responsible for DOM-only behavior:

- focus restoration;
- transcript auto-scroll.

It should not take on persistence, conversation selection, or business logic.

## Data Rules

### Conversation Titles

Titles start as a default placeholder such as `New conversation`.

When the first user message is successfully added to an untitled conversation, the title updates to a trimmed summary of that message.

Rules:

- no AI call for title generation;
- no manual rename in this slice;
- once a non-default title exists, later messages do not overwrite it.

### Active Conversation

The currently active conversation id must be persisted separately from the conversation list.

Rules:

- app start restores the saved current conversation if it still exists;
- if the saved id is missing or invalid, the app falls back to a valid existing conversation;
- if no conversations exist, the app creates one empty default conversation automatically.

### Provider Selection

`SelectedProviderId` belongs to each conversation, not to a single global page state.

Rules:

- switching conversations restores that conversation's selected provider;
- changing provider updates only the active conversation;
- newly created conversations can initialize from the current default provider selection logic.

### Delete Behavior

Deleting a conversation must never leave the app without a valid active conversation.

Rules:

- if multiple conversations remain, select the most recently updated remaining one;
- if the deleted conversation was not active, keep the current active conversation unchanged;
- if the deleted conversation was the last one, automatically create a new empty conversation and make it active.

## Interaction Flows

### App Start

1. Load all conversations from store.
2. Load the persisted active conversation id.
3. Resolve a valid current conversation.
4. If none exist, create one new empty conversation.
5. Build `WorkspaceShellState`.
6. Bind the current conversation into `WorkspaceSession`.

### New Conversation

1. User clicks `New conversation`.
2. Shell state creates a new conversation with default title and selected provider.
3. Store persists it immediately.
4. New conversation becomes active.
5. Prompt is focused for immediate input.

### Switch Conversation

1. User selects another conversation from the list.
2. Shell state persists the active conversation id.
3. Session binds to the selected conversation.
4. Transcript and selected provider update to match the new active conversation.

### Send Message

1. User sends a prompt in the active conversation.
2. Session appends the user message.
3. Provider runs and appends assistant output or failure message.
4. Shell/session persists the updated conversation.
5. `UpdatedAtUtc` is refreshed.
6. Title is derived from the first user message if still using the default title.

### Clear Conversation

1. User clicks `Clear conversation`.
2. Session clears the active conversation messages.
3. Status resets to ready.
4. The now-empty conversation is persisted.
5. Conversation identity and selected provider remain unchanged.

### Delete Conversation

1. User clicks delete for the active conversation or a list item.
2. Shell state removes it from store.
3. Shell state resolves the next active conversation.
4. If none remain, shell state creates and persists a new empty one.
5. Session rebinds to the new active conversation.

## Error Handling

Persistence errors must degrade safely rather than making the workspace unusable.

Rules:

- if save fails, show a stable status message such as `Failed to save conversation.`;
- if conversation load fails or data is invalid, recover to a new empty conversation;
- if provider execution fails, keep the current behavior of writing an assistant-facing error into the active conversation and persist that result;
- delete-last-conversation is not an error path and should always recover automatically;
- invalid persisted active conversation ids should not crash the workspace.

## Testing Strategy

Use focused unit tests plus build verification.

### Core and Infrastructure

Add tests for:

- creating and listing multiple conversations;
- saving and reloading messages;
- saving and restoring the current active conversation id;
- deleting the active conversation and selecting a valid fallback;
- starting from an empty database and creating a default conversation.

### Shared UI State

Add tests for:

- `WorkspaceShellState` create/switch/delete flows;
- restoring current conversation on initialization;
- synchronizing `WorkspaceSession` with the active conversation;
- persisting provider selection per conversation;
- clearing a conversation while preserving provider and identity.

### App Layer

Keep app-layer verification lightweight:

- build the MAUI app;
- keep Razor logic thin;
- avoid heavy browser automation unless a later slice needs it.

## Acceptance Criteria

This slice is complete when:

- the workspace supports multiple persisted conversations;
- the app restores the previous active conversation after restart;
- the user can create, switch, and delete conversations in the UI;
- each conversation restores its own messages and selected provider;
- clearing a conversation persists the cleared state without deleting the conversation;
- deleting the current or last conversation always resolves to a valid active conversation;
- app, shared state, and infrastructure tests pass.

## Out of Scope Follow-up

Future workspace slices can build on this design to add:

- manual rename;
- AI-generated titles;
- timestamps or metadata in the list;
- search and filtering;
- archived or pinned conversations;
- cloud sync or export/import.

## Summary

This design upgrades BukitJalil workspace from one temporary chat into a local multi-conversation desktop workspace:

- complete but minimal conversation shell;
- LiteDB-backed persistence;
- explicit active-conversation recovery;
- per-conversation provider state;
- safe create/switch/delete flows without speculative extras.
