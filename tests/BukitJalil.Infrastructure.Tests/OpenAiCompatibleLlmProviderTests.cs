using System.Net;
using System.Text;
using BukitJalil.Core;
using BukitJalil.Infrastructure;

namespace BukitJalil.Infrastructure.Tests;

public sealed class OpenAiCompatibleLlmProviderTests
{
    [Fact]
    public async Task ChatAsync_returns_configuration_message_when_settings_are_missing()
    {
        var store = new FakeSettingsStore(new AppSettings());
        using var client = new HttpClient(new StubHandler(_ => throw new InvalidOperationException("HTTP should not be called")));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        var response = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.Equal("openai-compatible", response.ProviderId);
        Assert.Contains("not configured", response.Message.Content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ChatAsync_parses_first_assistant_message()
    {
        var settings = new AppSettings
        {
            ProviderBaseUrl = "https://api.openai.com/v1",
            ProviderApiKey = "key",
            ProviderModel = "gpt-4.1-mini"
        };

        var store = new FakeSettingsStore(settings);
        using var client = new HttpClient(new StubHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"choices\":[{\"message\":{\"content\":\"Generated reply\"}}]}",
                    Encoding.UTF8,
                    "application/json")
            }));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        var response = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.Equal(LlmRole.Assistant, response.Message.Role);
        Assert.Equal("Generated reply", response.Message.Content);
    }

    private sealed class FakeSettingsStore(AppSettings settings) : ISettingsStore
    {
        public AppSettings Get() => settings;

        public void Save(AppSettings settingsToSave) => throw new NotSupportedException();
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            return Task.FromResult(responseFactory(request));
        }
    }
}
