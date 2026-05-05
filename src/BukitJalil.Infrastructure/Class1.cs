using BukitJalil.Core;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Infrastructure;

public interface ISystemClock
{
    DateTimeOffset UtcNow { get; }
}

internal sealed class SystemClock : ISystemClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddBukitJalilInfrastructure(
        this IServiceCollection services,
        Action<BukitJalilStorageOptions>? configure = null)
    {
        var options = new BukitJalilStorageOptions();
        configure?.Invoke(options);

        services.AddSingleton(options);
        services.AddSingleton<AppDatabase>();
        services.AddSingleton<ISystemClock, SystemClock>();
        services.AddSingleton<ISettingsStore, LiteDbSettingsStore>();
        services.AddSingleton<IProjectStore, LiteDbProjectStore>();
        services.AddSingleton<IPlatformStore, LiteDbPlatformStore>();
        services.AddSingleton<IWorkspaceConversationStore, LiteDbWorkspaceConversationStore>();
        services.AddHttpClient<OpenAiCompatibleLlmProvider>();
        services.AddSingleton<ILlmProvider, FakeLlmProvider>();
        services.AddSingleton<ILlmProvider>(serviceProvider => serviceProvider.GetRequiredService<OpenAiCompatibleLlmProvider>());
        services.AddSingleton<IProviderRegistry, ProviderRegistry>();
        return services;
    }
}
