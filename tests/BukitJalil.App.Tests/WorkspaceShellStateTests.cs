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
