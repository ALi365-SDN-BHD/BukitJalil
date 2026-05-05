namespace BukitJalil.Infrastructure;

public sealed class BukitJalilStorageOptions
{
    public string AppDataDirectory { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BukitJalil");

    public string DatabasePath => Path.Combine(AppDataDirectory, "bukitjalil.db");

    public string ProjectsRootPath => Path.Combine(AppDataDirectory, "projects");
}
