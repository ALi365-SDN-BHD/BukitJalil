namespace BukitJalil.Core;

public sealed record AppShellItem(
    string Title,
    string Route,
    string Description,
    string Icon);

public interface IAppShellCatalog
{
    IReadOnlyList<AppShellItem> Items { get; }
}

internal sealed class StaticAppShellCatalog : IAppShellCatalog
{
    public IReadOnlyList<AppShellItem> Items { get; } =
    [
        new("项目", "/projects", "创建、打开和管理项目。", "folder"),
        new("工作台", "/workspace", "在结构化流程中推进当前项目。", "workflow"),
        new("发布中心", "/publish-center", "统一查看构建、发布和目标平台。", "rocket"),
        new("历史记录", "/history", "查看生成历史、快照与发布记录。", "history"),
        new("设置与诊断", "/settings", "配置 Bukit、模型与运行环境。", "settings")
    ];
}
