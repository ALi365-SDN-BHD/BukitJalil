# Workspace Interaction Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `/workspace` with better message-send ergonomics and one minimal conversation-management action while keeping the current single in-memory session model.

**Architecture:** Keep `WorkspaceSession` as the single source of session state and add only one new session operation: `Clear()`. Keep keyboard send, focus restoration, and auto-scroll in the page layer because they are view concerns. Avoid session persistence, multi-session modeling, or transcript schema changes in this slice.

**Tech Stack:** .NET 10, MAUI Blazor, xUnit, existing `WorkspaceSession`, existing provider registry and providers, Blazor JS interop

---

## File Map

### Create

- `src/BukitJalil.App/wwwroot/workspace.js`

### Modify

- `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `src/BukitJalil.App/Components/App.razor`
- `tests/BukitJalil.App.Tests/UnitTest1.cs`

### Responsibilities

- `WorkspaceSession` owns transcript clearing and status reset behavior.
- `Counter.razor` owns keyboard send handling, prompt focus, transcript auto-scroll triggers, and clear button wiring.
- `workspace.js` owns DOM-only behavior for focusing the prompt and scrolling the transcript.
- `App.razor` loads the workspace JS file once for the app.
- `UnitTest1.cs` protects the new `Clear()` behavior and preserves current send-state coverage.

### Task 1: Add Clear-Conversation Session Behavior

**Files:**
- Modify: `tests/BukitJalil.App.Tests/UnitTest1.cs`
- Modify: `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/BukitJalil.App.Tests/UnitTest1.cs` inside `WorkspaceSessionTests`:

```csharp
    [Fact]
    public async Task Clear_removes_messages_and_resets_status_without_changing_provider()
    {
        var session = new WorkspaceSession(
            new StaticProviderRegistry(new FakeLlmProvider()),
            "fake");

        await session.SendAsync("Build a bilingual company site");
        session.Clear();

        Assert.Empty(session.Messages);
        Assert.Equal("fake", session.SelectedProviderId);
        Assert.False(session.IsSending);
        Assert.Equal("Ready.", session.StatusMessage);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter Clear_removes_messages_and_resets_status_without_changing_provider -v minimal`

Expected: FAIL with missing `Clear()` on `WorkspaceSession`.

- [ ] **Step 3: Write minimal implementation**

Update `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs` by adding this method:

```csharp
    public void Clear()
    {
        Messages.Clear();
        IsSending = false;
        StatusMessage = "Ready.";
    }
```

Place it below the `Messages` property and above `SendAsync(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter Clear_removes_messages_and_resets_status_without_changing_provider -v minimal`

Expected: PASS with the new clear behavior test.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.App.Tests/UnitTest1.cs \
  src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs
git commit -m "feat: add workspace conversation reset"
```

### Task 2: Add Workspace Browser Helpers

**Files:**
- Create: `src/BukitJalil.App/wwwroot/workspace.js`
- Modify: `src/BukitJalil.App/Components/App.razor`

- [ ] **Step 1: Write the failing verification**

Use app build as the integration gate after adding the script include.

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after markup/script edits but before fixes: build fails if the script include is malformed.

- [ ] **Step 2: Write minimal implementation**

Create `src/BukitJalil.App/wwwroot/workspace.js`:

```javascript
window.bukitWorkspace = {
  focusPrompt(promptId) {
    const element = document.getElementById(promptId);
    if (element instanceof HTMLTextAreaElement) {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    }
  },

  scrollTranscriptToBottom(transcriptId) {
    const element = document.getElementById(transcriptId);
    if (element instanceof HTMLElement) {
      element.scrollTop = element.scrollHeight;
    }
  }
};
```

Update `src/BukitJalil.App/Components/App.razor` by adding the script tag before `</body>`:

```razor
    <script src="workspace.js"></script>
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS with the new script registered.

- [ ] **Step 4: Commit**

```bash
git add src/BukitJalil.App/wwwroot/workspace.js \
  src/BukitJalil.App/Components/App.razor
git commit -m "feat: add workspace browser helpers"
```

### Task 3: Add Enter-to-Send, Auto-Scroll, Focus, and Clear Button

**Files:**
- Modify: `src/BukitJalil.App/Components/Pages/Counter.razor`

- [ ] **Step 1: Use build as the failing verification**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after page changes but before final fixes: build fails if `IJSRuntime`, event bindings, or lifecycle overrides are incorrect.

- [ ] **Step 2: Write minimal implementation**

Update `src/BukitJalil.App/Components/Pages/Counter.razor` with these changes:

Add using/injection block:

```razor
@using Microsoft.AspNetCore.Components.Web
@inject IJSRuntime JS
```

Change transcript container and prompt ids:

```razor
            <div id="workspace-transcript" class="chat-transcript">
```

```razor
                <InputTextArea id="workspace-prompt"
                               class="field-input field-input--textarea"
                               @bind-Value="_input"
                               @onkeydown="HandlePromptKeyDown"
                               disabled="@_session.IsSending" />
```

Add a clear button beside send:

```razor
                <button class="btn btn-primary" @onclick="SendAsync" disabled="@_session.IsSending">
                    @(_session.IsSending ? "Sending..." : "Send")
                </button>

                <button class="btn" @onclick="ClearConversation" disabled="@_session.IsSending">
                    Clear conversation
                </button>
```

Add these fields and lifecycle methods in `@code`:

```razor
    private int _messageCount;
    private bool _shouldFocusPrompt;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (_session.Messages.Count != _messageCount)
        {
            _messageCount = _session.Messages.Count;
            await JS.InvokeVoidAsync("bukitWorkspace.scrollTranscriptToBottom", "workspace-transcript");
        }

        if (_shouldFocusPrompt)
        {
            _shouldFocusPrompt = false;
            await JS.InvokeVoidAsync("bukitWorkspace.focusPrompt", "workspace-prompt");
        }
    }
```

Replace `SendAsync()` with:

```razor
    private async Task SendAsync()
    {
        var hadInput = !string.IsNullOrWhiteSpace(_input);
        await _session.SendAsync(_input);

        if (hadInput && !_session.IsSending)
        {
            _input = string.Empty;
            _shouldFocusPrompt = true;
        }
    }
```

Add keyboard handler and clear action:

```razor
    private async Task HandlePromptKeyDown(KeyboardEventArgs args)
    {
        if (_session.IsSending)
        {
            return;
        }

        if (args.Key == "Enter" && !args.ShiftKey)
        {
            await SendAsync();
        }
    }

    private void ClearConversation()
    {
        _session.Clear();
        _shouldFocusPrompt = true;
    }
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS with the workspace interaction wiring.

- [ ] **Step 4: Run focused verification**

Run:

```bash
dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal
dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj -v minimal
```

Then verify diagnostics for:

- `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `src/BukitJalil.App/Components/App.razor`

Expected: tests pass, build passes, diagnostics empty.

- [ ] **Step 5: Manual sanity check**

Run the app and verify:

1. Type text and press `Enter`: message sends.
2. Type text and press `Shift+Enter`: newline is inserted.
3. After a send completes, transcript scrolls to the bottom.
4. After a send completes, prompt is focused again.
5. Click `Clear conversation`: transcript clears and provider selection stays unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/BukitJalil.App/Components/Pages/Counter.razor \
  src/BukitJalil.App/Components/App.razor \
  src/BukitJalil.App/wwwroot/workspace.js \
  src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs \
  tests/BukitJalil.App.Tests/UnitTest1.cs
git commit -m "feat: improve workspace interaction flow"
```

## Self-Review

### Spec coverage

- `Enter` send and `Shift+Enter` newline: covered by Task 3.
- focus continuity and auto-scroll: covered by Task 2 and Task 3.
- clear-conversation action: covered by Task 1 and Task 3.
- no persistence or multi-session work: intentionally excluded from all tasks.

### Placeholder scan

- no `TODO`, `TBD`, or deferred instructions remain.
- each task includes concrete file paths, code, commands, and expected outcomes.

### Type consistency

- `WorkspaceSession.Clear()` is defined in Task 1 and used consistently in Task 3.
- `workspace.js` exports `window.bukitWorkspace.focusPrompt` and `scrollTranscriptToBottom`, and Task 3 uses those exact names.
- `Counter.razor` uses `KeyboardEventArgs` from `Microsoft.AspNetCore.Components.Web` consistently with the event handler signature.
