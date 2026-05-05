namespace BukitJalil.Core;

public interface ILlmProvider
{
    ProviderDescriptor Descriptor { get; }

    Task<LlmChatResponse> ChatAsync(LlmChatRequest request, CancellationToken cancellationToken = default);
}
