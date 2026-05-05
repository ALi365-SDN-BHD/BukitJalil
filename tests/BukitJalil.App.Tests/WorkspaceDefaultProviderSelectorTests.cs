using BukitJalil.App.Workspace;
using BukitJalil.Core;

namespace BukitJalil.App.Tests;

public sealed class WorkspaceDefaultProviderSelectorTests
{
    [Fact]
    public void Resolve_returns_settings_default_provider_when_it_exists_in_registry()
    {
        var providers = new[]
        {
            new ProviderDescriptor("fake", "Fake Provider", true),
            new ProviderDescriptor("openai-compatible", "OpenAI-Compatible", false)
        };

        var selectedProviderId = WorkspaceDefaultProviderSelector.Resolve(
            providers,
            "openai-compatible");

        Assert.Equal("openai-compatible", selectedProviderId);
    }
}
