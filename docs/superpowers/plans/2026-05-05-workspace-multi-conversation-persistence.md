# Workspace Multi-Conversation Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LiteDB-backed multi-conversation persistence and a complete minimal conversation shell to `/workspace`, including create, switch, delete, restore-active, and per-conversation provider state.

**Architecture:** Add small core conversation models plus a new `IWorkspaceConversationStore` that persists both the conversation list and current active conversation id. Introduce `WorkspaceShellState` to manage create/switch/delete flows and rework `WorkspaceSession` so it operates on the currently active persisted conversation instead of owning long-lived messages itself. Keep the Razor page thin and keep DOM-only behavior in `workspace.js`.

**Tech Stack:** .NET 10, C#, MAUI Blazor, LiteDB, xUnit, existing store pattern, existing provider contracts, Blazor JS interop

---

## File Map

### Create

- `src/BukitJalil.Core/WorkspaceConversation.cs`
- `src/BukitJalil.Core/IWorkspaceConversationStore.cs`
- `src/BukitJalil.Infrastructure/LiteDbWorkspaceConversationStore.cs`
- `src/BukitJalil.SharedUi/Workspace/WorkspaceShellState.cs`
- `tests/BukitJalil.Infrastructure.Tests/WorkspaceConversationStoreTests.cs`
- `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs`

### Modify

- `src/BukitJalil.Infrastructure/AppDatabase.cs`
- `src/BukitJalil.Infrastructure/Class1.cs`
- `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `tests/BukitJalil.App.Tests/UnitTest1.cs`

### Responsibilities

- `WorkspaceConversation.cs` defines the persisted conversation model and message type.
- `IWorkspaceConversationStore.cs` defines conversation persistence and active-conversation operations.
- `LiteDbWorkspaceConversationStore.cs` maps conversations to LiteDB documents and enforces valid current-conversation recovery.
- `WorkspaceShellState.cs` manages create/switch/delete/rebind behavior for the workspace shell.
- `WorkspaceSession.cs` handles send/clear/status for the active conversation object supplied by shell state.
- `Counter.razor` renders the full conversation shell and delegates behavior to shell/session state.

### Task 1: Add Core Conversation Contracts

**Files:**
- Create: `src/BukitJalil.Core/WorkspaceConversation.cs`
- Create: `src/BukitJalil.Core/IWorkspaceConversationStore.cs`
- Test: `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs` with this initial contract test:

```csharp
using BukitJalil.Core;

namespace BukitJalil.App.Tests;

