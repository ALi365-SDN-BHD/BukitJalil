using BukitJalil.Core;

namespace BukitJalil.Core.Tests;

public sealed class ProviderContractsTests
{
    [Fact]
    public void LlmMessage_create_user_message_preserves_role_and_content()
    {
        var message = new LlmMessage(LlmRole.User, "Build a corporate website");

        Assert.Equal(LlmRole.User, message.Role);
        Assert.Equal("Build a corporate website", message.Content);
    }

    [Fact]
    public void LlmChatRequest_wraps_messages_in_order()
    {
        var request = new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "First"),
            new LlmMessage(LlmRole.Assistant, "Second")
        ]);

        Assert.Collection(
            request.Messages,
            item => Assert.Equal("First", item.Content),
            item => Assert.Equal("Second", item.Content));
    }
}
