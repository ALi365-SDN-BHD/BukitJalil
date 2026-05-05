using BukitJalil.Core;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Core.Tests;

public class ServiceCollectionExtensionsTests
{
    [Fact]
    public void AddBukitJalilCore_registers_shell_navigation_catalog()
    {
        var services = new ServiceCollection();

        services.AddBukitJalilCore();

        using var provider = services.BuildServiceProvider();
        var catalog = provider.GetService<IAppShellCatalog>();

        Assert.NotNull(catalog);
        Assert.Collection(
            catalog!.Items,
            item => Assert.Equal("/projects", item.Route),
            item => Assert.Equal("/workspace", item.Route),
            item => Assert.Equal("/platforms", item.Route),
            item => Assert.Equal("/settings", item.Route));
    }
}
