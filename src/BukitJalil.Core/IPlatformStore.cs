namespace BukitJalil.Core;

public interface IPlatformStore
{
    IReadOnlyList<DeploymentTarget> List();

    void Save(DeploymentTarget target);
}
