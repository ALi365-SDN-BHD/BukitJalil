using BukitJalil.Core;

namespace BukitJalil.App.Workspace;

public sealed class WorkspaceSession
{
    private readonly IProviderRegistry _providerRegistry;

    public WorkspaceSession(IProviderRegistry providerRegistry, string selectedProviderId)
    {
        _providerRegistry = providerRegistry;
        SelectedProviderId = selectedProviderId;
    }

    public string SelectedProviderId { get; set; }

    public bool IsSending { get; private set; }

    public string StatusMessage { get; private set; } = "Ready.";

    public List<LlmMessage> Messages { get; } = [];

    public async Task SendAsync(string input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            StatusMessage = "Enter a prompt before sending.";
            return;
        }

        var trimmedInput = input.Trim();
        Messages.Add(new LlmMessage(LlmRole.User, trimmedInput));

        var provider = _providerRegistry.Get(SelectedProviderId);
        if (provider is null)
        {
            StatusMessage = $"Provider '{SelectedProviderId}' is unavailable.";
            Messages.Add(new LlmMessage(LlmRole.Assistant, StatusMessage));
            return;
        }

        IsSending = true;
        StatusMessage = "Sending request...";

        try
        {
            var response = await provider.ChatAsync(new LlmChatRequest(Messages), cancellationToken);
            Messages.Add(response.Message);
            StatusMessage = "Response received.";
        }
        catch (Exception exception)
        {
            StatusMessage = $"Provider execution failed: {exception.Message}";
            Messages.Add(new LlmMessage(LlmRole.Assistant, StatusMessage));
        }
        finally
        {
            IsSending = false;
        }
    }
}
