using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

internal sealed class ProviderRegistry(IEnumerable<ILlmProvider> providers) : IProviderRegistry
{
    private readonly IReadOnlyList<ILlmProvider> _providers = providers.ToList();

    public ILlmProvider? Get(string providerId)
    {
        return _providers.FirstOrDefault(provider =>
            string.Equals(provider.Descriptor.Id, providerId, StringComparison.OrdinalIgnoreCase));
    }

    public IReadOnlyList<ProviderDescriptor> List()
    {
        return _providers.Select(provider => provider.Descriptor).ToList();
    }
}
