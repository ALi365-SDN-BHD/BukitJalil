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
        services.AddBukitJalilInfrastructure(options =>
            options.AppDataDirectory = Path.Combine(Path.GetTempPath(), "bj-registry-tests", Guid.NewGuid().ToString("N")));

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
