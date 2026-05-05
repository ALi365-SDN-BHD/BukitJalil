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

    [Fact]
    public void Resolve_falls_back_to_first_provider_when_configured_default_is_blank()
    {
        var providers = new[]
        {
            new ProviderDescriptor("fake", "Fake Provider", true),
            new ProviderDescriptor("openai-compatible", "OpenAI-Compatible", false)
        };

        var selectedProviderId = WorkspaceDefaultProviderSelector.Resolve(
            providers,
            string.Empty);

        Assert.Equal("fake", selectedProviderId);
    }

    [Fact]
    public void Resolve_falls_back_to_first_provider_when_configured_default_is_missing()
    {
        var providers = new[]
        {
            new ProviderDescriptor("fake", "Fake Provider", true),
            new ProviderDescriptor("openai-compatible", "OpenAI-Compatible", false)
        };

        var selectedProviderId = WorkspaceDefaultProviderSelector.Resolve(
            providers,
            "anthropic");

        Assert.Equal("fake", selectedProviderId);
    }

    [Fact]
    public void Resolve_returns_fake_when_providers_list_is_empty()
    {
        var selectedProviderId = WorkspaceDefaultProviderSelector.Resolve(
            [],
            "openai-compatible");

        Assert.Equal("fake", selectedProviderId);
    }
}
