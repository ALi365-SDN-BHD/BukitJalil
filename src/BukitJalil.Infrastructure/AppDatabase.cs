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
        WorkspaceConversations.EnsureIndex(conversation => conversation.Id, unique: true);
    }

    public ILiteCollection<AppSettingsDocument> Settings => _database.GetCollection<AppSettingsDocument>("settings");

    public ILiteCollection<ProjectDocument> Projects => _database.GetCollection<ProjectDocument>("projects");

    public ILiteCollection<PlatformDocument> Platforms => _database.GetCollection<PlatformDocument>("platforms");

    public ILiteCollection<WorkspaceConversationDocument> WorkspaceConversations =>
        _database.GetCollection<WorkspaceConversationDocument>("workspace_conversations");

    public ILiteCollection<WorkspaceStateDocument> WorkspaceState =>
        _database.GetCollection<WorkspaceStateDocument>("workspace_state");

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

internal sealed class WorkspaceConversationDocument
{
    public string Id { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string SelectedProviderId { get; set; } = string.Empty;

    public List<WorkspaceConversationMessageDocument> Messages { get; set; } = [];

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }
}

internal sealed class WorkspaceConversationMessageDocument
{
    public string Role { get; set; } = string.Empty;

    public string Content { get; set; } = string.Empty;
}

internal sealed class WorkspaceStateDocument
{
    public int Id { get; set; } = 1;

    public string CurrentConversationId { get; set; } = string.Empty;
}
