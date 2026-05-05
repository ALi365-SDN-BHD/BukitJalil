using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Core;

public sealed record AppShellItem(string Title, string Route, string Description);

public interface IAppShellCatalog
{
    IReadOnlyList<AppShellItem> Items { get; }
}

internal sealed class StaticAppShellCatalog : IAppShellCatalog
{
    public IReadOnlyList<AppShellItem> Items { get; } =
    [
        new("Projects", "/projects", "Create and open website projects."),
        new("Workspace", "/workspace", "Chat, preview, and generated files."),
        new("Platforms", "/platforms", "Manage deployment destinations."),
        new("Settings", "/settings", "Configure Bukit and AI providers.")
    ];
}

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddBukitJalilCore(this IServiceCollection services)
    {
        services.AddSingleton<IAppShellCatalog, StaticAppShellCatalog>();
        return services;
    }
}
