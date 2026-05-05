using BukitJalil.Core;

namespace BukitJalil.App.Workspace;

public sealed class WorkspaceShellState
{
    private readonly IWorkspaceConversationStore _store;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly string _defaultProviderId;

    public WorkspaceShellState(
        IWorkspaceConversationStore store,
        Func<DateTimeOffset> utcNow,
        string defaultProviderId)
    {
        _store = store;
        _utcNow = utcNow;
        _defaultProviderId = defaultProviderId;
    }

    public List<WorkspaceConversation> Conversations { get; } = [];

    public WorkspaceConversation CurrentConversation { get; private set; } = default!;

    public void Initialize()
    {
        Conversations.Clear();
        Conversations.AddRange(_store.List());

        var currentId = _store.GetCurrentConversationId();
        CurrentConversation = Conversations.FirstOrDefault(item => item.Id == currentId)
            ?? Conversations.FirstOrDefault()
            ?? CreateConversation(_defaultProviderId);

        PersistCurrent();
    }

    public WorkspaceConversation CreateConversation(string selectedProviderId)
    {
        var conversation = WorkspaceConversation.Create(selectedProviderId, _utcNow());
        _store.Save(conversation, makeCurrent: true);
        Conversations.Insert(0, conversation);
        CurrentConversation = conversation;
        return conversation;
    }

    public void SwitchConversation(string conversationId)
    {
        CurrentConversation = Conversations.First(item => item.Id == conversationId);
        PersistCurrent();
    }

    public void DeleteConversation(string conversationId)
    {
        var wasCurrent = CurrentConversation.Id == conversationId;

        _store.Delete(conversationId);
        Conversations.RemoveAll(item => item.Id == conversationId);

        if (Conversations.Count == 0)
        {
            CreateConversation(_defaultProviderId);
            return;
        }

        if (wasCurrent)
        {
            CurrentConversation = Conversations
                .OrderByDescending(item => item.UpdatedAtUtc)
                .First();
            PersistCurrent();
        }
    }

    public void SaveCurrent()
    {
        _store.Save(CurrentConversation, makeCurrent: true);
        Conversations.RemoveAll(item => item.Id == CurrentConversation.Id);
        Conversations.Insert(0, CurrentConversation);
    }

    private void PersistCurrent()
    {
        _store.Save(CurrentConversation, makeCurrent: true);
    }
}
