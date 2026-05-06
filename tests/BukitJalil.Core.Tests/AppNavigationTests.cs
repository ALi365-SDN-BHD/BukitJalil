using BukitJalil.Core;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Core.Tests;

public sealed class AppNavigationTests
{
    [Fact]
    public void App_shell_catalog_exposes_chinese_product_sections_in_order()
    {
        var services = new ServiceCollection()
            .AddBukitJalilCore()
            .BuildServiceProvider();

        var catalog = services.GetRequiredService<IAppShellCatalog>();

        Assert.Collection(
            catalog.Items,
            item =>
            {
                Assert.Equal("项目", item.Title);
                Assert.Equal("/projects", item.Route);
            },
            item =>
            {
                Assert.Equal("工作台", item.Title);
                Assert.Equal("/workspace", item.Route);
            },
            item =>
            {
                Assert.Equal("发布中心", item.Title);
                Assert.Equal("/publish-center", item.Route);
            },
            item =>
            {
                Assert.Equal("历史记录", item.Title);
                Assert.Equal("/history", item.Route);
            },
            item =>
            {
                Assert.Equal("设置与诊断", item.Title);
                Assert.Equal("/settings", item.Route);
            });
    }
}
