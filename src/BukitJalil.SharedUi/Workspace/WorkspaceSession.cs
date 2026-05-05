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

    public List<LlmMessage> Messages { get; } = [];

    public async Task SendAsync(string input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return;
        }

        var trimmedInput = input.Trim();
        Messages.Add(new LlmMessage(LlmRole.User, trimmedInput));

        var provider = _providerRegistry.Get(SelectedProviderId);
        if (provider is null)
        {
            Messages.Add(new LlmMessage(LlmRole.Assistant, $"Provider '{SelectedProviderId}' is unavailable."));
            return;
        }

        try
        {
            var response = await provider.ChatAsync(new LlmChatRequest(Messages), cancellationToken);
            Messages.Add(response.Message);
        }
        catch (Exception exception)
        {
            Messages.Add(new LlmMessage(LlmRole.Assistant, $"Provider execution failed: {exception.Message}"));
        }
    }
}
