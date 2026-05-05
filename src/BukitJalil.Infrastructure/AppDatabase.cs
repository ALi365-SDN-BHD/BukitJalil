using LiteDB;

namespace BukitJalil.Infrastructure;

internal sealed class AppDatabase : IDisposable
{
    private readonly LiteDatabase _database;

    public AppDatabase(BukitJalilStorageOptions options)
    {
        Directory.CreateDirectory(options.AppDataDirectory);
        Directory.CreateDirectory(options.ProjectsRootPath);

        _database = new LiteDatabase(options.DatabasePath);

        Projects.EnsureIndex(project => project.Id, unique: true);
        Platforms.EnsureIndex(target => target.Id, unique: true);
    }

    public ILiteCollection<AppSettingsDocument> Settings => _database.GetCollection<AppSettingsDocument>("settings");

    public ILiteCollection<ProjectDocument> Projects => _database.GetCollection<ProjectDocument>("projects");

    public ILiteCollection<PlatformDocument> Platforms => _database.GetCollection<PlatformDocument>("platforms");

    public void Dispose()
    {
        _database.Dispose();
    }
}

internal sealed class AppSettingsDocument
{
    public int Id { get; set; } = 1;

    public string BukitPath { get; set; } = string.Empty;

    public string DocumentsPath { get; set; } = string.Empty;

    public string DefaultProvider { get; set; } = string.Empty;

    public string ProviderBaseUrl { get; set; } = string.Empty;

    public string ProviderApiKey { get; set; } = string.Empty;

    public string ProviderModel { get; set; } = string.Empty;
}

internal sealed class ProjectDocument
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string Slug { get; set; } = string.Empty;

    public string WorkspacePath { get; set; } = string.Empty;

    public DateTimeOffset CreatedUtc { get; set; }
}

internal sealed class PlatformDocument
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string PlatformType { get; set; } = string.Empty;

    public string EndpointOrProject { get; set; } = string.Empty;

    public string AccessTokenLabel { get; set; } = string.Empty;
}
