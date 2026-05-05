using BukitJalil.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Infrastructure.Tests;

public class ServiceCollectionExtensionsTests
{
    [Fact]
    public void AddBukitJalilInfrastructure_registers_system_clock()
    {
        var services = new ServiceCollection();

        services.AddBukitJalilInfrastructure();

        using var provider = services.BuildServiceProvider();
        var clock = provider.GetService<ISystemClock>();

        Assert.NotNull(clock);
        Assert.True(clock!.UtcNow <= DateTimeOffset.UtcNow.AddSeconds(1));
    }
}
