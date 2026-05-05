# OpenAI-Compatible Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one real OpenAI-compatible provider that uses persisted `BaseUrl`, `ApiKey`, and `Model` settings while keeping the existing fake provider and workspace chat flow intact.

**Architecture:** Extend `AppSettings` and `LiteDbSettingsStore` for provider configuration, add one `OpenAiCompatibleLlmProvider` in `Infrastructure`, and keep `/workspace` using the same `WorkspaceSession` path through `IProviderRegistry`. The real provider uses injected HTTP transport and produces the same `LlmChatResponse` shape as the fake provider.

**Tech Stack:** .NET 10, MAUI Blazor, xUnit, Microsoft DI, LiteDB, `HttpClient`, `System.Text.Json`

---

## File Map

### Create

- `src/BukitJalil.Infrastructure/OpenAiCompatibleLlmProvider.cs`
- `tests/BukitJalil.Infrastructure.Tests/OpenAiCompatibleLlmProviderTests.cs`

### Modify

- `src/BukitJalil.Core/AppSettings.cs`
- `src/BukitJalil.Infrastructure/AppDatabase.cs`
- `src/BukitJalil.Infrastructure/LiteDbSettingsStore.cs`
- `src/BukitJalil.Infrastructure/Class1.cs`
- `src/BukitJalil.Infrastructure/ProviderRegistry.cs`
- `src/BukitJalil.App/Components/Pages/Settings.razor`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `tests/BukitJalil.Infrastructure.Tests/UnitTest1.cs`
- `tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs`

### Responsibilities

- `AppSettings` owns provider configuration values.
- `LiteDbSettingsStore` and `AppDatabase` persist those values.
- `OpenAiCompatibleLlmProvider` validates settings, sends `/chat/completions`, and parses the first assistant reply.
- `ProviderRegistry` exposes both `fake` and `openai-compatible`.
- `Settings` page edits and saves provider config.
- `Workspace` page keeps the same send flow but can now select the real provider.

### Task 1: Extend Settings Model and Persistence

**Files:**
- Modify: `tests/BukitJalil.Infrastructure.Tests/UnitTest1.cs`
- Modify: `src/BukitJalil.Core/AppSettings.cs`
- Modify: `src/BukitJalil.Infrastructure/AppDatabase.cs`
- Modify: `src/BukitJalil.Infrastructure/LiteDbSettingsStore.cs`

- [ ] **Step 1: Write the failing test**

Update `tests/BukitJalil.Infrastructure.Tests/UnitTest1.cs` in `SettingsStore_persists_saved_settings()` to save and assert the new fields:

```csharp
        var settings = new AppSettings
        {
            BukitPath = "/usr/local/bin/bukit",
            DocumentsPath = "/tmp/docs",
            DefaultProvider = "openai-compatible",
            ProviderBaseUrl = "https://api.openai.com/v1",
            ProviderApiKey = "test-key",
            ProviderModel = "gpt-4.1-mini"
        };

        store.Save(settings);
        var reloaded = store.Get();

        Assert.Equal(settings.BukitPath, reloaded.BukitPath);
        Assert.Equal(settings.DocumentsPath, reloaded.DocumentsPath);
        Assert.Equal(settings.DefaultProvider, reloaded.DefaultProvider);
        Assert.Equal(settings.ProviderBaseUrl, reloaded.ProviderBaseUrl);
        Assert.Equal(settings.ProviderApiKey, reloaded.ProviderApiKey);
        Assert.Equal(settings.ProviderModel, reloaded.ProviderModel);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter SettingsStore_persists_saved_settings -v minimal`

Expected: FAIL with missing `ProviderBaseUrl`, `ProviderApiKey`, or `ProviderModel` members.

- [ ] **Step 3: Write minimal implementation**

Update `src/BukitJalil.Core/AppSettings.cs`:

```csharp
namespace BukitJalil.Core;

public sealed record AppSettings
{
    public string BukitPath { get; set; } = string.Empty;

    public string DocumentsPath { get; set; } = string.Empty;

    public string DefaultProvider { get; set; } = string.Empty;

    public string ProviderBaseUrl { get; set; } = string.Empty;

    public string ProviderApiKey { get; set; } = string.Empty;

    public string ProviderModel { get; set; } = string.Empty;
}
```

