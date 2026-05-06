using BukitJalil.Core;

namespace BukitJalil.App.Workspace;

public sealed class ProjectWorkspaceState
{
    public string ProjectName { get; private set; } = string.Empty;

    public ProjectWorkspaceTab ActiveTab { get; private set; } = ProjectWorkspaceTab.Overview;

    public string ActiveTabTitle =>
        ActiveTab switch
        {
            ProjectWorkspaceTab.Overview => "总览",
            ProjectWorkspaceTab.Conversation => "需求对话",
            ProjectWorkspaceTab.Structure => "站点结构",
            ProjectWorkspaceTab.Content => "内容草稿",
            ProjectWorkspaceTab.PreviewValidation => "预览校验",
            ProjectWorkspaceTab.BuildDeploy => "构建发布",
            ProjectWorkspaceTab.History => "变更历史",
            _ => "总览"
        };

    public string StageSummary { get; private set; } = "进入项目后从总览开始。";

    public void Initialize(string projectName)
    {
        ProjectName = projectName;
        ActiveTab = ProjectWorkspaceTab.Overview;
        StageSummary = "进入项目后从总览开始。";
    }

    public void SwitchTab(ProjectWorkspaceTab tab)
    {
        ActiveTab = tab;
        StageSummary = tab switch
        {
            ProjectWorkspaceTab.Overview => "查看项目摘要与下一步动作。",
            ProjectWorkspaceTab.Conversation => "梳理需求并沉淀结构草案。",
            ProjectWorkspaceTab.Structure => "审核页面树与区块结构。",
            ProjectWorkspaceTab.Content => "生成并批准内容草稿。",
            ProjectWorkspaceTab.PreviewValidation => "校验预览并定位问题。",
            ProjectWorkspaceTab.BuildDeploy => "执行构建与发布。",
            ProjectWorkspaceTab.History => "查看快照、记录与回退入口。",
            _ => "查看项目摘要与下一步动作。"
        };
    }
}
