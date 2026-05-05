using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

internal sealed class LiteDbProjectStore(
    AppDatabase database,
    BukitJalilStorageOptions options,
    ISystemClock clock) : IProjectStore
{
    public WebsiteProject Create(string name)
    {
        var normalizedName = name.Trim();
        var slug = Slugify(normalizedName);
        var workspacePath = BuildUniqueWorkspacePath(slug);

        Directory.CreateDirectory(workspacePath);

        var project = new WebsiteProject
        {
            Name = normalizedName,
            Slug = slug,
            WorkspacePath = workspacePath,
            CreatedUtc = clock.UtcNow
        };

        database.Projects.Insert(new ProjectDocument
        {
            Id = project.Id,
            Name = project.Name,
            Slug = project.Slug,
            WorkspacePath = project.WorkspacePath,
            CreatedUtc = project.CreatedUtc
        });

        return project;
    }

    public IReadOnlyList<WebsiteProject> List()
    {
        return database.Projects
            .FindAll()
            .OrderByDescending(project => project.CreatedUtc)
            .Select(project => new WebsiteProject
            {
                Id = project.Id,
                Name = project.Name,
                Slug = project.Slug,
                WorkspacePath = project.WorkspacePath,
                CreatedUtc = project.CreatedUtc
            })
            .ToList();
    }

    private string BuildUniqueWorkspacePath(string slug)
    {
        var candidate = Path.Combine(options.ProjectsRootPath, slug);
        var suffix = 1;

        while (Directory.Exists(candidate))
        {
            candidate = Path.Combine(options.ProjectsRootPath, $"{slug}-{suffix}");
            suffix++;
        }

        return candidate;
    }

    private static string Slugify(string value)
    {
        var buffer = new List<char>(value.Length);
        var previousDash = false;

        foreach (var character in value.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                buffer.Add(character);
                previousDash = false;
                continue;
            }

            if (previousDash)
            {
                continue;
            }

            buffer.Add('-');
            previousDash = true;
        }

        var slug = new string(buffer.ToArray()).Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "project" : slug;
    }
}
