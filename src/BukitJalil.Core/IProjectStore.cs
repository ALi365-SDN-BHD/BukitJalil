namespace BukitJalil.Core;

public interface IProjectStore
{
    IReadOnlyList<WebsiteProject> List();

    WebsiteProject Create(string name);
}
