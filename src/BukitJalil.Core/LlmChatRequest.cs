namespace BukitJalil.Core;

public sealed record LlmChatRequest(IReadOnlyList<LlmMessage> Messages);
