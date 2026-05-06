using BukitJalil.App.Workspace;
using BukitJalil.Core;

namespace BukitJalil.App.Tests;

public sealed class ProjectWorkspaceStateTests
{
    [Fact]
    public void Initialize_sets_default_workspace_tab_and_project_name()
    {
        var state = new ProjectWorkspaceState();

        state.Initialize("企业服务官网");

        Assert.Equal("企业服务官网", state.ProjectName);
        Assert.Equal(ProjectWorkspaceTab.Overview, state.ActiveTab);
        Assert.Equal("总览", state.ActiveTabTitle);
    }

    [Fact]
    public void SwitchTab_updates_active_tab_and_stage_summary()
    {
        var state = new ProjectWorkspaceState();
        state.Initialize("企业服务官网");

        state.SwitchTab(ProjectWorkspaceTab.Structure);

        Assert.Equal(ProjectWorkspaceTab.Structure, state.ActiveTab);
        Assert.Contains("结构", state.StageSummary, StringComparison.Ordinal);
    }

    [Fact]
    public void Workspace_tab_titles_cover_the_first_three_workflow_stages()
    {
        var state = new ProjectWorkspaceState();
        state.Initialize("企业服务官网");

        state.SwitchTab(ProjectWorkspaceTab.Conversation);
        Assert.Equal("需求对话", state.ActiveTabTitle);

        state.SwitchTab(ProjectWorkspaceTab.Structure);
        Assert.Equal("站点结构", state.ActiveTabTitle);
    }

    [Fact]
    public void Workspace_tab_titles_cover_all_workflow_stages()
    {
        var state = new ProjectWorkspaceState();
        state.Initialize("企业服务官网");

        state.SwitchTab(ProjectWorkspaceTab.Content);
        Assert.Equal("内容草稿", state.ActiveTabTitle);

        state.SwitchTab(ProjectWorkspaceTab.PreviewValidation);
        Assert.Equal("预览校验", state.ActiveTabTitle);

        state.SwitchTab(ProjectWorkspaceTab.BuildDeploy);
        Assert.Equal("构建发布", state.ActiveTabTitle);

        state.SwitchTab(ProjectWorkspaceTab.History);
        Assert.Equal("变更历史", state.ActiveTabTitle);
    }
}
