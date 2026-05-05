using BukitJalil.Core;
using BukitJalil.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Infrastructure.Tests;

public sealed class WorkspaceConversationStoreTests : IDisposable
{
    private readonly string _tempRoot = Path.Combine(Path.GetTempPath(), "bukitjalil-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void Store_round_trips_multiple_conversations_and_current_id()
    {
        using var services = BuildServices();
        var store = services.GetRequiredService<IWorkspaceConversationStore>();

        var first = store.Save(
            WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z")),
            makeCurrent: true);

        var second = WorkspaceConversation.Create("openai-compatible", DateTimeOffset.Parse("2026-05-05T13:00:00Z"));
        second.Messages.Add(new WorkspaceConversationMessage(LlmRole.User, "Generate a landing page"));
        store.Save(second, makeCurrent: true);

        var conversations = store.List();
        var currentId = store.GetCurrentConversationId();

        Assert.Equal(2, conversations.Count);
        Assert.Equal(second.Id, currentId);
        Assert.Contains(conversations, item => item.Id == first.Id);
        Assert.Contains(conversations, item => item.Messages.Any(message => message.Content == "Generate a landing page"));
    }

    [Fact]
    public void Delete_removes_conversation_and_clears_current_id_when_target_was_current()
    {
        using var services = BuildServices();
        var store = services.GetRequiredService<IWorkspaceConversationStore>();

        var conversation = store.Save(
            WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z")),
            makeCurrent: true);

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
        services.AddBukitJalilInfrastructure(options =>
        {
            options.AppDataDirectory = _tempRoot;
        });
        return services.BuildServiceProvider();
    }
}