public sealed class WorkspaceConversationContractsTests
{
    [Fact]
    public void WorkspaceConversation_starts_with_defaults()
    {
        var conversation = WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z"));

        Assert.NotEmpty(conversation.Id);
        Assert.Equal("New conversation", conversation.Title);
        Assert.Equal("fake", conversation.SelectedProviderId);
        Assert.Empty(conversation.Messages);
        Assert.Equal(conversation.CreatedAtUtc, conversation.UpdatedAtUtc);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceConversation_starts_with_defaults -v minimal`

Expected: FAIL with missing `WorkspaceConversation`.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.Core/WorkspaceConversation.cs`:

```csharp
namespace BukitJalil.Core;

public sealed record WorkspaceConversation
{
    public const string DefaultTitle = "New conversation";

    public string Id { get; init; } = Guid.NewGuid().ToString("n");

    public string Title { get; set; } = DefaultTitle;

    public string SelectedProviderId { get; set; } = string.Empty;

    public List<WorkspaceConversationMessage> Messages { get; init; } = [];

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public static WorkspaceConversation Create(string selectedProviderId, DateTimeOffset nowUtc)
    {
        return new WorkspaceConversation
        {
            SelectedProviderId = selectedProviderId,
            CreatedAtUtc = nowUtc,
            UpdatedAtUtc = nowUtc
        };
    }
}

public sealed record WorkspaceConversationMessage(LlmRole Role, string Content);
```

Create `src/BukitJalil.Core/IWorkspaceConversationStore.cs`:

```csharp
namespace BukitJalil.Core;

public interface IWorkspaceConversationStore
{
    IReadOnlyList<WorkspaceConversation> List();

    string? GetCurrentConversationId();

    WorkspaceConversation Save(WorkspaceConversation conversation, bool makeCurrent);

    void Delete(string conversationId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceConversation_starts_with_defaults -v minimal`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.Core/WorkspaceConversation.cs \
  src/BukitJalil.Core/IWorkspaceConversationStore.cs \
  tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs
git commit -m "feat: add workspace conversation contracts"
```

### Task 2: Add LiteDB Conversation Persistence

**Files:**
- Modify: `src/BukitJalil.Infrastructure/AppDatabase.cs`
- Create: `src/BukitJalil.Infrastructure/LiteDbWorkspaceConversationStore.cs`
- Modify: `src/BukitJalil.Infrastructure/Class1.cs`
- Create: `tests/BukitJalil.Infrastructure.Tests/WorkspaceConversationStoreTests.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/BukitJalil.Infrastructure.Tests/WorkspaceConversationStoreTests.cs`:

```csharp
using BukitJalil.Core;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Infrastructure.Tests;

public sealed class WorkspaceConversationStoreTests : IDisposable
{
    private readonly string _tempRoot = Path.Combine(Path.GetTempPath(), "bukitjalil-tests", Guid.NewGuid().ToString("n"));

    [Fact]
    public void Store_round_trips_multiple_conversations_and_current_id()
    {
        using var services = BuildServices();
        var store = services.GetRequiredService<IWorkspaceConversationStore>();

        var first = store.Save(WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z")), makeCurrent: true);
        var second = WorkspaceConversation.Create("openai-compatible", DateTimeOffset.Parse("2026-05-05T13:00:00Z"));
        second.Messages.Add(new WorkspaceConversationMessage(LlmRole.User, "Generate a landing page"));
        store.Save(second, makeCurrent: true);

        var conversations = store.List();
        var currentId = store.GetCurrentConversationId();

        Assert.Equal(2, conversations.Count);
        Assert.Equal(second.Id, currentId);
        Assert.Contains(conversations, item => item.Messages.Any(message => message.Content == "Generate a landing page"));
    }

    [Fact]
    public void Delete_removes_conversation_and_clears_current_id_when_target_was_current()
    {
        using var services = BuildServices();
        var store = services.GetRequiredService<IWorkspaceConversationStore>();

        var conversation = store.Save(WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z")), makeCurrent: true);
        store.Delete(conversation.Id);

        Assert.Empty(store.List());
        Assert.Null(store.GetCurrentConversationId());
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempRoot))
        {
            Directory.Delete(_tempRoot, recursive: true);
        }
    }

    private ServiceProvider BuildServices()
    {
        var services = new ServiceCollection();
        services.AddBukitJalilInfrastructure(new BukitJalilStorageOptions
        {
            AppDataDirectory = _tempRoot,
            ProjectsRootPath = Path.Combine(_tempRoot, "projects")
        });
        return services.BuildServiceProvider();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter WorkspaceConversationStoreTests -v minimal`

Expected: FAIL with missing `IWorkspaceConversationStore` registration and missing implementation.

- [ ] **Step 3: Write minimal implementation**

Update `src/BukitJalil.Infrastructure/AppDatabase.cs` by adding:

```csharp
    public ILiteCollection<WorkspaceConversationDocument> WorkspaceConversations =>
        _database.GetCollection<WorkspaceConversationDocument>("workspace_conversations");

    public ILiteCollection<WorkspaceStateDocument> WorkspaceState =>
        _database.GetCollection<WorkspaceStateDocument>("workspace_state");
```

and inside the constructor:

```csharp
        WorkspaceConversations.EnsureIndex(conversation => conversation.Id, unique: true);
```

Add document types at the end of the file:

```csharp
internal sealed class WorkspaceConversationDocument
{
    public string Id { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string SelectedProviderId { get; set; } = string.Empty;

    public List<WorkspaceConversationMessageDocument> Messages { get; set; } = [];

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }
}

internal sealed class WorkspaceConversationMessageDocument
{
    public string Role { get; set; } = string.Empty;

    public string Content { get; set; } = string.Empty;
}

internal sealed class WorkspaceStateDocument
{
    public int Id { get; set; } = 1;

    public string CurrentConversationId { get; set; } = string.Empty;
}
```

Create `src/BukitJalil.Infrastructure/LiteDbWorkspaceConversationStore.cs`:

```csharp
using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

internal sealed class LiteDbWorkspaceConversationStore(AppDatabase database) : IWorkspaceConversationStore
{
    public IReadOnlyList<WorkspaceConversation> List()
    {
        return database.WorkspaceConversations
            .FindAll()
            .OrderByDescending(item => item.UpdatedAtUtc)
            .Select(MapConversation)
            .ToList();
    }

    public string? GetCurrentConversationId()
    {
        var state = database.WorkspaceState.FindById(1);
        return string.IsNullOrWhiteSpace(state?.CurrentConversationId) ? null : state.CurrentConversationId;
    }

    public WorkspaceConversation Save(WorkspaceConversation conversation, bool makeCurrent)
    {
        database.WorkspaceConversations.Upsert(new WorkspaceConversationDocument
        {
            Id = conversation.Id,
            Title = conversation.Title,
            SelectedProviderId = conversation.SelectedProviderId,
            Messages = conversation.Messages
                .Select(message => new WorkspaceConversationMessageDocument
                {
                    Role = message.Role.ToString(),
                    Content = message.Content
                })
                .ToList(),
            CreatedAtUtc = conversation.CreatedAtUtc,
            UpdatedAtUtc = conversation.UpdatedAtUtc
        });

        if (makeCurrent)
        {
            database.WorkspaceState.Upsert(new WorkspaceStateDocument
            {
                Id = 1,
                CurrentConversationId = conversation.Id
            });
        }

        return conversation;
    }

    public void Delete(string conversationId)
    {
        database.WorkspaceConversations.Delete(conversationId);

        var state = database.WorkspaceState.FindById(1);
        if (state?.CurrentConversationId == conversationId)
        {
            database.WorkspaceState.Delete(1);
        }
    }

    private static WorkspaceConversation MapConversation(WorkspaceConversationDocument document)
    {
        return new WorkspaceConversation
        {
            Id = document.Id,
            Title = document.Title,
            SelectedProviderId = document.SelectedProviderId,
            Messages = document.Messages
                .Select(message => new WorkspaceConversationMessage(
                    Enum.Parse<LlmRole>(message.Role, ignoreCase: true),
                    message.Content))
                .ToList(),
            CreatedAtUtc = document.CreatedAtUtc,
            UpdatedAtUtc = document.UpdatedAtUtc
        };
    }
}
```

Update `src/BukitJalil.Infrastructure/Class1.cs` registration block:

```csharp
        services.AddSingleton<IWorkspaceConversationStore, LiteDbWorkspaceConversationStore>();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter WorkspaceConversationStoreTests -v minimal`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.Infrastructure/AppDatabase.cs \
  src/BukitJalil.Infrastructure/LiteDbWorkspaceConversationStore.cs \
  src/BukitJalil.Infrastructure/Class1.cs \
  tests/BukitJalil.Infrastructure.Tests/WorkspaceConversationStoreTests.cs
git commit -m "feat: add workspace conversation persistence store"
```

### Task 3: Add Shell State for Restore, Create, Switch, and Delete

**Files:**
- Create: `src/BukitJalil.SharedUi/Workspace/WorkspaceShellState.cs`
- Create: `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs`

- [ ] **Step 1: Write the failing test**

Replace `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs` with:

```csharp
using BukitJalil.App.Workspace;
using BukitJalil.Core;

namespace BukitJalil.App.Tests;

public sealed class WorkspaceShellStateTests
{
    [Fact]
    public void Initialize_creates_default_conversation_when_store_is_empty()
    {
        var store = new InMemoryWorkspaceConversationStore();
        var shell = new WorkspaceShellState(
            store,
            new FakeClock(DateTimeOffset.Parse("2026-05-05T12:00:00Z")),
            "fake");

        shell.Initialize();

        Assert.Single(shell.Conversations);
        Assert.Equal(shell.CurrentConversation.Id, store.GetCurrentConversationId());
        Assert.Equal("fake", shell.CurrentConversation.SelectedProviderId);
    }

    [Fact]
    public void CreateConversation_makes_new_conversation_current()
    {
        var store = new InMemoryWorkspaceConversationStore();
        var shell = new WorkspaceShellState(
            store,
            new FakeClock(DateTimeOffset.Parse("2026-05-05T12:00:00Z")),
            "fake");

        shell.Initialize();
        var originalId = shell.CurrentConversation.Id;

        shell.CreateConversation("openai-compatible");

        Assert.Equal(2, shell.Conversations.Count);
        Assert.NotEqual(originalId, shell.CurrentConversation.Id);
        Assert.Equal("openai-compatible", shell.CurrentConversation.SelectedProviderId);
    }

    [Fact]
    public void DeleteCurrentConversation_falls_back_to_most_recent_remaining_conversation()
    {
        var store = new InMemoryWorkspaceConversationStore();
        var shell = new WorkspaceShellState(
            store,
            new FakeClock(DateTimeOffset.Parse("2026-05-05T12:00:00Z")),
            "fake");

        shell.Initialize();
        var firstId = shell.CurrentConversation.Id;
        shell.CreateConversation("openai-compatible");
        var secondId = shell.CurrentConversation.Id;

        shell.DeleteConversation(secondId);

        Assert.Single(shell.Conversations);
        Assert.Equal(firstId, shell.CurrentConversation.Id);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceShellStateTests -v minimal`

Expected: FAIL with missing `WorkspaceShellState`.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.SharedUi/Workspace/WorkspaceShellState.cs`:

```csharp
using BukitJalil.Core;

namespace BukitJalil.App.Workspace;

public sealed class WorkspaceShellState
{
    private readonly IWorkspaceConversationStore _store;
    private readonly ISystemClock _clock;
    private readonly string _defaultProviderId;

    public WorkspaceShellState(IWorkspaceConversationStore store, ISystemClock clock, string defaultProviderId)
    {
        _store = store;
        _clock = clock;
        _defaultProviderId = defaultProviderId;
    }

    public List<WorkspaceConversation> Conversations { get; } = [];

    public WorkspaceConversation CurrentConversation { get; private set; } = default!;

    public void Initialize()
    {
        Conversations.Clear();
        Conversations.AddRange(_store.List());

        var currentId = _store.GetCurrentConversationId();
        CurrentConversation = Conversations.FirstOrDefault(item => item.Id == currentId)
            ?? Conversations.FirstOrDefault()
            ?? CreateConversation(_defaultProviderId);

        PersistCurrent();
    }

    public WorkspaceConversation CreateConversation(string selectedProviderId)
    {
        var conversation = WorkspaceConversation.Create(selectedProviderId, _clock.UtcNow);
        _store.Save(conversation, makeCurrent: true);
        Conversations.Insert(0, conversation);
        CurrentConversation = conversation;
        return conversation;
    }

    public void SwitchConversation(string conversationId)
    {
        CurrentConversation = Conversations.First(item => item.Id == conversationId);
        PersistCurrent();
    }

    public void DeleteConversation(string conversationId)
    {
        _store.Delete(conversationId);
        Conversations.RemoveAll(item => item.Id == conversationId);

        if (Conversations.Count == 0)
        {
            CreateConversation(_defaultProviderId);
            return;
        }

        if (CurrentConversation.Id == conversationId)
        {
            CurrentConversation = Conversations
                .OrderByDescending(item => item.UpdatedAtUtc)
                .First();
            PersistCurrent();
        }
    }

    public void SaveCurrent()
    {
        _store.Save(CurrentConversation, makeCurrent: true);
        Conversations.RemoveAll(item => item.Id == CurrentConversation.Id);
        Conversations.Insert(0, CurrentConversation);
    }

    private void PersistCurrent()
    {
        _store.Save(CurrentConversation, makeCurrent: true);
    }
}
```

Add this in-memory fake to `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs`:

```csharp
private sealed class InMemoryWorkspaceConversationStore : IWorkspaceConversationStore
{
    private readonly List<WorkspaceConversation> _items = [];
    private string? _currentId;

    public IReadOnlyList<WorkspaceConversation> List() => _items.OrderByDescending(item => item.UpdatedAtUtc).ToList();

    public string? GetCurrentConversationId() => _currentId;

    public WorkspaceConversation Save(WorkspaceConversation conversation, bool makeCurrent)
    {
        _items.RemoveAll(item => item.Id == conversation.Id);
        _items.Add(conversation);

        if (makeCurrent)
        {
            _currentId = conversation.Id;
        }

        return conversation;
    }

    public void Delete(string conversationId)
    {
        _items.RemoveAll(item => item.Id == conversationId);
        if (_currentId == conversationId)
        {
            _currentId = null;
        }
    }
}

private sealed class FakeClock(DateTimeOffset utcNow) : ISystemClock
{
    public DateTimeOffset UtcNow => utcNow;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceShellStateTests -v minimal`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.SharedUi/Workspace/WorkspaceShellState.cs \
  tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs
git commit -m "feat: add workspace shell state"
```

### Task 4: Rework WorkspaceSession to Bind to Active Conversation

**Files:**
- Modify: `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`
- Modify: `tests/BukitJalil.App.Tests/UnitTest1.cs`

- [ ] **Step 1: Write the failing test**

Add these tests to `tests/BukitJalil.App.Tests/UnitTest1.cs`:

```csharp
    [Fact]
    public async Task SendAsync_appends_messages_to_bound_conversation()
    {
        var conversation = WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z"));
        var session = new WorkspaceSession(new StaticProviderRegistry(new FakeLlmProvider()));
        session.Bind(conversation);

        await session.SendAsync("Build a bilingual company site");

        Assert.Equal(2, conversation.Messages.Count);
        Assert.Equal("Build a bilingual company site", conversation.Messages[0].Content);
    }

    [Fact]
    public void Clear_removes_messages_from_bound_conversation_without_resetting_provider()
    {
        var conversation = WorkspaceConversation.Create("openai-compatible", DateTimeOffset.Parse("2026-05-05T12:00:00Z"));
        conversation.Messages.Add(new WorkspaceConversationMessage(LlmRole.User, "Hello"));
        var session = new WorkspaceSession(new StaticProviderRegistry(new FakeLlmProvider()));
        session.Bind(conversation);

        session.Clear();

        Assert.Empty(conversation.Messages);
        Assert.Equal("openai-compatible", conversation.SelectedProviderId);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter WorkspaceSessionTests -v minimal`

Expected: FAIL with missing `Bind()` and changed constructor shape.

- [ ] **Step 3: Write minimal implementation**

Update `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs` to:

```csharp
using BukitJalil.Core;

namespace BukitJalil.App.Workspace;

public sealed class WorkspaceSession
{
    private readonly IProviderRegistry _providerRegistry;
    private WorkspaceConversation _conversation = default!;

    public WorkspaceSession(IProviderRegistry providerRegistry)
    {
        _providerRegistry = providerRegistry;
    }

    public string SelectedProviderId
    {
        get => _conversation.SelectedProviderId;
        set => _conversation.SelectedProviderId = value;
    }

    public bool IsSending { get; private set; }

    public string StatusMessage { get; private set; } = "Ready.";

    public IReadOnlyList<WorkspaceConversationMessage> Messages => _conversation.Messages;

    public WorkspaceConversation Conversation => _conversation;

    public void Bind(WorkspaceConversation conversation)
    {
        _conversation = conversation;
        StatusMessage = "Ready.";
        IsSending = false;
    }

    public void Clear()
    {
        _conversation.Messages.Clear();
        IsSending = false;
        StatusMessage = "Ready.";
    }

    public async Task SendAsync(string input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            StatusMessage = "Enter a prompt before sending.";
            return;
        }

        var trimmedInput = input.Trim();
        _conversation.Messages.Add(new WorkspaceConversationMessage(LlmRole.User, trimmedInput));

        var provider = _providerRegistry.Get(SelectedProviderId);
        if (provider is null)
        {
            StatusMessage = $"Provider '{SelectedProviderId}' is unavailable.";
            _conversation.Messages.Add(new WorkspaceConversationMessage(LlmRole.Assistant, StatusMessage));
            return;
        }

        IsSending = true;
        StatusMessage = "Sending request...";

        try
        {
            var request = new LlmChatRequest(_conversation.Messages.Select(message => new LlmMessage(message.Role, message.Content)).ToList());
            var response = await provider.ChatAsync(request, cancellationToken);
            _conversation.Messages.Add(new WorkspaceConversationMessage(response.Message.Role, response.Message.Content));
            StatusMessage = "Response received.";
        }
        catch (Exception exception)
        {
            StatusMessage = $"Provider execution failed: {exception.Message}";
            _conversation.Messages.Add(new WorkspaceConversationMessage(LlmRole.Assistant, StatusMessage));
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

Expected: PASS after adapting existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs \
  tests/BukitJalil.App.Tests/UnitTest1.cs
git commit -m "feat: bind workspace session to active conversation"
```

### Task 5: Add Current-Conversation Persistence Rules

**Files:**
- Modify: `tests/BukitJalil.Infrastructure.Tests/WorkspaceConversationStoreTests.cs`
- Modify: `src/BukitJalil.Infrastructure/LiteDbWorkspaceConversationStore.cs`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/BukitJalil.Infrastructure.Tests/WorkspaceConversationStoreTests.cs`:

```csharp
    [Fact]
    public void Store_restores_remaining_conversation_when_current_id_is_missing()
    {
        using var services = BuildServices();
        var store = services.GetRequiredService<IWorkspaceConversationStore>();

        var first = store.Save(WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z")), makeCurrent: true);
        var second = store.Save(WorkspaceConversation.Create("openai-compatible", DateTimeOffset.Parse("2026-05-05T13:00:00Z")), makeCurrent: false);
        store.Delete(first.Id);

        var conversations = store.List();
        var currentId = store.GetCurrentConversationId() ?? conversations.FirstOrDefault()?.Id;

        Assert.Single(conversations);
        Assert.Equal(second.Id, currentId);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter Store_restores_remaining_conversation_when_current_id_is_missing -v minimal`

Expected: FAIL because the current id is cleared instead of resolved by higher-level logic.

- [ ] **Step 3: Write minimal implementation**

No store contract change is required. Update the test comment and implementation handoff by keeping store simple and moving recovery to shell state.

Replace the test with this shell-state recovery test in `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs`:

```csharp
    [Fact]
    public void Initialize_falls_back_to_existing_conversation_when_saved_current_is_missing()
    {
        var store = new InMemoryWorkspaceConversationStore();
        var first = WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z"));
        var second = WorkspaceConversation.Create("openai-compatible", DateTimeOffset.Parse("2026-05-05T13:00:00Z"));
        store.Save(first, makeCurrent: true);
        store.Save(second, makeCurrent: false);
        store.Delete(first.Id);

        var shell = new WorkspaceShellState(
            store,
            new FakeClock(DateTimeOffset.Parse("2026-05-05T14:00:00Z")),
            "fake");

        shell.Initialize();

        Assert.Equal(second.Id, shell.CurrentConversation.Id);
    }
```

This task exists to make the recovery rule explicit in the correct layer.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter Initialize_falls_back_to_existing_conversation_when_saved_current_is_missing -v minimal`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs
git commit -m "test: lock workspace current conversation recovery"
```

### Task 6: Render Full Conversation Shell in Workspace Page

**Files:**
- Modify: `src/BukitJalil.App/Components/Pages/Counter.razor`

- [ ] **Step 1: Use build as the failing gate**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after page refactor but before fixes: build fails if bindings, events, or injected services are incomplete.

- [ ] **Step 2: Write minimal implementation**

Update `src/BukitJalil.App/Components/Pages/Counter.razor` so the page:

- injects `IWorkspaceConversationStore` and `ISystemClock`;
- creates `WorkspaceShellState`;
- binds `WorkspaceSession` to `shell.CurrentConversation`;
- renders a conversation list and active conversation shell.

Add these fields in `@code`:

```razor
    private WorkspaceShellState _shell = default!;
    private WorkspaceSession _session = default!;
```

Replace the current `OnInitialized()` with:

```razor
    protected override void OnInitialized()
    {
        _providers = ProviderRegistry.List();
        var settings = SettingsStore.Get();
        var defaultProviderId = WorkspaceDefaultProviderSelector.Resolve(
            _providers,
            settings.DefaultProvider);

        _shell = new WorkspaceShellState(ConversationStore, Clock, defaultProviderId);
        _shell.Initialize();

        _session = new WorkspaceSession(ProviderRegistry);
        _session.Bind(_shell.CurrentConversation);
    }
```

Add these injections:

```razor
@inject IWorkspaceConversationStore ConversationStore
@inject ISystemClock Clock
```

Replace the page body with this minimal shell layout:

```razor
    <div class="workspace-chat-layout">
        <section class="workspace-panel">
            <div class="workspace-panel__header">
                <div>
                    <p class="workspace-panel__eyebrow">Conversations</p>
                    <h2>Saved chats</h2>
                </div>
                <button class="btn btn-primary" @onclick="CreateConversation" disabled="@_session.IsSending">New conversation</button>
            </div>

            <div class="form-stack">
                @foreach (var conversation in _shell.Conversations)
                {
                    <button class="btn @(conversation.Id == _shell.CurrentConversation.Id ? "btn-primary" : string.Empty)"
                            @onclick="() => SwitchConversation(conversation.Id)"
                            disabled="@_session.IsSending">
                        @conversation.Title
                    </button>
                }
            </div>
        </section>

        <section class="workspace-panel">
            <div class="workspace-panel__header">
                <div>
                    <p class="workspace-panel__eyebrow">Conversation</p>
                    <h2>@_shell.CurrentConversation.Title</h2>
                </div>
                <button class="btn" @onclick="DeleteCurrentConversation" disabled="@_session.IsSending">Delete conversation</button>
            </div>

            <div id="workspace-transcript" class="chat-transcript">
                @if (_session.Messages.Count == 0)
                {
                    <p class="empty-state">No messages yet. Start a new conversation.</p>
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
                <InputSelect id="provider" class="field-input" @bind-Value="_session.SelectedProviderId" @bind-Value:after="PersistConversation" disabled="@_session.IsSending">
                    @foreach (var provider in _providers)
                    {
                        <option value="@provider.Id">@provider.DisplayName</option>
                    }
                </InputSelect>

                <label class="field-label" for="prompt">Prompt</label>
                <InputTextArea id="workspace-prompt"
                               class="field-input field-input--textarea"
                               @bind-Value="_input"
                               @bind-Value:event="oninput"
                               @onkeyup="HandlePromptKeyUp"
                               disabled="@_session.IsSending" />

                <button class="btn btn-primary" @onclick="SendAsync" disabled="@_session.IsSending">
                    @(_session.IsSending ? "Sending..." : "Send")
                </button>

                <button class="btn" @onclick="ClearConversation" disabled="@_session.IsSending">
                    Clear conversation
                </button>

                <p class="save-status">@_session.StatusMessage</p>
            </div>
        </section>
    </div>
```

Add these handlers:

```razor
    private void CreateConversation()
    {
        _shell.CreateConversation(_session.SelectedProviderId);
        _session.Bind(_shell.CurrentConversation);
        _shouldFocusPrompt = true;
    }

    private void SwitchConversation(string conversationId)
    {
        _shell.SwitchConversation(conversationId);
        _session.Bind(_shell.CurrentConversation);
    }

    private void DeleteCurrentConversation()
    {
        _shell.DeleteConversation(_shell.CurrentConversation.Id);
        _session.Bind(_shell.CurrentConversation);
        _shouldFocusPrompt = true;
    }

    private void PersistConversation()
    {
        _shell.CurrentConversation.UpdatedAtUtc = Clock.UtcNow;
        _shell.SaveCurrent();
    }
```

Update `SendAsync()`:

```razor
    private async Task SendAsync()
    {
        var hadInput = !string.IsNullOrWhiteSpace(_input);
        await _session.SendAsync(_input);

        if (hadInput && !_session.IsSending)
        {
            if (_shell.CurrentConversation.Title == WorkspaceConversation.DefaultTitle)
            {
                _shell.CurrentConversation.Title = _shell.CurrentConversation.Messages
                    .FirstOrDefault(item => item.Role == LlmRole.User)?
                    .Content[..Math.Min(
                        _shell.CurrentConversation.Messages.First(item => item.Role == LlmRole.User).Content.Length,
                        40)] ?? WorkspaceConversation.DefaultTitle;
            }

            _shell.CurrentConversation.UpdatedAtUtc = Clock.UtcNow;
            _shell.SaveCurrent();
            _input = string.Empty;
            _shouldFocusPrompt = true;
        }
    }
```

Update `ClearConversation()`:

```razor
    private void ClearConversation()
    {
        _session.Clear();
        _shell.CurrentConversation.UpdatedAtUtc = Clock.UtcNow;
        _shell.SaveCurrent();
        _shouldFocusPrompt = true;
    }
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal
dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj -v minimal
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.App/Components/Pages/Counter.razor
git commit -m "feat: add workspace multi-conversation shell"
```

### Task 7: Final Verification and Diagnostics

**Files:**
- Modify: none expected

- [ ] **Step 1: Run full app-facing verification**

Run:

```bash
dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal
dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj -v minimal
dotnet test tests/BukitJalil.Core.Tests/BukitJalil.Core.Tests.csproj -v minimal
dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst
```

Expected: all pass.

- [ ] **Step 2: Check diagnostics**

Verify diagnostics for:

- `src/BukitJalil.Core/WorkspaceConversation.cs`
- `src/BukitJalil.Infrastructure/LiteDbWorkspaceConversationStore.cs`
- `src/BukitJalil.SharedUi/Workspace/WorkspaceShellState.cs`
- `src/BukitJalil.SharedUi/Workspace/WorkspaceSession.cs`
- `src/BukitJalil.App/Components/Pages/Counter.razor`

Expected: empty diagnostics, except the pre-existing `viewport` warnings in `src/BukitJalil.App/wwwroot/index.html` if unchanged.

- [ ] **Step 3: Manual sanity check**

Verify these flows manually in the MAUI app:

1. Open workspace with empty storage: one default conversation appears.
2. Create two conversations and switch between them.
3. Send a message in each conversation and confirm transcript isolation.
4. Change provider in one conversation and confirm the other conversation keeps its own provider.
5. Delete the active conversation and confirm fallback to another conversation.
6. Delete the last remaining conversation and confirm a new empty conversation appears.
7. Restart the app and confirm the previous active conversation restores.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "test: verify workspace multi-conversation persistence"
```

## Self-Review

### Spec coverage

- multiple conversations, active restoration, create/switch/delete, per-conversation provider, and full shell UI are covered by Tasks 2 through 6.
- current-conversation recovery and delete-last fallback are covered by Tasks 3, 5, and 6.
- persistence and session rebinding are split cleanly across store, shell state, and session.

### Placeholder scan

- no `TODO`, `TBD`, or deferred “implement later” text remains.
- each task has explicit file paths, code blocks, commands, and expected outcomes.

### Type consistency

- `WorkspaceConversation`, `WorkspaceConversationMessage`, `IWorkspaceConversationStore`, `WorkspaceShellState`, and `WorkspaceSession.Bind()` are named consistently across tasks.
- persistence remains in the store layer; fallback rules stay in shell state; DOM concerns remain in `Counter.razor` and `workspace.js`.
