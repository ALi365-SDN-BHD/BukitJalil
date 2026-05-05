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
    public static IServiceCollection AddBukitJalilInfrastructure(this IServiceCollection services)
    {
        services.AddSingleton<ISystemClock, SystemClock>();
        return services;
    }
}
