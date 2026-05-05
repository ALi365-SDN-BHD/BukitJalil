# Workspace Chat Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real BukitJalil workspace chat shell with provider contracts, a provider registry, one fake provider, and a send-message flow that appends user and assistant messages.

**Architecture:** Keep contracts and chat models in `BukitJalil.Core`, concrete provider behavior in `BukitJalil.Infrastructure`, and page/session state in `BukitJalil.App`. Use a small testable `WorkspaceSession` class to avoid burying async chat flow inside Razor markup.

**Tech Stack:** .NET 10, MAUI Blazor, xUnit, Microsoft DI, LiteDB-backed app foundation, fake in-process provider

---

## File Map

### Create

- `src/BukitJalil.Core/LlmRole.cs`
- `src/BukitJalil.Core/LlmMessage.cs`
- `src/BukitJalil.Core/LlmChatRequest.cs`
- `src/BukitJalil.Core/LlmChatResponse.cs`
- `src/BukitJalil.Core/ProviderDescriptor.cs`
- `src/BukitJalil.Core/ILlmProvider.cs`
- `src/BukitJalil.Core/IProviderRegistry.cs`
- `src/BukitJalil.Infrastructure/FakeLlmProvider.cs`
- `src/BukitJalil.Infrastructure/ProviderRegistry.cs`
- `src/BukitJalil.App/Workspace/WorkspaceSession.cs`
- `tests/BukitJalil.Core.Tests/ProviderContractsTests.cs`
- `tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs`
- `tests/BukitJalil.App.Tests/WorkspaceSessionTests.cs`

### Modify

- `src/BukitJalil.Infrastructure/Class1.cs`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `src/BukitJalil.App/wwwroot/app.css`
- `tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj`
- `tests/BukitJalil.App.Tests/UnitTest1.cs`

### Responsibilities

- `BukitJalil.Core/*Llm*` and provider files define stable abstractions that future real providers can implement.
- `FakeLlmProvider` returns deterministic local responses for UI development and testing.
- `ProviderRegistry` supplies descriptors for UI binding and resolves providers by stable id.
- `WorkspaceSession` owns provider selection, input validation, and message append order.
- `/workspace` renders the session state with a selector, transcript, input, and send button.

### Task 1: Add Core Provider Contracts

**Files:**
- Create: `tests/BukitJalil.Core.Tests/ProviderContractsTests.cs`
- Create: `src/BukitJalil.Core/LlmRole.cs`
- Create: `src/BukitJalil.Core/LlmMessage.cs`
- Create: `src/BukitJalil.Core/LlmChatRequest.cs`
- Create: `src/BukitJalil.Core/LlmChatResponse.cs`
- Create: `src/BukitJalil.Core/ProviderDescriptor.cs`
- Create: `src/BukitJalil.Core/ILlmProvider.cs`
- Create: `src/BukitJalil.Core/IProviderRegistry.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/BukitJalil.Core.Tests/ProviderContractsTests.cs`:

```csharp
using BukitJalil.Core;

namespace BukitJalil.Core.Tests;

public sealed class ProviderContractsTests
{
    [Fact]
    public void LlmMessage_create_user_message_preserves_role_and_content()
    {
        var message = new LlmMessage(LlmRole.User, "Build a corporate website");

        Assert.Equal(LlmRole.User, message.Role);
        Assert.Equal("Build a corporate website", message.Content);
    }

    [Fact]
    public void LlmChatRequest_wraps_messages_in_order()
    {
        var request = new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "First"),
            new LlmMessage(LlmRole.Assistant, "Second")
        ]);

        Assert.Collection(
            request.Messages,
            item => Assert.Equal("First", item.Content),
            item => Assert.Equal("Second", item.Content));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.Core.Tests/BukitJalil.Core.Tests.csproj --filter ProviderContractsTests -v minimal`

Expected: FAIL with missing `LlmRole`, `LlmMessage`, and `LlmChatRequest` types.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.Core/LlmRole.cs`:

```csharp
namespace BukitJalil.Core;

public enum LlmRole
{
    System,
    User,
    Assistant
}
```

Create `src/BukitJalil.Core/LlmMessage.cs`:

```csharp
namespace BukitJalil.Core;

public sealed record LlmMessage(LlmRole Role, string Content);
```

Create `src/BukitJalil.Core/LlmChatRequest.cs`:

```csharp
namespace BukitJalil.Core;

public sealed record LlmChatRequest(IReadOnlyList<LlmMessage> Messages);
```

Create `src/BukitJalil.Core/LlmChatResponse.cs`:

```csharp
namespace BukitJalil.Core;

