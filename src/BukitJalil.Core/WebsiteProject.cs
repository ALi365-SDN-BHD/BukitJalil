namespace BukitJalil.Core;

public sealed record WebsiteProject
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    public string Name { get; set; } = string.Empty;

    public string Slug { get; set; } = string.Empty;

    public string WorkspacePath { get; set; } = string.Empty;

    public DateTimeOffset CreatedUtc { get; set; } = DateTimeOffset.UtcNow;
}
