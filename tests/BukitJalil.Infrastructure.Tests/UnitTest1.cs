using BukitJalil.Core;
using BukitJalil.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Infrastructure.Tests;

public sealed class ServiceCollectionExtensionsTests : IDisposable
{
    private readonly string _tempRoot = Path.Combine(Path.GetTempPath(), "bukitjalil-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void AddBukitJalilInfrastructure_registers_persistence_services()
    {
        var services = new ServiceCollection();

        services.AddBukitJalilInfrastructure(options =>
        {
            options.AppDataDirectory = _tempRoot;
        });

        using var provider = services.BuildServiceProvider();
        var clock = provider.GetService<ISystemClock>();
        var settingsStore = provider.GetService<ISettingsStore>();
        var projectStore = provider.GetService<IProjectStore>();
        var platformStore = provider.GetService<IPlatformStore>();

        Assert.NotNull(clock);
        Assert.NotNull(settingsStore);
        Assert.NotNull(projectStore);
        Assert.NotNull(platformStore);
        Assert.True(clock!.UtcNow <= DateTimeOffset.UtcNow.AddSeconds(1));
    }

    [Fact]
    public void SettingsStore_persists_saved_settings()
    {
        var services = new ServiceCollection();
        services.AddBukitJalilInfrastructure(options =>
        {
            options.AppDataDirectory = _tempRoot;
        });

        using var provider = services.BuildServiceProvider();
        var store = provider.GetRequiredService<ISettingsStore>();
        var settings = new AppSettings
        {
            BukitPath = "/usr/local/bin/bukit",
            DocumentsPath = "/tmp/docs",
            DefaultProvider = "openai-compatible",
            ProviderBaseUrl = "https://api.openai.com/v1",
            ProviderApiKey = "test-key",
            ProviderModel = "gpt-4.1-mini"
        };

        store.Save(settings);
        var reloaded = store.Get();

        Assert.Equal(settings.BukitPath, reloaded.BukitPath);
        Assert.Equal(settings.DocumentsPath, reloaded.DocumentsPath);
        Assert.Equal(settings.DefaultProvider, reloaded.DefaultProvider);
        Assert.Equal(settings.ProviderBaseUrl, reloaded.ProviderBaseUrl);
        Assert.Equal(settings.ProviderApiKey, reloaded.ProviderApiKey);
        Assert.Equal(settings.ProviderModel, reloaded.ProviderModel);
    }

    [Fact]
    public void ProjectStore_create_project_creates_workspace_and_lists_it()
    {
        var services = new ServiceCollection();
        services.AddBukitJalilInfrastructure(options =>
        {
            options.AppDataDirectory = _tempRoot;
        });

        using var provider = services.BuildServiceProvider();
        var store = provider.GetRequiredService<IProjectStore>();

        var project = store.Create("Acme Landing Page");
        var projects = store.List();

        Assert.Equal("Acme Landing Page", project.Name);
        Assert.True(Directory.Exists(project.WorkspacePath));
        Assert.Contains(projects, item => item.Id == project.Id);
        Assert.Contains("acme-landing-page", project.WorkspacePath, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void PlatformStore_save_and_list_round_trips_target()
    {
        var services = new ServiceCollection();
        services.AddBukitJalilInfrastructure(options =>
        {
            options.AppDataDirectory = _tempRoot;
        });

        using var provider = services.BuildServiceProvider();
        var store = provider.GetRequiredService<IPlatformStore>();
        var target = new DeploymentTarget
        {
            Name = "Production GitHub Pages",
            PlatformType = "github-pages",
            EndpointOrProject = "ali/acme-site",
            AccessTokenLabel = "github_pat"
        };

        store.Save(target);
        var targets = store.List();

        Assert.Contains(targets, item => item.Id == target.Id);
        Assert.Contains(targets, item => item.PlatformType == "github-pages");
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempRoot))
        {
            Directory.Delete(_tempRoot, recursive: true);
        }
    }
}