Update `src/BukitJalil.Infrastructure/AppDatabase.cs` by extending `AppSettingsDocument`:

```csharp
internal sealed class AppSettingsDocument
{
    public int Id { get; set; } = 1;

    public string BukitPath { get; set; } = string.Empty;

    public string DocumentsPath { get; set; } = string.Empty;

    public string DefaultProvider { get; set; } = string.Empty;

    public string ProviderBaseUrl { get; set; } = string.Empty;

    public string ProviderApiKey { get; set; } = string.Empty;

    public string ProviderModel { get; set; } = string.Empty;
}
```

Update `src/BukitJalil.Infrastructure/LiteDbSettingsStore.cs`:

```csharp
using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

internal sealed class LiteDbSettingsStore(AppDatabase database) : ISettingsStore
{
    public AppSettings Get()
    {
        var document = database.Settings.FindById(1);

        return document is null
            ? new AppSettings()
            : new AppSettings
            {
                BukitPath = document.BukitPath,
                DocumentsPath = document.DocumentsPath,
                DefaultProvider = document.DefaultProvider,
                ProviderBaseUrl = document.ProviderBaseUrl,
                ProviderApiKey = document.ProviderApiKey,
                ProviderModel = document.ProviderModel
            };
    }

    public void Save(AppSettings settings)
    {
        var document = new AppSettingsDocument
        {
            Id = 1,
            BukitPath = settings.BukitPath,
            DocumentsPath = settings.DocumentsPath,
            DefaultProvider = settings.DefaultProvider,
            ProviderBaseUrl = settings.ProviderBaseUrl,
            ProviderApiKey = settings.ProviderApiKey,
            ProviderModel = settings.ProviderModel
        };

        database.Settings.Upsert(document);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter SettingsStore_persists_saved_settings -v minimal`

Expected: PASS with the updated settings round-trip.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.Infrastructure.Tests/UnitTest1.cs \
  src/BukitJalil.Core/AppSettings.cs \
  src/BukitJalil.Infrastructure/AppDatabase.cs \
  src/BukitJalil.Infrastructure/LiteDbSettingsStore.cs
git commit -m "feat: persist provider settings"
```

### Task 2: Add OpenAI-Compatible Provider

**Files:**
- Create: `tests/BukitJalil.Infrastructure.Tests/OpenAiCompatibleLlmProviderTests.cs`
- Create: `src/BukitJalil.Infrastructure/OpenAiCompatibleLlmProvider.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/BukitJalil.Infrastructure.Tests/OpenAiCompatibleLlmProviderTests.cs`:

```csharp
using System.Net;
using System.Net.Http;
using System.Text;
using BukitJalil.Core;
using BukitJalil.Infrastructure;

namespace BukitJalil.Infrastructure.Tests;

