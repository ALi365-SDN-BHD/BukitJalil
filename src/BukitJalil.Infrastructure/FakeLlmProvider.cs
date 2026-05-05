using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

public sealed class FakeLlmProvider : ILlmProvider
{
    public ProviderDescriptor Descriptor { get; } = new("fake", "Fake Provider", true);

    public Task<LlmChatResponse> ChatAsync(LlmChatRequest request, CancellationToken cancellationToken = default)
    {
        var latestUserMessage = request.Messages.LastOrDefault(message => message.Role == LlmRole.User)?.Content
            ?? "No prompt provided.";
        var content =
            $"Received your request: \"{latestUserMessage}\".\n" +
            "Next step: outline the page structure.\n" +
            "Note: this is a simulated provider response.";

        return Task.FromResult(new LlmChatResponse(
            Descriptor.Id,
            new LlmMessage(LlmRole.Assistant, content)));
    }
}