public sealed record LlmChatResponse(string ProviderId, LlmMessage Message);
```

Create `src/BukitJalil.Core/ProviderDescriptor.cs`:

```csharp
namespace BukitJalil.Core;

public sealed record ProviderDescriptor(string Id, string DisplayName, bool IsFake);
```

Create `src/BukitJalil.Core/ILlmProvider.cs`:

```csharp
namespace BukitJalil.Core;

public interface ILlmProvider
{
    ProviderDescriptor Descriptor { get; }

    Task<LlmChatResponse> ChatAsync(LlmChatRequest request, CancellationToken cancellationToken = default);
}
```

Create `src/BukitJalil.Core/IProviderRegistry.cs`:

```csharp
namespace BukitJalil.Core;

public interface IProviderRegistry
{
    IReadOnlyList<ProviderDescriptor> List();

    ILlmProvider? Get(string providerId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.Core.Tests/BukitJalil.Core.Tests.csproj --filter ProviderContractsTests -v minimal`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.Core.Tests/ProviderContractsTests.cs \
  src/BukitJalil.Core/LlmRole.cs \
  src/BukitJalil.Core/LlmMessage.cs \
  src/BukitJalil.Core/LlmChatRequest.cs \
  src/BukitJalil.Core/LlmChatResponse.cs \
  src/BukitJalil.Core/ProviderDescriptor.cs \
  src/BukitJalil.Core/ILlmProvider.cs \
  src/BukitJalil.Core/IProviderRegistry.cs
git commit -m "feat: add llm provider contracts"
```

### Task 2: Add Fake Provider and Registry

**Files:**
- Create: `tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs`
- Create: `src/BukitJalil.Infrastructure/FakeLlmProvider.cs`
- Create: `src/BukitJalil.Infrastructure/ProviderRegistry.cs`
- Modify: `src/BukitJalil.Infrastructure/Class1.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs`:

```csharp
using BukitJalil.Core;
using BukitJalil.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Infrastructure.Tests;

public sealed class ProviderRegistryTests
{
    [Fact]
    public void ProviderRegistry_lists_fake_provider()
    {
        var services = new ServiceCollection();
        services.AddBukitJalilInfrastructure(options => options.AppDataDirectory = Path.Combine(Path.GetTempPath(), "bj-registry-tests", Guid.NewGuid().ToString("N")));

        using var provider = services.BuildServiceProvider();
        var registry = provider.GetRequiredService<IProviderRegistry>();

        Assert.Contains(registry.List(), item => item.Id == "fake");
    }

    [Fact]
    public async Task FakeProvider_returns_deterministic_response()
    {
        var fake = new FakeLlmProvider();
        var response = await fake.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Create a business landing page")
        ]));

        Assert.Equal("fake", response.ProviderId);
        Assert.Equal(LlmRole.Assistant, response.Message.Role);
        Assert.Contains("simulated", response.Message.Content, StringComparison.OrdinalIgnoreCase);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter ProviderRegistryTests -v minimal`

Expected: FAIL with missing `IProviderRegistry`, `FakeLlmProvider`, and/or DI registration.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.Infrastructure/FakeLlmProvider.cs`:

```csharp
using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

public sealed class FakeLlmProvider : ILlmProvider
{
    public ProviderDescriptor Descriptor { get; } = new("fake", "Fake Provider", true);

    public Task<LlmChatResponse> ChatAsync(LlmChatRequest request, CancellationToken cancellationToken = default)
    {
        var latestUserMessage = request.Messages.LastOrDefault(message => message.Role == LlmRole.User)?.Content ?? "No prompt provided.";
        var content = $"Received your request: \"{latestUserMessage}\".\nNext step: outline the page structure.\nNote: this is a simulated provider response.";

        return Task.FromResult(new LlmChatResponse(
            Descriptor.Id,
            new LlmMessage(LlmRole.Assistant, content)));
    }
}
```

Create `src/BukitJalil.Infrastructure/ProviderRegistry.cs`:

```csharp
using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

internal sealed class ProviderRegistry(IEnumerable<ILlmProvider> providers) : IProviderRegistry
{
    private readonly IReadOnlyList<ILlmProvider> _providers = providers.ToList();

    public ILlmProvider? Get(string providerId)
    {
        return _providers.FirstOrDefault(provider => string.Equals(provider.Descriptor.Id, providerId, StringComparison.OrdinalIgnoreCase));
    }

    public IReadOnlyList<ProviderDescriptor> List()
    {
        return _providers.Select(provider => provider.Descriptor).ToList();
    }
}
```

Update `src/BukitJalil.Infrastructure/Class1.cs` registration block:

```csharp
        services.AddSingleton<ILlmProvider, FakeLlmProvider>();
        services.AddSingleton<IProviderRegistry, ProviderRegistry>();
```

Place these registrations before `return services;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter ProviderRegistryTests -v minimal`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs \
  src/BukitJalil.Infrastructure/FakeLlmProvider.cs \
  src/BukitJalil.Infrastructure/ProviderRegistry.cs \
  src/BukitJalil.Infrastructure/Class1.cs
git commit -m "feat: add fake provider registry"
```

### Task 3: Add Testable Workspace Session

**Files:**
- Modify: `tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj`
- Modify: `tests/BukitJalil.App.Tests/UnitTest1.cs`
- Create: `src/BukitJalil.App/Workspace/WorkspaceSession.cs`

- [ ] **Step 1: Write the failing test**

Replace `tests/BukitJalil.App.Tests/UnitTest1.cs` with:

```csharp
using BukitJalil.App.Workspace;
using BukitJalil.Core;

namespace BukitJalil.App.Tests;

public sealed class WorkspaceSessionTests
{
    [Fact]
    public async Task SendAsync_appends_user_and_assistant_messages_in_order()
    {
        var session = new WorkspaceSession(
            new StaticProviderRegistry(new FakeLlmProvider()),
            "fake");

        await session.SendAsync("Build a bilingual company site");

        Assert.Collection(
            session.Messages,
            item =>
            {
                Assert.Equal(LlmRole.User, item.Role);
                Assert.Equal("Build a bilingual company site", item.Content);
            },
            item =>
            {
                Assert.Equal(LlmRole.Assistant, item.Role);
                Assert.Contains("simulated", item.Content, StringComparison.OrdinalIgnoreCase);
            });
    }

    private sealed class StaticProviderRegistry(ILlmProvider provider) : IProviderRegistry
    {
        public ILlmProvider? Get(string providerId) => providerId == provider.Descriptor.Id ? provider : null;

        public IReadOnlyList<ProviderDescriptor> List() => [provider.Descriptor];
    }
}
```

Update `tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj` to reference non-MAUI projects only:

```xml
  <ItemGroup>
    <ProjectReference Include="..\..\src\BukitJalil.Core\BukitJalil.Core.csproj" />
    <ProjectReference Include="..\..\src\BukitJalil.Infrastructure\BukitJalil.Infrastructure.csproj" />
  </ItemGroup>
```

Also remove any `ProjectReference` to `src/BukitJalil.App/BukitJalil.App.csproj`.

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceSessionTests -v minimal`

Expected: FAIL with missing `WorkspaceSession`.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.App/Workspace/WorkspaceSession.cs`:

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

    public List<LlmMessage> Messages { get; } = [];

    public async Task SendAsync(string input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return;
        }

        var trimmedInput = input.Trim();
        Messages.Add(new LlmMessage(LlmRole.User, trimmedInput));

        var provider = _providerRegistry.Get(SelectedProviderId);
        if (provider is null)
        {
            Messages.Add(new LlmMessage(LlmRole.Assistant, $"Provider '{SelectedProviderId}' is unavailable."));
            return;
        }

        try
        {
            var response = await provider.ChatAsync(new LlmChatRequest(Messages), cancellationToken);
            Messages.Add(response.Message);
        }
        catch (Exception exception)
        {
            Messages.Add(new LlmMessage(LlmRole.Assistant, $"Provider execution failed: {exception.Message}"));
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceSessionTests -v minimal`

Expected: PASS with 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj \
  tests/BukitJalil.App.Tests/UnitTest1.cs \
  src/BukitJalil.App/Workspace/WorkspaceSession.cs
git commit -m "feat: add workspace session flow"
```

### Task 4: Wire the Workspace Page

**Files:**
- Modify: `src/BukitJalil.App/Components/Pages/Counter.razor`
- Modify: `src/BukitJalil.App/wwwroot/app.css`

- [ ] **Step 1: Write the failing test**

Use the existing app build as the integration gate for the page wiring.

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after page rewrite but before final fixes: build should fail if bindings, namespaces, or injected services are wrong.

- [ ] **Step 2: Write minimal implementation**

Replace `src/BukitJalil.App/Components/Pages/Counter.razor` with:

```razor
@page "/workspace"
@using BukitJalil.App.Workspace
@inject IProviderRegistry ProviderRegistry

<PageTitle>Workspace</PageTitle>

<section class="workspace-page">
    <header class="workspace-page__header">
        <p class="workspace-page__eyebrow">Workspace</p>
        <h1>AI building workspace shell</h1>
        <p class="workspace-page__lede">
            This shell now supports a local chat flow with provider selection and a deterministic fake response.
        </p>
    </header>

    <div class="workspace-chat-layout">
        <section class="workspace-panel">
            <div class="workspace-panel__header">
                <div>
                    <p class="workspace-panel__eyebrow">Conversation</p>
                    <h2>Chat panel</h2>
                </div>
            </div>

            <div class="chat-transcript">
                @if (_session.Messages.Count == 0)
                {
                    <p class="empty-state">No messages yet. Send a prompt to exercise the fake provider flow.</p>
                }
                else
                {
                    @foreach (var message in _session.Messages)
                    {
                        <article class="chat-message @(message.Role == LlmRole.User ? "chat-message--user" : "chat-message--assistant")">
                            <div class="chat-message__role">@message.Role</div>
                            <div class="chat-message__content">@message.Content</div>
                        </article>
                    }
                }
            </div>
        </section>

        <section class="workspace-panel">
            <div class="workspace-panel__header">
                <div>
                    <p class="workspace-panel__eyebrow">Controls</p>
                    <h2>Provider and prompt</h2>
                </div>
            </div>

            <div class="form-stack">
                <label class="field-label" for="provider">Provider</label>
                <InputSelect id="provider" class="field-input" @bind-Value="_session.SelectedProviderId">
                    @foreach (var provider in _providers)
                    {
                        <option value="@provider.Id">@provider.DisplayName</option>
                    }
                </InputSelect>

                <label class="field-label" for="prompt">Prompt</label>
                <InputTextArea id="prompt" class="field-input field-input--textarea" @bind-Value="_input" />

                <button class="btn btn-primary" @onclick="SendAsync" disabled="@_isSending">Send</button>
            </div>
        </section>
    </div>
</section>

@code {
    private WorkspaceSession _session = default!;
    private IReadOnlyList<ProviderDescriptor> _providers = [];
    private string _input = string.Empty;
    private bool _isSending;

    protected override void OnInitialized()
    {
        _providers = ProviderRegistry.List();
        var defaultProviderId = _providers.FirstOrDefault()?.Id ?? "fake";
        _session = new WorkspaceSession(ProviderRegistry, defaultProviderId);
    }

    private async Task SendAsync()
    {
        _isSending = true;
        try
        {
            await _session.SendAsync(_input);
            _input = string.Empty;
        }
        finally
        {
            _isSending = false;
        }
    }
}
```

Append these styles to `src/BukitJalil.App/wwwroot/app.css`:

```css
.workspace-chat-layout {
    display: grid;
    gap: 1rem;
}

.chat-transcript {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.chat-message {
    padding: 0.9rem 1rem;
    border-radius: 0.9rem;
    border: 1px solid #dbe3f0;
}

.chat-message--user {
    background: #eef5ff;
}

.chat-message--assistant {
    background: #f9fbfe;
}

.chat-message__role {
    margin-bottom: 0.35rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #49648a;
}

.chat-message__content {
    white-space: pre-wrap;
    line-height: 1.6;
    color: #10233f;
}

.field-input--textarea {
    min-height: 8rem;
    resize: vertical;
}

@media (min-width: 1100px) {
    .workspace-chat-layout {
        grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
    }
}
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS with the updated workspace page.

- [ ] **Step 4: Run focused tests and diagnostics**

Run:

```bash
dotnet test tests/BukitJalil.Core.Tests/BukitJalil.Core.Tests.csproj -v minimal
dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj -v minimal
dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal
```

Then verify diagnostics for:

- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `src/BukitJalil.App/Workspace/WorkspaceSession.cs`
- `src/BukitJalil.Infrastructure/FakeLlmProvider.cs`

Expected: all tests pass, diagnostics empty.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.App/Components/Pages/Counter.razor \
  src/BukitJalil.App/wwwroot/app.css \
  src/BukitJalil.App/Workspace/WorkspaceSession.cs \
  tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj \
  tests/BukitJalil.App.Tests/UnitTest1.cs
git commit -m "feat: add workspace chat shell"
```

## Self-Review

### Spec coverage

- Provider contracts: covered by Task 1.
- Provider registry and fake provider: covered by Task 2.
- Testable workspace session: covered by Task 3.
- Workspace page with selector, transcript, input, and send button: covered by Task 4.
- Fake deterministic flow and basic error handling: covered by Task 3 and Task 4.

### Placeholder scan

- No `TODO`, `TBD`, or deferred test wording remains.
- Each task contains concrete file paths, code snippets, and commands.

### Type consistency

- `IProviderRegistry.List()` returns `IReadOnlyList<ProviderDescriptor>` consistently across tasks.
- `ILlmProvider.ChatAsync(LlmChatRequest, CancellationToken)` stays consistent across tasks.
- `WorkspaceSession.SelectedProviderId` matches page binding and registry lookup.

