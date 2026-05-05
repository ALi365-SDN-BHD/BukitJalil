namespace BukitJalil.Core;

public interface IWorkspaceConversationStore
{
    IReadOnlyList<WorkspaceConversation> List();

    string? GetCurrentConversationId();

    WorkspaceConversation Save(WorkspaceConversation conversation, bool makeCurrent);

    void Delete(string conversationId);
}
