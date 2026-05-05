using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

public sealed class OpenAiCompatibleLlmProvider(ISettingsStore settingsStore, HttpClient httpClient) : ILlmProvider
{
    public ProviderDescriptor Descriptor { get; } = new("openai-compatible", "OpenAI-Compatible", false);

    public async Task<LlmChatResponse> ChatAsync(LlmChatRequest request, CancellationToken cancellationToken = default)
    {
        var settings = settingsStore.Get();

        if (string.IsNullOrWhiteSpace(settings.ProviderBaseUrl) ||
            string.IsNullOrWhiteSpace(settings.ProviderApiKey) ||
            string.IsNullOrWhiteSpace(settings.ProviderModel))
        {
            return Failure("OpenAI-compatible provider is not configured. Add Base URL, API key, and model in Settings.");
        }

        if (!Uri.TryCreate(settings.ProviderBaseUrl, UriKind.Absolute, out var baseUri))
        {
            return Failure("OpenAI-compatible provider Base URL is invalid. Update it in Settings.");
        }

        var normalizedBaseUri = new Uri($"{baseUri.ToString().TrimEnd('/')}/");
        var endpoint = new Uri(normalizedBaseUri, "chat/completions");
        var payload = new
        {
            model = settings.ProviderModel,
            messages = request.Messages.Select(message => new
            {
                role = message.Role.ToString().ToLowerInvariant(),
                content = message.Content
            })
        };

        using var message = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ProviderApiKey);

        string json;
        try
        {
            using var response = await httpClient.SendAsync(message, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                return Failure($"OpenAI-compatible request failed with status {(int)response.StatusCode}.");
            }

            json = await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (Exception)
        {
            return Failure("OpenAI-compatible request failed. Please check network or provider settings.");
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            var content = document.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            if (string.IsNullOrWhiteSpace(content))
            {
                return Failure("OpenAI-compatible response did not contain assistant content.");
            }

            return new LlmChatResponse(
                Descriptor.Id,
                new LlmMessage(LlmRole.Assistant, content));
        }
        catch (Exception)
        {
            return Failure("OpenAI-compatible response could not be parsed.");
        }
    }

    private LlmChatResponse Failure(string content)
    {
        return new LlmChatResponse(
            Descriptor.Id,
            new LlmMessage(LlmRole.Assistant, content));
    }
}
