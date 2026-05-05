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
        return string.IsNullOrWhiteSpace(state?.CurrentConversationId)
            ? null
            : state.CurrentConversationId;
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
