namespace BukitJalil.Core;

public sealed record WorkspaceConversation
{
    public const string DefaultTitle = "New conversation";

    public string Id { get; init; } = Guid.NewGuid().ToString("n");

    public string Title { get; set; } = DefaultTitle;

    public string SelectedProviderId { get; set; } = string.Empty;

    public List<WorkspaceConversationMessage> Messages { get; init; } = [];

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public static WorkspaceConversation Create(string selectedProviderId, DateTimeOffset nowUtc)
    {
        return new WorkspaceConversation
        {
            SelectedProviderId = selectedProviderId,
            CreatedAtUtc = nowUtc,
            UpdatedAtUtc = nowUtc
        };
    }
}

public sealed record WorkspaceConversationMessage(LlmRole Role, string Content);
