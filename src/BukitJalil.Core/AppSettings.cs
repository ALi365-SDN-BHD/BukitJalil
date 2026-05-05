namespace BukitJalil.Core;

public sealed record AppSettings
{
    public string BukitPath { get; set; } = string.Empty;

    public string DocumentsPath { get; set; } = string.Empty;

    public string DefaultProvider { get; set; } = string.Empty;
}
