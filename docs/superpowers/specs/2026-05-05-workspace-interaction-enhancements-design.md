# Workspace Interaction Enhancements Design

## Goal

This spec defines the next focused BukitJalil workspace interaction slice:

- improve message-send ergonomics;
- keep the current single-session chat shell simple;
- add one minimal session-management action without introducing session persistence.

The goal is to make `/workspace` feel usable for repeated local interaction before expanding into persistent or multi-session workflows.

## Scope

The implementation includes:

- press `Enter` to send;
- press `Shift+Enter` to insert a newline;
- keep the prompt ready for follow-up input after send;
- auto-scroll the transcript to the newest message;
- add one `Clear conversation` action;
- keep send-state and status feedback integrated with the existing `WorkspaceSession`.

The implementation excludes:

- persistent chat sessions;
- multi-session lists or switching;
- generated session titles;
- message timestamps;
- rich text or markdown rendering;
- file/code/preview panel interaction.

## Recommended Approach

### Option A: Message experience first plus one clear action

Add keyboard send, auto-scroll, focus continuity, and a clear-conversation button.

Pros:

- highest usability gain for the current shell;
- keeps state model small;
- avoids premature session architecture.

Cons:

- still only one in-memory conversation.

### Option B: Session shell first

Start with current-session header, clear action, and session container structure before keyboard and scroll polish.

Pros:

- prepares for future multi-session work.

Cons:

- less immediate user-value than message ergonomics;
- risks building empty scaffolding too early.

### Option C: Mixed larger slice

Do message ergonomics, clear action, and a current-session title/status bar together.

Pros:

- more complete feeling in one pass.

Cons:

- wider UI and state surface;
- harder to keep focused and testable.

### Recommendation

Choose **Option A**.

It gives the current workspace shell the biggest usability improvement while preserving the existing architecture and avoiding speculative session modeling.

## Architecture

### Session State

`WorkspaceSession` remains the single interaction state object for the current workspace conversation.

Changes:

- add a `Clear()` operation;
- keep `Messages`, `SelectedProviderId`, `IsSending`, and `StatusMessage` as the canonical state surface;
- do not introduce persisted or serializable session records in this slice.

Rules:

- clearing a conversation resets transcript and status;
- clearing must not change provider selection;
- send-state continues to live in the session object, not separately in the page.

### Page Behavior

`Counter.razor` continues to act as the `/workspace` page and remains primarily a binding layer.

Changes:

- handle keyboard send behavior in the page;
- keep prompt focus ready for the next interaction;
- trigger transcript auto-scroll after messages change;
- expose one `Clear conversation` button.

Rules:

- `Enter` sends only when `Shift` is not pressed;
- `Shift+Enter` keeps multiline authoring available;
- the page should not duplicate transcript or send-state logic already owned by `WorkspaceSession`.

### Browser Interaction

Auto-scroll and focus continuity are view concerns, so they belong in the page layer rather than the session state object.

This slice can use lightweight page-side logic for:

- detecting keyboard intent;
- scrolling the transcript container;
- restoring prompt focus after send completion.

No additional service layer is required for this behavior.

## Interaction Flow

### Send Flow

1. User types in the prompt.
2. User presses `Enter` or clicks `Send`.
3. The page forwards the input to `WorkspaceSession.SendAsync(...)`.
4. The session appends the user message and drives provider execution.
5. The page observes updated session state.
6. After completion, the transcript scrolls to the newest message.
7. Prompt focus returns so the user can continue typing.

### Multiline Flow

1. User types in the prompt.
2. User presses `Shift+Enter`.
3. The page inserts a newline instead of sending.
4. No provider call is made.

### Clear Flow

1. User clicks `Clear conversation`.
2. The page calls `WorkspaceSession.Clear()`.
3. The session clears messages and resets status text.
4. Provider selection remains unchanged.
5. The transcript returns to the empty state view.

## Error Handling

This slice keeps existing send error behavior and adds interaction-safe handling:

- if the input is blank, the existing session status feedback remains visible;
- if the provider fails, the assistant-style error remains in the transcript;
- if the user tries to send while already sending, the UI stays disabled and no second request is issued;
- clearing is unavailable while sending.

## Testing Strategy

Follow TDD with focused unit coverage and build verification.

Required tests:

- `WorkspaceSession.Clear()` removes all messages and resets status;
- keyboard/send behavior is validated through page-side buildable logic, not heavy rendered component tests;
- existing send-state tests stay green;
- existing provider and registry tests stay green.

Integration verification:

- app build passes;
- manual or browser-assisted sanity check can confirm `Enter`, `Shift+Enter`, and auto-scroll behavior if needed.

Avoid:

- large Razor test harnesses;
- tests that only restate CSS or markup structure;
- introducing browser automation unless the lightweight build/test path leaves uncertainty.

## Acceptance Criteria

This slice is complete when:

- pressing `Enter` sends the current prompt;
- pressing `Shift+Enter` inserts a newline without sending;
- after a successful send, the transcript scrolls to the newest message;
- after send completion, the prompt is ready for immediate follow-up input;
- the user can clear the current in-memory conversation with one action;
- clearing the conversation does not reset the selected provider;
- current app and infrastructure tests continue to pass.

## Out of Scope Follow-up

The next workspace slices can build on this foundation to add:

- multiple named sessions;
- persisted chat history;
- session titles or summaries;
- message timestamps;
- richer transcript rendering;
- project-linked workspace memory.

## Summary

This design improves the current workspace shell without expanding it into a full session system:

- smoother message sending;
- better transcript usability;
- one minimal conversation reset action;
- no speculative persistence or multi-session structure.
