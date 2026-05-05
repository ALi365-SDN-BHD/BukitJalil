namespace BukitJalil.Core;

public sealed record DeploymentTarget
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    public string Name { get; set; } = string.Empty;

    public string PlatformType { get; set; } = string.Empty;

    public string EndpointOrProject { get; set; } = string.Empty;

    public string AccessTokenLabel { get; set; } = string.Empty;
}
