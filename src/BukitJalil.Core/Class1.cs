using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Core;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddBukitJalilCore(this IServiceCollection services)
    {
        services.AddSingleton<IAppShellCatalog, StaticAppShellCatalog>();
        return services;
    }
}
