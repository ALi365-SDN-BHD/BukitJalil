using BukitJalil.App.Workspace;
using BukitJalil.Core;
using BukitJalil.Infrastructure;

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
