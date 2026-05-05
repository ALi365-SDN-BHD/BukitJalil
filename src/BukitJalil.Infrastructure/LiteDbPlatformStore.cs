using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

internal sealed class LiteDbPlatformStore(AppDatabase database) : IPlatformStore
{
    public IReadOnlyList<DeploymentTarget> List()
    {
        return database.Platforms
            .FindAll()
            .OrderBy(target => target.Name)
            .Select(target => new DeploymentTarget
            {
                Id = target.Id,
                Name = target.Name,
                PlatformType = target.PlatformType,
                EndpointOrProject = target.EndpointOrProject,
                AccessTokenLabel = target.AccessTokenLabel
            })
            .ToList();
    }

    public void Save(DeploymentTarget target)
    {
        database.Platforms.Upsert(new PlatformDocument
        {
            Id = target.Id,
            Name = target.Name,
            PlatformType = target.PlatformType,
            EndpointOrProject = target.EndpointOrProject,
            AccessTokenLabel = target.AccessTokenLabel
        });
    }
}
