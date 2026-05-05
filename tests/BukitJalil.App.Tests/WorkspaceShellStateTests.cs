using BukitJalil.App.Workspace;
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

public sealed class WorkspaceShellStateTests
{
    [Fact]
    public void Initialize_creates_default_conversation_when_store_is_empty()
    {
        var store = new InMemoryWorkspaceConversationStore();
        var shell = new WorkspaceShellState(
            store,
            () => DateTimeOffset.Parse("2026-05-05T12:00:00Z"),
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
            () => DateTimeOffset.Parse("2026-05-05T12:00:00Z"),
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
        var clock = DateTimeOffset.Parse("2026-05-05T12:00:00Z");
        var shell = new WorkspaceShellState(
            store,
            () => clock,
            "fake");

        shell.Initialize();
        var firstId = shell.CurrentConversation.Id;

        clock = DateTimeOffset.Parse("2026-05-05T13:00:00Z");
        shell.CreateConversation("openai-compatible");
        var secondId = shell.CurrentConversation.Id;

        shell.DeleteConversation(secondId);

        Assert.Single(shell.Conversations);
        Assert.Equal(firstId, shell.CurrentConversation.Id);
    }

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
}