public sealed class OpenAiCompatibleLlmProviderTests
{
    [Fact]
    public async Task ChatAsync_returns_configuration_message_when_settings_are_missing()
    {
        var store = new FakeSettingsStore(new AppSettings());
        using var client = new HttpClient(new StubHandler(_ => throw new InvalidOperationException("HTTP should not be called")));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        var response = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.Equal("openai-compatible", response.ProviderId);
        Assert.Contains("not configured", response.Message.Content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ChatAsync_parses_first_assistant_message()
    {
        var settings = new AppSettings
        {
            ProviderBaseUrl = "https://api.openai.com/v1",
            ProviderApiKey = "key",
            ProviderModel = "gpt-4.1-mini"
        };

        var store = new FakeSettingsStore(settings);
        using var client = new HttpClient(new StubHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"choices\":[{\"message\":{\"content\":\"Generated reply\"}}]}",
                    Encoding.UTF8,
                    "application/json")
            }));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        var response = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.Equal(LlmRole.Assistant, response.Message.Role);
        Assert.Equal("Generated reply", response.Message.Content);
    }

    private sealed class FakeSettingsStore(AppSettings settings) : ISettingsStore
    {
        public AppSettings Get() => settings;

        public void Save(AppSettings settingsToSave) => throw new NotSupportedException();
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            return Task.FromResult(responseFactory(request));
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter OpenAiCompatibleLlmProviderTests -v minimal`

Expected: FAIL with missing `OpenAiCompatibleLlmProvider`.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.Infrastructure/OpenAiCompatibleLlmProvider.cs`:

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

public sealed class OpenAiCompatibleLlmProvider(ISettingsStore settingsStore, HttpClient httpClient) : ILlmProvider
{
    public ProviderDescriptor Descriptor { get; } = new("openai-compatible", "OpenAI-Compatible", false);

    public async Task<LlmChatResponse> ChatAsync(LlmChatRequest request, CancellationToken cancellationToken = default)
    {
        var settings = settingsStore.Get();

        if (string.IsNullOrWhiteSpace(settings.ProviderBaseUrl) ||
            string.IsNullOrWhiteSpace(settings.ProviderApiKey) ||
            string.IsNullOrWhiteSpace(settings.ProviderModel))
        {
            return Failure("OpenAI-compatible provider is not configured. Add Base URL, API key, and model in Settings.");
        }

        if (!Uri.TryCreate(settings.ProviderBaseUrl, UriKind.Absolute, out var baseUri))
        {
            return Failure("OpenAI-compatible provider Base URL is invalid. Update it in Settings.");
        }

        var endpoint = new Uri(baseUri, "chat/completions");
        var payload = new
        {
            model = settings.ProviderModel,
            messages = request.Messages.Select(message => new
            {
                role = message.Role.ToString().ToLowerInvariant(),
                content = message.Content
            })
        };

        using var message = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ProviderApiKey);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(message, cancellationToken);
        }
        catch (Exception exception)
        {
            return Failure($"OpenAI-compatible request failed: {exception.Message}");
        }

        if (!response.IsSuccessStatusCode)
        {
            return Failure($"OpenAI-compatible request failed with status {(int)response.StatusCode}.");
        }

        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        try
        {
            using var document = JsonDocument.Parse(json);
            var content = document.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            if (string.IsNullOrWhiteSpace(content))
            {
                return Failure("OpenAI-compatible response did not contain assistant content.");
            }

            return new LlmChatResponse(
                Descriptor.Id,
                new LlmMessage(LlmRole.Assistant, content));
        }
        catch (Exception)
        {
            return Failure("OpenAI-compatible response could not be parsed.");
        }
    }

    private LlmChatResponse Failure(string content)
    {
        return new LlmChatResponse(
            Descriptor.Id,
            new LlmMessage(LlmRole.Assistant, content));
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter OpenAiCompatibleLlmProviderTests -v minimal`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.Infrastructure.Tests/OpenAiCompatibleLlmProviderTests.cs \
  src/BukitJalil.Infrastructure/OpenAiCompatibleLlmProvider.cs
git commit -m "feat: add openai compatible provider"
```

### Task 3: Register and Expose the Real Provider

**Files:**
- Modify: `tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs`
- Modify: `src/BukitJalil.Infrastructure/Class1.cs`
- Modify: `src/BukitJalil.Infrastructure/ProviderRegistry.cs`

- [ ] **Step 1: Write the failing test**

Update `tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs`:

```csharp
    [Fact]
    public void ProviderRegistry_lists_openai_compatible_provider()
    {
        var services = new ServiceCollection();
        services.AddBukitJalilInfrastructure(options =>
            options.AppDataDirectory = Path.Combine(Path.GetTempPath(), "bj-registry-tests", Guid.NewGuid().ToString("N")));

        using var provider = services.BuildServiceProvider();
        var registry = provider.GetRequiredService<IProviderRegistry>();

        Assert.Contains(registry.List(), item => item.Id == "openai-compatible");
        Assert.NotNull(registry.Get("openai-compatible"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter ProviderRegistry_lists_openai_compatible_provider -v minimal`

Expected: FAIL because the registry does not yet expose `openai-compatible`.

- [ ] **Step 3: Write minimal implementation**

Update `src/BukitJalil.Infrastructure/Class1.cs` registration block:

```csharp
        services.AddHttpClient<OpenAiCompatibleLlmProvider>();
        services.AddSingleton<ILlmProvider, FakeLlmProvider>();
        services.AddSingleton<ILlmProvider>(serviceProvider => serviceProvider.GetRequiredService<OpenAiCompatibleLlmProvider>());
        services.AddSingleton<IProviderRegistry, ProviderRegistry>();
```

Keep `FakeLlmProvider` registration and ensure both providers are present in `IEnumerable<ILlmProvider>`.

No behavioral change is needed in `ProviderRegistry.cs` beyond the existing implementation if it already enumerates all registered providers.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj --filter ProviderRegistry_lists_openai_compatible_provider -v minimal`

Expected: PASS with the new provider exposed.

- [ ] **Step 5: Commit**

```bash
git add tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs \
  src/BukitJalil.Infrastructure/Class1.cs
git commit -m "feat: register openai compatible provider"
```

### Task 4: Wire Settings and Workspace UI

**Files:**
- Modify: `src/BukitJalil.App/Components/Pages/Settings.razor`
- Modify: `src/BukitJalil.App/Components/Pages/Counter.razor`

- [ ] **Step 1: Write the failing verification**

Use app build as the integration gate for UI wiring.

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after markup edits but before final fixes: build fails if new bindings or provider ids are incorrect.

- [ ] **Step 2: Write minimal implementation**

Update the form in `src/BukitJalil.App/Components/Pages/Settings.razor` by adding these fields before the save button:

```razor
                    <label class="field-label" for="provider-base-url">Provider base URL</label>
                    <InputText id="provider-base-url" class="field-input" @bind-Value="_settings.ProviderBaseUrl" />

                    <label class="field-label" for="provider-api-key">Provider API key</label>
                    <InputText id="provider-api-key" class="field-input" @bind-Value="_settings.ProviderApiKey" />

                    <label class="field-label" for="provider-model">Provider model</label>
                    <InputText id="provider-model" class="field-input" @bind-Value="_settings.ProviderModel" />
```

Update the provider select block in `src/BukitJalil.App/Components/Pages/Counter.razor` only if needed so it continues to enumerate `_providers` from the registry. No new page-side provider logic should be added.

Update the workspace header text if desired to reflect fake and real provider coexistence:

```razor
        <p class="workspace-page__lede">
            This shell now supports local provider selection, a fake response path, and a first OpenAI-compatible provider path.
        </p>
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS with the updated settings page and unchanged workspace flow.

- [ ] **Step 4: Run full verification**

Run:

```bash
dotnet test tests/BukitJalil.Core.Tests/BukitJalil.Core.Tests.csproj -v minimal
dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj -v minimal
dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal
dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst
```

Then verify diagnostics for:

- `src/BukitJalil.App/Components/Pages/Settings.razor`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `src/BukitJalil.Infrastructure/OpenAiCompatibleLlmProvider.cs`

Expected: all tests pass, app build passes, diagnostics empty.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.App/Components/Pages/Settings.razor \
  src/BukitJalil.App/Components/Pages/Counter.razor \
  tests/BukitJalil.Infrastructure.Tests/OpenAiCompatibleLlmProviderTests.cs \
  tests/BukitJalil.Infrastructure.Tests/ProviderRegistryTests.cs \
  tests/BukitJalil.Infrastructure.Tests/UnitTest1.cs \
  src/BukitJalil.Infrastructure/OpenAiCompatibleLlmProvider.cs \
  src/BukitJalil.Infrastructure/Class1.cs \
  src/BukitJalil.Core/AppSettings.cs \
  src/BukitJalil.Infrastructure/AppDatabase.cs \
  src/BukitJalil.Infrastructure/LiteDbSettingsStore.cs
git commit -m "feat: add openai compatible chat provider"
```

## Self-Review

### Spec coverage

- persisted provider configuration: Task 1.
- openai-compatible transport and parsing: Task 2.
- registry exposure of both fake and real provider: Task 3.
- settings and workspace UI continuity: Task 4.
- missing config and parse/transport failure behavior: Task 2.

### Placeholder scan

- no `TODO`, `TBD`, or deferred instructions remain.
- each task contains concrete files, code, commands, and expected outcomes.

### Type consistency

- `ProviderBaseUrl`, `ProviderApiKey`, and `ProviderModel` are used consistently across model, store, tests, and provider.
- `OpenAiCompatibleLlmProvider` always returns `LlmChatResponse`.
- `IProviderRegistry` remains unchanged and is reused across fake and real providers.

