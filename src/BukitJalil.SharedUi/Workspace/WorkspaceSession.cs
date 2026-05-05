using BukitJalil.Core;

namespace BukitJalil.App.Workspace;

public sealed class WorkspaceSession
{
    private readonly IProviderRegistry _providerRegistry;
    private WorkspaceConversation _conversation = default!;

    public WorkspaceSession(IProviderRegistry providerRegistry)
    {
        _providerRegistry = providerRegistry;
    }

    public WorkspaceSession(IProviderRegistry providerRegistry, string selectedProviderId)
        : this(providerRegistry)
    {
        Bind(WorkspaceConversation.Create(selectedProviderId, DateTimeOffset.UtcNow));
    }

    public string SelectedProviderId
    {
        get => _conversation.SelectedProviderId;
        set => _conversation.SelectedProviderId = value;
    }

    public bool IsSending { get; private set; }

    public string StatusMessage { get; private set; } = "Ready.";

    public IReadOnlyList<WorkspaceConversationMessage> Messages => _conversation.Messages;

    public WorkspaceConversation Conversation => _conversation;

    public void Bind(WorkspaceConversation conversation)
    {
        _conversation = conversation;
        StatusMessage = "Ready.";
        IsSending = false;
    }

    public void Clear()
    {
        _conversation.Messages.Clear();
        IsSending = false;
        StatusMessage = "Ready.";
    }

    public async Task SendAsync(string input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            StatusMessage = "Enter a prompt before sending.";
            return;
        }

        var trimmedInput = input.Trim();
        _conversation.Messages.Add(new WorkspaceConversationMessage(LlmRole.User, trimmedInput));

        var provider = _providerRegistry.Get(SelectedProviderId);
        if (provider is null)
        {
            StatusMessage = $"Provider '{SelectedProviderId}' is unavailable.";
            _conversation.Messages.Add(new WorkspaceConversationMessage(LlmRole.Assistant, StatusMessage));
            return;
        }

        IsSending = true;
        StatusMessage = "Sending request...";

        try
        {
            var request = new LlmChatRequest(_conversation.Messages
                .Select(message => new LlmMessage(message.Role, message.Content))
                .ToList());
            var response = await provider.ChatAsync(request, cancellationToken);
            _conversation.Messages.Add(new WorkspaceConversationMessage(response.Message.Role, response.Message.Content));
            StatusMessage = "Response received.";
        }
        catch (Exception exception)
        {
            StatusMessage = $"Provider execution failed: {exception.Message}";
            _conversation.Messages.Add(new WorkspaceConversationMessage(LlmRole.Assistant, StatusMessage));
        }
        finally
        {
            IsSending = false;
        }
    }
}
