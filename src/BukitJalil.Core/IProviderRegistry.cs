namespace BukitJalil.Core;

public interface IProviderRegistry
{
    IReadOnlyList<ProviderDescriptor> List();

    ILlmProvider? Get(string providerId);
}
