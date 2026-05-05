# Workspace Send Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the current `/workspace` chat shell with clear send-state feedback, empty-input feedback, and stable failure messaging without adding persistence or broader session management.

**Architecture:** Keep send-state logic inside `WorkspaceSession` so it remains testable without Razor rendering. Keep `Counter.razor` focused on binding and visual feedback only. Reuse the existing provider flow and transcript model rather than adding new chat abstractions.

**Tech Stack:** .NET 10, MAUI Blazor, xUnit, existing `WorkspaceSession`, existing provider registry and providers

---

## File Map

### Modify

- `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `tests/BukitJalil.App.Tests/UnitTest1.cs`

### Responsibilities

- `WorkspaceSession` owns send-state, empty-input feedback, and error/result status text.
- `Counter.razor` binds to session status and uses it to drive button text, helper text, and disabled UI state.
- `tests/BukitJalil.App.Tests/UnitTest1.cs` protects the session behavior using focused unit tests instead of Razor-heavy coverage.

### Task 1: Add Session Send-State Tests

**Files:**
- Modify: `tests/BukitJalil.App.Tests/UnitTest1.cs`

- [ ] **Step 1: Write the failing tests**

Update `tests/BukitJalil.App.Tests/UnitTest1.cs` by adding these tests to `WorkspaceSessionTests`:

```csharp
    [Fact]
    public async Task SendAsync_sets_status_message_for_blank_input()
    {
        var session = new WorkspaceSession(
            new StaticProviderRegistry(new FakeLlmProvider()),
            "fake");

        await session.SendAsync("   ");

        Assert.Empty(session.Messages);
        Assert.False(session.IsSending);
        Assert.Contains("enter a prompt", session.StatusMessage, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SendAsync_toggles_send_state_and_sets_success_status()
    {
        var provider = new DelayedProvider();
        var session = new WorkspaceSession(
            new StaticProviderRegistry(provider),
            "fake");

        var sendTask = session.SendAsync("Build a pricing page");

        Assert.True(session.IsSending);
        Assert.Contains("sending", session.StatusMessage, StringComparison.OrdinalIgnoreCase);

        provider.Release();
        await sendTask;

        Assert.False(session.IsSending);
        Assert.Contains("response received", session.StatusMessage, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SendAsync_sets_failure_status_when_provider_throws()
    {
        var session = new WorkspaceSession(
            new StaticProviderRegistry(new ThrowingProvider()),
            "fake");

        await session.SendAsync("Build a pricing page");

        Assert.False(session.IsSending);
        Assert.Contains("failed", session.StatusMessage, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(session.Messages, item => item.Role == LlmRole.Assistant);
    }
```

Also add these helper providers inside the test file:

```csharp
    private sealed class DelayedProvider : ILlmProvider
    {
        private readonly TaskCompletionSource _completion = new();

        public ProviderDescriptor Descriptor { get; } = new("fake", "Fake Provider", true);

        public void Release() => _completion.SetResult();

        public async Task<LlmChatResponse> ChatAsync(LlmChatRequest request, CancellationToken cancellationToken = default)
        {
            await _completion.Task.WaitAsync(cancellationToken);

            return new LlmChatResponse(
                Descriptor.Id,
                new LlmMessage(LlmRole.Assistant, "Done"));
        }
    }

    private sealed class ThrowingProvider : ILlmProvider
    {
        public ProviderDescriptor Descriptor { get; } = new("fake", "Fake Provider", true);

        public Task<LlmChatResponse> ChatAsync(LlmChatRequest request, CancellationToken cancellationToken = default)
        {
            throw new InvalidOperationException("boom");
        }
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceSessionTests -v minimal`

Expected: FAIL because `WorkspaceSession` does not yet expose `IsSending` or `StatusMessage`.

- [ ] **Step 3: Write minimal implementation**

Update `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`:

```csharp
using BukitJalil.Core;

namespace BukitJalil.App.Workspace;

public sealed class WorkspaceSession
{
    private readonly IProviderRegistry _providerRegistry;

    public WorkspaceSession(IProviderRegistry providerRegistry, string selectedProviderId)
    {
        _providerRegistry = providerRegistry;
        SelectedProviderId = selectedProviderId;
    }

    public string SelectedProviderId { get; set; }

    public bool IsSending { get; private set; }

    public string StatusMessage { get; private set; } = "Ready.";

    public List<LlmMessage> Messages { get; } = [];

    public async Task SendAsync(string input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            StatusMessage = "Enter a prompt before sending.";
            return;
        }

        var trimmedInput = input.Trim();
        Messages.Add(new LlmMessage(LlmRole.User, trimmedInput));

        var provider = _providerRegistry.Get(SelectedProviderId);
        if (provider is null)
        {
            StatusMessage = $"Provider '{SelectedProviderId}' is unavailable.";
            Messages.Add(new LlmMessage(LlmRole.Assistant, StatusMessage));
            return;
        }

        IsSending = true;
        StatusMessage = "Sending request...";

        try
        {
            var response = await provider.ChatAsync(new LlmChatRequest(Messages), cancellationToken);
            Messages.Add(response.Message);
            StatusMessage = "Response received.";
        }
        catch (Exception exception)
        {
            StatusMessage = $"Provider execution failed: {exception.Message}";
            Messages.Add(new LlmMessage(LlmRole.Assistant, StatusMessage));
        }
        finally
        {
            IsSending = false;
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceSessionTests -v minimal`

Expected: PASS with the added send-state tests.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.App.Tests/UnitTest1.cs \
  src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs
git commit -m "feat: add workspace send status state"
```

### Task 2: Bind Send-State in Workspace Page

**Files:**
- Modify: `src/BukitJalil.App/Components/Pages/Counter.razor`

- [ ] **Step 1: Use build as the failing verification**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after markup edits but before final fixes: build fails if bindings to `IsSending` or `StatusMessage` are incorrect.

- [ ] **Step 2: Write minimal implementation**

Update `src/BukitJalil.App/Components/Pages/Counter.razor` so the page binds to session send-state:

```razor
            <div class="form-stack">
                <label class="field-label" for="provider">Provider</label>
                <InputSelect id="provider" class="field-input" @bind-Value="_session.SelectedProviderId" disabled="@_session.IsSending">
                    @foreach (var provider in _providers)
                    {
                        <option value="@provider.Id">@provider.DisplayName</option>
                    }
                </InputSelect>

                <label class="field-label" for="prompt">Prompt</label>
                <InputTextArea id="prompt" class="field-input field-input--textarea" @bind-Value="_input" disabled="@_session.IsSending" />

                <button class="btn btn-primary" @onclick="SendAsync" disabled="@_session.IsSending">
                    @(_session.IsSending ? "Sending..." : "Send")
                </button>

                <p class="save-status">@_session.StatusMessage</p>
            </div>
```

Update the send handler:

```razor
    private async Task SendAsync()
    {
        await _session.SendAsync(_input);

        if (!string.IsNullOrWhiteSpace(_input) && !_session.IsSending)
        {
            _input = string.Empty;
        }
    }
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS with send-state UI wiring.

- [ ] **Step 4: Run focused verification**

Run:

```bash
dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal
dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj -v minimal
```

Then check diagnostics for:

- `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`
- `src/BukitJalil.App/Components/Pages/Counter.razor`

Expected: tests pass, build passes, diagnostics empty.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.App/Components/Pages/Counter.razor \
  src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs \
  tests/BukitJalil.App.Tests/UnitTest1.cs
git commit -m "feat: wire workspace send status"
```

## Self-Review

### Spec coverage

- send-state feedback: covered by Task 1 and Task 2.
- empty-input feedback: covered by Task 1.
- provider failure feedback: covered by Task 1.
- page binding and button/input disabled state: covered by Task 2.

### Placeholder scan

- no `TODO`, `TBD`, or deferred wording remains.
- each task includes explicit files, code, commands, and expected results.

### Type consistency

- `WorkspaceSession.IsSending` and `WorkspaceSession.StatusMessage` are used consistently across tests and page markup.
- `SendAsync(string input, CancellationToken cancellationToken = default)` remains unchanged.
