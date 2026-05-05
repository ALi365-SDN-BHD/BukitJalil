using BukitJalil.Core;

namespace BukitJalil.Infrastructure;

internal sealed class LiteDbSettingsStore(AppDatabase database) : ISettingsStore
{
    public AppSettings Get()
    {
        var document = database.Settings.FindById(1);

        return document is null
            ? new AppSettings()
            : new AppSettings
            {
                BukitPath = document.BukitPath,
                DocumentsPath = document.DocumentsPath,
                DefaultProvider = document.DefaultProvider,
                ProviderBaseUrl = document.ProviderBaseUrl,
                ProviderApiKey = document.ProviderApiKey,
                ProviderModel = document.ProviderModel
            };
    }

    public void Save(AppSettings settings)
    {
        var document = new AppSettingsDocument
        {
            Id = 1,
            BukitPath = settings.BukitPath,
            DocumentsPath = settings.DocumentsPath,
            DefaultProvider = settings.DefaultProvider,
            ProviderBaseUrl = settings.ProviderBaseUrl,
            ProviderApiKey = settings.ProviderApiKey,
            ProviderModel = settings.ProviderModel
        };

        database.Settings.Upsert(document);
    }
}
