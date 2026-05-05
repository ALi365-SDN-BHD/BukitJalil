using System.Net;
using System.Text;
using System.Text.Json;
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

    [Fact]
    public async Task ChatAsync_builds_request_using_configured_base_url_headers_and_messages()
    {
        var settings = new AppSettings
        {
            ProviderBaseUrl = "https://api.openai.com/v1",
            ProviderApiKey = "key",
            ProviderModel = "gpt-4.1-mini"
        };

        Uri? requestUri = null;
        string? authorization = null;
        string? body = null;

        var store = new FakeSettingsStore(settings);
        using var client = new HttpClient(new StubHandler(request =>
        {
            requestUri = request.RequestUri;
            authorization = request.Headers.Authorization?.ToString();
            body = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"choices\":[{\"message\":{\"content\":\"Generated reply\"}}]}",
                    Encoding.UTF8,
                    "application/json")
            };
        }));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.System, "You are a site builder."),
            new LlmMessage(LlmRole.User, "Build a homepage")
        ]));

        Assert.Equal("https://api.openai.com/v1/chat/completions", requestUri?.ToString());
        Assert.Equal("Bearer key", authorization);

        using var payload = JsonDocument.Parse(body!);
        Assert.Equal("gpt-4.1-mini", payload.RootElement.GetProperty("model").GetString());

        var messages = payload.RootElement.GetProperty("messages");
        Assert.Equal(2, messages.GetArrayLength());
        Assert.Equal("system", messages[0].GetProperty("role").GetString());
        Assert.Equal("You are a site builder.", messages[0].GetProperty("content").GetString());
        Assert.Equal("user", messages[1].GetProperty("role").GetString());
        Assert.Equal("Build a homepage", messages[1].GetProperty("content").GetString());
    }

    [Fact]
    public async Task ChatAsync_disposes_http_response_after_reading()
    {
        var settings = new AppSettings
        {
            ProviderBaseUrl = "https://api.openai.com/v1",
            ProviderApiKey = "key",
            ProviderModel = "gpt-4.1-mini"
        };
        var disposed = false;

        var store = new FakeSettingsStore(settings);
        using var client = new HttpClient(new StubHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new TrackingContent(
                    "{\"choices\":[{\"message\":{\"content\":\"Generated reply\"}}]}",
                    () => disposed = true)
            }));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        _ = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.True(disposed);
    }

    [Fact]
    public async Task ChatAsync_returns_invalid_base_url_message_without_calling_http()
    {
        var settings = new AppSettings
        {
            ProviderBaseUrl = "not-a-url",
            ProviderApiKey = "key",
            ProviderModel = "gpt-4.1-mini"
        };

        var store = new FakeSettingsStore(settings);
        using var client = new HttpClient(new StubHandler(_ => throw new InvalidOperationException("HTTP should not be called")));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        var response = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.Contains("base url is invalid", response.Message.Content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ChatAsync_returns_user_friendly_message_when_transport_throws()
    {
        var settings = new AppSettings
        {
            ProviderBaseUrl = "https://api.openai.com/v1",
            ProviderApiKey = "key",
            ProviderModel = "gpt-4.1-mini"
        };

        var store = new FakeSettingsStore(settings);
        using var client = new HttpClient(new StubHandler(_ => throw new HttpRequestException("Name or service not known")));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        var response = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.Contains("request failed", response.Message.Content, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("check network or provider settings", response.Message.Content, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("name or service not known", response.Message.Content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ChatAsync_returns_status_message_when_response_is_not_successful()
    {
        var settings = new AppSettings
        {
            ProviderBaseUrl = "https://api.openai.com/v1",
            ProviderApiKey = "key",
            ProviderModel = "gpt-4.1-mini"
        };

        var store = new FakeSettingsStore(settings);
        using var client = new HttpClient(new StubHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        var response = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.Contains("503", response.Message.Content, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("request failed", response.Message.Content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ChatAsync_returns_parse_failure_message_when_response_has_no_assistant_content()
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
                    "{\"choices\":[{\"message\":{}}]}",
                    Encoding.UTF8,
                    "application/json")
            }));
        var provider = new OpenAiCompatibleLlmProvider(store, client);

        var response = await provider.ChatAsync(new LlmChatRequest(
        [
            new LlmMessage(LlmRole.User, "Hello")
        ]));

        Assert.Contains("could not be parsed", response.Message.Content, StringComparison.OrdinalIgnoreCase);
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

    private sealed class TrackingContent(string content, Action onDispose) : StringContent(content, Encoding.UTF8, "application/json")
    {
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                onDispose();
            }

            base.Dispose(disposing);
        }
    }
}
