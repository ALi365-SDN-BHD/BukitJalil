using BukitJalil.Core;

namespace BukitJalil.App.Workspace;

public static class WorkspaceDefaultProviderSelector
{
    public static string Resolve(
        IReadOnlyList<ProviderDescriptor> providers,
        string configuredDefaultProviderId)
    {
        if (!string.IsNullOrWhiteSpace(configuredDefaultProviderId) &&
            providers.Any(provider => string.Equals(
                provider.Id,
                configuredDefaultProviderId,
                StringComparison.OrdinalIgnoreCase)))
        {
            return configuredDefaultProviderId;
        }

        return providers.FirstOrDefault()?.Id ?? "fake";
    }
}
