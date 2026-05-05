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

    private sealed class StaticProviderRegistry(ILlmProvider provider) : IProviderRegistry
    {
        public ILlmProvider? Get(string providerId) => providerId == provider.Descriptor.Id ? provider : null;

        public IReadOnlyList<ProviderDescriptor> List() => [provider.Descriptor];
    }

    private sealed class DelayedProvider : ILlmProvider
    {
        private readonly TaskCompletionSource _completion = new(TaskCreationOptions.RunContinuationsAsynchronously);

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
}
