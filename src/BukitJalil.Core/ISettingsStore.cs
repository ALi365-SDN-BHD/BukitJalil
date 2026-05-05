namespace BukitJalil.Core;

public interface ISettingsStore
{
    AppSettings Get();

    void Save(AppSettings settings);
}
