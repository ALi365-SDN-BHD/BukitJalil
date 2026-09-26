# AIBuilding UI Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `BukitJalil` into a Chinese desktop workstation UI that keeps the feel of `AIBuilding` while reorganizing the product around a workflow-first information architecture.

**Architecture:** Replace the current scaffold shell with a new app shell, add explicit workflow state objects for the project workspace, and re-home preview/code/files/build/log surfaces under workflow tabs instead of top-level navigation. Keep UI composition in `BukitJalil.App`, keep stateful workspace orchestration in `BukitJalil.SharedUi`, and keep persistence/integration logic in existing Core and Infrastructure services.

**Tech Stack:** .NET 10, C#, MAUI Blazor Hybrid, Razor components, xUnit, existing LiteDB-backed stores, existing provider registry and workspace conversation persistence

---

## File Map

### Create

- `src/BukitJalil.Core/AppNavigation.cs`
- `src/BukitJalil.Core/ProjectWorkspaceTab.cs`
- `src/BukitJalil.SharedUi/Workspace/ProjectWorkspaceState.cs`
- `src/BukitJalil.App/Components/Layout/AppSidebar.razor`
- `src/BukitJalil.App/Components/Layout/AppTopbar.razor`
- `src/BukitJalil.App/Components/Layout/WorkspaceRightRail.razor`
- `src/BukitJalil.App/Components/Layout/WorkspaceStatusBar.razor`
- `src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor`
- `src/BukitJalil.App/Components/Workspace/OverviewPanel.razor`
- `src/BukitJalil.App/Components/Workspace/ConversationPanel.razor`
- `src/BukitJalil.App/Components/Workspace/StructureEditorPanel.razor`
- `src/BukitJalil.App/Components/Workspace/ContentDraftPanel.razor`
- `src/BukitJalil.App/Components/Workspace/PreviewValidationPanel.razor`
- `src/BukitJalil.App/Components/Workspace/BuildDeployPanel.razor`
- `src/BukitJalil.App/Components/Workspace/HistoryTimelinePanel.razor`
- `src/BukitJalil.App/Components/Pages/PublishCenter.razor`
- `src/BukitJalil.App/Components/Pages/History.razor`
- `tests/BukitJalil.Core.Tests/AppNavigationTests.cs`
- `tests/BukitJalil.App.Tests/ProjectWorkspaceStateTests.cs`

### Modify

- `src/BukitJalil.Core/Class1.cs`
- `src/BukitJalil.App/Components/Layout/MainLayout.razor`
- `src/BukitJalil.App/Components/Layout/MainLayout.razor.css`
- `src/BukitJalil.App/Components/Layout/NavMenu.razor`
- `src/BukitJalil.App/Components/Layout/NavMenu.razor.css`
- `src/BukitJalil.App/Components/Pages/Home.razor`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `src/BukitJalil.App/Components/Pages/Weather.razor`
- `src/BukitJalil.App/Components/Pages/Settings.razor`
- `src/BukitJalil.App/wwwroot/app.css`
- `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs`
- `tests/BukitJalil.App.Tests/UnitTest1.cs`

### Responsibilities

- `AppNavigation.cs` defines the Chinese app-level navigation model and route metadata.
- `ProjectWorkspaceTab.cs` defines project-level workflow tabs.
- `ProjectWorkspaceState.cs` owns current project name, active tab, stage summary, and right-rail summaries.
- `AppSidebar.razor` renders the new Chinese sidebar.
- `AppTopbar.razor` renders the application-wide top bar and project context.
- `WorkspaceRightRail.razor` shows AI summary, suggestions, and recent events.
- `WorkspaceStatusBar.razor` shows validation/build/deploy status.
- `WorkspaceTabHost.razor` switches the seven workflow tab panels.
- Each `*Panel.razor` file owns one workflow tab surface.
- `Home.razor`, `Counter.razor`, `Weather.razor`, `Settings.razor`, `PublishCenter.razor`, and `History.razor` become Chinese product pages instead of scaffold pages.
- `app.css` becomes the source of the new workstation visual system.

### Scope Note

This plan implements the full desktop information architecture and panel skeletons in phases. It does **not** attempt to finish every future service integration in one pass. The plan creates the correct shell, workflow states, routes, and UI boundaries first, then wires existing persistence and current chat/build surfaces into their new locations.

---

### Task 1: Replace App Navigation With Chinese Product Navigation

**Files:**
- Create: `src/BukitJalil.Core/AppNavigation.cs`
- Modify: `src/BukitJalil.Core/Class1.cs`
- Test: `tests/BukitJalil.Core.Tests/AppNavigationTests.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/BukitJalil.Core.Tests/AppNavigationTests.cs`:

```csharp
using BukitJalil.Core;
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Core.Tests;

public sealed class AppNavigationTests
{
    [Fact]
    public void App_shell_catalog_exposes_chinese_product_sections_in_order()
    {
        var services = new ServiceCollection()
            .AddBukitJalilCore()
            .BuildServiceProvider();

        var catalog = services.GetRequiredService<IAppShellCatalog>();

        Assert.Collection(
            catalog.Items,
            item =>
            {
                Assert.Equal("项目", item.Title);
                Assert.Equal("/projects", item.Route);
            },
            item =>
            {
                Assert.Equal("工作台", item.Title);
                Assert.Equal("/workspace", item.Route);
            },
            item =>
            {
                Assert.Equal("发布中心", item.Title);
                Assert.Equal("/publish-center", item.Route);
            },
            item =>
            {
                Assert.Equal("历史记录", item.Title);
                Assert.Equal("/history", item.Route);
            },
            item =>
            {
                Assert.Equal("设置与诊断", item.Title);
                Assert.Equal("/settings", item.Route);
            });
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.Core.Tests/BukitJalil.Core.Tests.csproj --filter App_shell_catalog_exposes_chinese_product_sections_in_order -v minimal`

Expected: FAIL because the existing catalog still returns `Projects / Workspace / Platforms / Settings`.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.Core/AppNavigation.cs`:

```csharp
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
```

Update `src/BukitJalil.Core/Class1.cs` to:

```csharp
using Microsoft.Extensions.DependencyInjection;

namespace BukitJalil.Core;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddBukitJalilCore(this IServiceCollection services)
    {
        services.AddSingleton<IAppShellCatalog, StaticAppShellCatalog>();
        return services;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.Core.Tests/BukitJalil.Core.Tests.csproj --filter App_shell_catalog_exposes_chinese_product_sections_in_order -v minimal`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.Core/AppNavigation.cs \
  src/BukitJalil.Core/Class1.cs \
  tests/BukitJalil.Core.Tests/AppNavigationTests.cs
git commit -m "feat: add Chinese app navigation model"
```

### Task 2: Add Project Workspace Tabs and State Skeleton

**Files:**
- Create: `src/BukitJalil.Core/ProjectWorkspaceTab.cs`
- Create: `src/BukitJalil.SharedUi/Workspace/ProjectWorkspaceState.cs`
- Test: `tests/BukitJalil.App.Tests/ProjectWorkspaceStateTests.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/BukitJalil.App.Tests/ProjectWorkspaceStateTests.cs`:

```csharp
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
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter ProjectWorkspaceStateTests -v minimal`

Expected: FAIL because `ProjectWorkspaceState` and `ProjectWorkspaceTab` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.Core/ProjectWorkspaceTab.cs`:

```csharp
namespace BukitJalil.Core;

public enum ProjectWorkspaceTab
{
    Overview,
    Conversation,
    Structure,
    Content,
    PreviewValidation,
    BuildDeploy,
    History
}
```

Create `src/BukitJalil.SharedUi/Workspace/ProjectWorkspaceState.cs`:

```csharp
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter ProjectWorkspaceStateTests -v minimal`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.Core/ProjectWorkspaceTab.cs \
  src/BukitJalil.SharedUi/Workspace/ProjectWorkspaceState.cs \
  tests/BukitJalil.App.Tests/ProjectWorkspaceStateTests.cs
git commit -m "feat: add project workspace tab state"
```

### Task 3: Rebuild the App Shell Layout and Sidebar

**Files:**
- Create: `src/BukitJalil.App/Components/Layout/AppSidebar.razor`
- Create: `src/BukitJalil.App/Components/Layout/AppTopbar.razor`
- Modify: `src/BukitJalil.App/Components/Layout/MainLayout.razor`
- Modify: `src/BukitJalil.App/Components/Layout/NavMenu.razor`
- Modify: `src/BukitJalil.App/Components/Layout/MainLayout.razor.css`
- Modify: `src/BukitJalil.App/Components/Layout/NavMenu.razor.css`

- [ ] **Step 1: Use build as the failing gate**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after introducing the new layout files but before fixing imports and usage: build fails if the layout references missing components or stale classes.

- [ ] **Step 2: Write minimal implementation**

Create `src/BukitJalil.App/Components/Layout/AppSidebar.razor`:

```razor
@inject IAppShellCatalog AppShellCatalog

<aside class="app-sidebar">
    <div class="app-sidebar__brand">
        <div class="app-sidebar__logo">B</div>
        <div>
            <div class="app-sidebar__title">BukitJalil</div>
            <div class="app-sidebar__caption">中文工作台</div>
        </div>
    </div>

    <nav class="app-sidebar__nav">
        @foreach (var item in AppShellCatalog.Items)
        {
            <NavLink class="app-nav-link" href="@item.Route" Match="@(item.Route == "/projects" ? NavLinkMatch.Prefix : NavLinkMatch.All)">
                <span class="app-nav-link__title">@item.Title</span>
                <span class="app-nav-link__description">@item.Description</span>
            </NavLink>
        }
    </nav>
</aside>
```

Create `src/BukitJalil.App/Components/Layout/AppTopbar.razor`:

```razor
<header class="app-topbar">
    <div>
        <div class="app-topbar__title">BukitJalil</div>
        <div class="app-topbar__subtitle">AI 原生建站工作台</div>
    </div>

    <div class="app-topbar__actions">
        <button class="btn">最近项目</button>
        <button class="btn btn-primary">打开工作台</button>
    </div>
</header>
```

Replace `src/BukitJalil.App/Components/Layout/MainLayout.razor` with:

```razor
@inherits LayoutComponentBase

<div class="app-shell">
    <AppSidebar />

    <main class="app-shell__main">
        <AppTopbar />

        <article class="app-shell__content">
            @Body
        </article>
    </main>
</div>
```

Replace `src/BukitJalil.App/Components/Layout/NavMenu.razor` with a compatibility wrapper:

```razor
<AppSidebar />
```

Replace `src/BukitJalil.App/Components/Layout/MainLayout.razor.css` with:

```css
.app-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
    background: #eef2f6;
}

.app-shell__main {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.app-shell__content {
    flex: 1;
    min-width: 0;
    padding: 24px;
}

.app-topbar {
    height: 64px;
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.88);
    border-bottom: 1px solid #d8e0ea;
    backdrop-filter: blur(10px);
}

.app-topbar__title {
    font-size: 1rem;
    font-weight: 700;
    color: #17233d;
}

.app-topbar__subtitle {
    font-size: 0.8rem;
    color: #5f6e85;
}

.app-topbar__actions {
    display: flex;
    gap: 12px;
}
```

Replace `src/BukitJalil.App/Components/Layout/NavMenu.razor.css` with:

```css
.app-sidebar {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px 18px;
    background: linear-gradient(180deg, #0d1630 0%, #111d3d 100%);
    color: #f4f7fb;
    min-height: 100vh;
}

.app-sidebar__brand {
    display: flex;
    align-items: center;
    gap: 12px;
}

.app-sidebar__logo {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: #4a8f68;
    font-weight: 800;
}

.app-sidebar__title {
    font-size: 1rem;
    font-weight: 700;
}

.app-sidebar__caption {
    font-size: 0.8rem;
    color: rgba(244, 247, 251, 0.72);
}

.app-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.app-nav-link {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 14px;
    color: #dce6f7;
    text-decoration: none;
}

.app-nav-link.active {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
}

.app-nav-link__title {
    font-size: 0.95rem;
    font-weight: 700;
}

.app-nav-link__description {
    font-size: 0.78rem;
    color: rgba(220, 230, 247, 0.74);
}
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS.

- [ ] **Step 4: Check diagnostics**

Run diagnostics for:

- `src/BukitJalil.App/Components/Layout/MainLayout.razor`
- `src/BukitJalil.App/Components/Layout/NavMenu.razor`
- `src/BukitJalil.App/Components/Layout/MainLayout.razor.css`
- `src/BukitJalil.App/Components/Layout/NavMenu.razor.css`

Expected: empty diagnostics.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.App/Components/Layout/AppSidebar.razor \
  src/BukitJalil.App/Components/Layout/AppTopbar.razor \
  src/BukitJalil.App/Components/Layout/MainLayout.razor \
  src/BukitJalil.App/Components/Layout/NavMenu.razor \
  src/BukitJalil.App/Components/Layout/MainLayout.razor.css \
  src/BukitJalil.App/Components/Layout/NavMenu.razor.css
git commit -m "feat: rebuild desktop app shell"
```

### Task 4: Redesign 项目 Page in Chinese

**Files:**
- Modify: `src/BukitJalil.App/Components/Pages/Home.razor`
- Modify: `src/BukitJalil.App/wwwroot/app.css`

- [ ] **Step 1: Use build as the failing gate**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after replacing the old scaffold copy: build fails only if markup bindings are incomplete.

- [ ] **Step 2: Write minimal implementation**

Update the header and section copy in `src/BukitJalil.App/Components/Pages/Home.razor`:

```razor
<PageTitle>项目</PageTitle>

<section class="product-page">
    <header class="product-page__header">
        <p class="product-page__eyebrow">项目</p>
        <h1>项目与最近工作区</h1>
        <p class="product-page__lede">
            创建新的 Bukit 项目，或继续最近一次的 AI 建站工作流。
        </p>
    </header>

    <div class="product-grid product-grid--split">
        <section class="product-card">
            <div class="product-card__header">
                <div>
                    <p class="product-card__eyebrow">新项目</p>
                    <h2>创建本地项目</h2>
                </div>
            </div>

            <div class="form-stack">
                <label class="field-label" for="project-name">项目名称</label>
                <InputText id="project-name" class="field-input" @bind-Value="_projectName" />
                <button class="btn btn-primary" type="button" @onclick="CreateProject">创建项目</button>
            </div>
        </section>

        <section class="product-card">
            <div class="product-card__header">
                <div>
                    <p class="product-card__eyebrow">最近项目</p>
                    <h2>本地工作区</h2>
                </div>
                <span class="workspace-badge">@_projects.Count 个项目</span>
            </div>

            @if (_projects.Count == 0)
            {
                <p class="empty-state">还没有项目。先创建一个项目，进入新的中文工作台。</p>
            }
            else
            {
                <div class="record-list">
                    @foreach (var project in _projects)
                    {
                        <article class="record-card">
                            <div class="record-card__title">@project.Name</div>
                            <div class="record-card__meta">@project.WorkspacePath</div>
                            <div class="record-card__meta">创建于 @project.CreatedUtc.LocalDateTime.ToString("yyyy-MM-dd HH:mm")</div>
                        </article>
                    }
                </div>
            }
        </section>
    </div>
</section>
```

Append these classes to `src/BukitJalil.App/wwwroot/app.css`:

```css
.product-page {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.product-page__header {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.product-page__eyebrow {
    margin: 0;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #4a8f68;
    font-weight: 700;
}

.product-page__lede {
    margin: 0;
    color: #5e6c83;
    max-width: 60rem;
}

.product-grid {
    display: grid;
    gap: 20px;
}

.product-grid--split {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.product-card {
    background: #ffffff;
    border: 1px solid #dce4ef;
    border-radius: 24px;
    padding: 24px;
    box-shadow: 0 20px 40px rgba(15, 23, 42, 0.05);
}

.product-card__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
}

.product-card__eyebrow {
    margin: 0 0 6px;
    font-size: 0.75rem;
    text-transform: uppercase;
    color: #6f8098;
    letter-spacing: 0.08em;
}
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS.

- [ ] **Step 4: Check diagnostics**

Run diagnostics for:

- `src/BukitJalil.App/Components/Pages/Home.razor`
- `src/BukitJalil.App/wwwroot/app.css`

Expected: empty diagnostics.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.App/Components/Pages/Home.razor \
  src/BukitJalil.App/wwwroot/app.css
git commit -m "feat: redesign project page in Chinese"
```

### Task 5: Rebuild 工作台 as a Workflow Shell

**Files:**
- Create: `src/BukitJalil.App/Components/Layout/WorkspaceRightRail.razor`
- Create: `src/BukitJalil.App/Components/Layout/WorkspaceStatusBar.razor`
- Create: `src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor`
- Create: `src/BukitJalil.App/Components/Workspace/OverviewPanel.razor`
- Create: `src/BukitJalil.App/Components/Workspace/ConversationPanel.razor`
- Create: `src/BukitJalil.App/Components/Workspace/StructureEditorPanel.razor`
- Modify: `src/BukitJalil.App/Components/Pages/Counter.razor`

- [ ] **Step 1: Write the failing test**

Append this test to `tests/BukitJalil.App.Tests/ProjectWorkspaceStateTests.cs`:

```csharp
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
```

- [ ] **Step 2: Run test to verify it fails if tab mapping is incomplete**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter Workspace_tab_titles_cover_the_first_three_workflow_stages -v minimal`

Expected: PASS if Task 2 is complete; otherwise FAIL. This test acts as the guard before the UI shell consumes the workflow tabs.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.App/Components/Layout/WorkspaceRightRail.razor`:

```razor
@using BukitJalil.App.Workspace

<aside class="workspace-right-rail">
    <section class="workspace-right-rail__card">
        <p class="workspace-right-rail__label">AI 协同</p>
        <h3>@State.ActiveTabTitle</h3>
        <p>@State.StageSummary</p>
    </section>

    <section class="workspace-right-rail__card">
        <p class="workspace-right-rail__label">建议动作</p>
        <ul class="workspace-check-list">
            <li>先确认当前阶段的产物</li>
            <li>再推进下一步审批</li>
            <li>需要时回看最近事件</li>
        </ul>
    </section>
</aside>

@code {
    [Parameter, EditorRequired]
    public ProjectWorkspaceState State { get; set; } = default!;
}
```

Create `src/BukitJalil.App/Components/Layout/WorkspaceStatusBar.razor`:

```razor
@using BukitJalil.App.Workspace

<footer class="workspace-status-bar">
    <span>当前阶段：@State.ActiveTabTitle</span>
    <span>校验：待确认</span>
    <span>Bukit：已连接</span>
    <span>最近状态：@State.StageSummary</span>
</footer>

@code {
    [Parameter, EditorRequired]
    public ProjectWorkspaceState State { get; set; } = default!;
}
```

Create `src/BukitJalil.App/Components/Workspace/OverviewPanel.razor`:

```razor
<section class="workflow-panel">
    <div class="workflow-panel__header">
        <div>
            <p class="workflow-panel__eyebrow">总览</p>
            <h2>当前项目摘要</h2>
        </div>
    </div>

    <div class="workflow-list">
        <article class="workflow-item">
            <h3>当前阶段</h3>
            <p>从需求梳理开始，逐步推进结构、内容、预览和发布。</p>
        </article>
        <article class="workflow-item">
            <h3>下一步动作</h3>
            <p>先进入需求对话，确认目标站点、语言和关键页面。</p>
        </article>
    </div>
</section>
```

Create `src/BukitJalil.App/Components/Workspace/ConversationPanel.razor`:

```razor
@using BukitJalil.App.Workspace

<section class="workflow-panel">
    <div class="workflow-panel__header">
        <div>
            <p class="workflow-panel__eyebrow">需求对话</p>
            <h2>通过 AI 梳理网站需求</h2>
        </div>
    </div>

    <div class="workflow-list">
        <article class="workflow-item">
            <h3>需求摘要</h3>
            <p>把自然语言需求沉淀成页面、语言、风格和构建目标。</p>
        </article>
        <article class="workflow-item">
            <h3>会话入口</h3>
            <p>右侧 AI 协同栏持续可见，会话恢复规则继续沿用已有实现。</p>
        </article>
    </div>
</section>
```

Create `src/BukitJalil.App/Components/Workspace/StructureEditorPanel.razor`:

```razor
<section class="workflow-panel">
    <div class="workflow-panel__header">
        <div>
            <p class="workflow-panel__eyebrow">站点结构</p>
            <h2>页面树与区块结构</h2>
        </div>
        <div class="workspace-actions">
            <button class="btn">重生成结构</button>
            <button class="btn btn-primary">批准结构</button>
        </div>
    </div>

    <div class="workflow-columns">
        <aside class="workflow-sidebar">
            <div class="tree-item tree-item--active">首页</div>
            <div class="tree-item">关于我们</div>
            <div class="tree-item">服务内容</div>
            <div class="tree-item">联系我们</div>
        </aside>

        <div class="workflow-list">
            <article class="workflow-item">
                <h3>Hero</h3>
                <p>标题、副标题、主按钮和次按钮。</p>
            </article>
            <article class="workflow-item">
                <h3>核心优势</h3>
                <p>展示 3 个服务卖点区块。</p>
            </article>
        </div>
    </div>
</section>
```

Create `src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor`:

```razor
@using BukitJalil.App.Workspace
@using BukitJalil.Core

<div class="workspace-tab-strip" role="tablist">
    @foreach (var tab in Enum.GetValues<ProjectWorkspaceTab>())
    {
        <button class="workspace-tab @(State.ActiveTab == tab ? "workspace-tab--active" : string.Empty)"
                @onclick="() => State.SwitchTab(tab)">
            @GetTitle(tab)
        </button>
    }
</div>

@switch (State.ActiveTab)
{
    case ProjectWorkspaceTab.Overview:
        <OverviewPanel />
        break;
    case ProjectWorkspaceTab.Conversation:
        <ConversationPanel />
        break;
    case ProjectWorkspaceTab.Structure:
        <StructureEditorPanel />
        break;
    default:
        <OverviewPanel />
        break;
}

@code {
    [Parameter, EditorRequired]
    public ProjectWorkspaceState State { get; set; } = default!;

    private static string GetTitle(ProjectWorkspaceTab tab) =>
        tab switch
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
}
```

Replace `src/BukitJalil.App/Components/Pages/Counter.razor` with this workspace shell:

```razor
@page "/workspace"

<PageTitle>工作台</PageTitle>

<section class="product-page">
    <header class="workspace-shell__header">
        <div>
            <p class="product-page__eyebrow">工作台</p>
            <h1>@_workspace.ProjectName</h1>
            <p class="product-page__lede">@_workspace.StageSummary</p>
        </div>

        <div class="workspace-actions">
            <button class="btn">预览</button>
            <button class="btn">构建</button>
            <button class="btn btn-primary">发布</button>
        </div>
    </header>

    <div class="workspace-shell">
        <main class="workspace-shell__main">
            <WorkspaceTabHost State="_workspace" />
        </main>

        <WorkspaceRightRail State="_workspace" />
    </div>

    <WorkspaceStatusBar State="_workspace" />
</section>

@code {
    private readonly ProjectWorkspaceState _workspace = new();

    protected override void OnInitialized()
    {
        _workspace.Initialize("企业服务官网");
    }
}
```

- [ ] **Step 4: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS.

- [ ] **Step 5: Check diagnostics**

Run diagnostics for:

- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `src/BukitJalil.App/Components/Layout/WorkspaceRightRail.razor`
- `src/BukitJalil.App/Components/Layout/WorkspaceStatusBar.razor`
- `src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor`

Expected: empty diagnostics.

- [ ] **Step 6: Commit**

```bash
git add src/BukitJalil.App/Components/Layout/WorkspaceRightRail.razor \
  src/BukitJalil.App/Components/Layout/WorkspaceStatusBar.razor \
  src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor \
  src/BukitJalil.App/Components/Workspace/OverviewPanel.razor \
  src/BukitJalil.App/Components/Workspace/ConversationPanel.razor \
  src/BukitJalil.App/Components/Workspace/StructureEditorPanel.razor \
  src/BukitJalil.App/Components/Pages/Counter.razor
git commit -m "feat: add workflow-first workspace shell"
```

### Task 6: Add 内容草稿、预览校验、构建发布、变更历史 Panels

**Files:**
- Create: `src/BukitJalil.App/Components/Workspace/ContentDraftPanel.razor`
- Create: `src/BukitJalil.App/Components/Workspace/PreviewValidationPanel.razor`
- Create: `src/BukitJalil.App/Components/Workspace/BuildDeployPanel.razor`
- Create: `src/BukitJalil.App/Components/Workspace/HistoryTimelinePanel.razor`
- Modify: `src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor`
- Modify: `src/BukitJalil.App/wwwroot/app.css`

- [ ] **Step 1: Write the failing test**

Append this test to `tests/BukitJalil.App.Tests/ProjectWorkspaceStateTests.cs`:

```csharp
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
```

- [ ] **Step 2: Run test to verify it fails if titles are missing**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter Workspace_tab_titles_cover_all_workflow_stages -v minimal`

Expected: PASS if Task 2 is complete; otherwise FAIL. This keeps tab expansion honest.

- [ ] **Step 3: Write minimal implementation**

Create `src/BukitJalil.App/Components/Workspace/ContentDraftPanel.razor`:

```razor
<section class="workflow-panel">
    <div class="workflow-panel__header">
        <div>
            <p class="workflow-panel__eyebrow">内容草稿</p>
            <h2>按页面与区块编辑文案</h2>
        </div>
        <div class="workspace-actions">
            <button class="btn">切换语言</button>
            <button class="btn btn-primary">批准内容</button>
        </div>
    </div>

    <div class="workflow-columns">
        <aside class="workflow-sidebar">
            <div class="tree-item tree-item--active">首页</div>
            <div class="tree-item">关于我们</div>
        </aside>

        <div class="workflow-list">
            <article class="workflow-item">
                <h3>Hero 标题</h3>
                <p>企业级网站生成与部署工作台。</p>
            </article>
            <article class="workflow-item">
                <h3>服务介绍</h3>
                <p>三段式服务介绍，可继续由 AI 改写。</p>
            </article>
        </div>
    </div>
</section>
```

Create `src/BukitJalil.App/Components/Workspace/PreviewValidationPanel.razor`:

```razor
<section class="workflow-panel">
    <div class="workflow-panel__header">
        <div>
            <p class="workflow-panel__eyebrow">预览校验</p>
            <h2>预览页面并定位问题</h2>
        </div>
    </div>

    <div class="workflow-columns">
        <div class="preview-surface">预览区域占位</div>
        <div class="workflow-list">
            <article class="workflow-item">
                <h3>结构校验</h3>
                <p>页面结构通过，CTA 区块待确认。</p>
            </article>
            <article class="workflow-item">
                <h3>内容校验</h3>
                <p>中英双语内容已就绪，建议继续进行构建。</p>
            </article>
        </div>
    </div>
</section>
```

Create `src/BukitJalil.App/Components/Workspace/BuildDeployPanel.razor`:

```razor
<section class="workflow-panel">
    <div class="workflow-panel__header">
        <div>
            <p class="workflow-panel__eyebrow">构建发布</p>
            <h2>统一管理构建、日志与发布</h2>
        </div>
        <div class="workspace-actions">
            <button class="btn">本地构建</button>
            <button class="btn btn-primary">发布</button>
        </div>
    </div>

    <div class="workflow-columns">
        <div class="workflow-list">
            <article class="workflow-item">
                <h3>目标平台</h3>
                <p>在这里查看和选择部署目标。</p>
            </article>
            <article class="workflow-item">
                <h3>执行状态</h3>
                <p>构建、发布和失败重试入口都集中在这里。</p>
            </article>
        </div>

        <div class="log-surface">
            <div>14:28 Prompt rendered</div>
            <div>14:29 Schema validated</div>
            <div>14:31 Draft saved to LiteDB</div>
        </div>
    </div>
</section>
```

Create `src/BukitJalil.App/Components/Workspace/HistoryTimelinePanel.razor`:

```razor
<section class="workflow-panel">
    <div class="workflow-panel__header">
        <div>
            <p class="workflow-panel__eyebrow">变更历史</p>
            <h2>查看快照、构建记录与回退入口</h2>
        </div>
    </div>

    <div class="workflow-list">
        <article class="workflow-item">
            <h3>结构版本 V3</h3>
            <p>新增服务页和 CTA 区块。</p>
        </article>
        <article class="workflow-item">
            <h3>内容版本 V2</h3>
            <p>完成中英双语草稿并通过校验。</p>
        </article>
        <article class="workflow-item">
            <h3>构建记录</h3>
            <p>最近一次构建成功，可继续发布。</p>
        </article>
    </div>
</section>
```

Update `src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor` switch block:

```razor
    case ProjectWorkspaceTab.Content:
        <ContentDraftPanel />
        break;
    case ProjectWorkspaceTab.PreviewValidation:
        <PreviewValidationPanel />
        break;
    case ProjectWorkspaceTab.BuildDeploy:
        <BuildDeployPanel />
        break;
    case ProjectWorkspaceTab.History:
        <HistoryTimelinePanel />
        break;
```

Append these styles to `src/BukitJalil.App/wwwroot/app.css`:

```css
.workspace-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 20px;
}

.workspace-shell__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
}

.workspace-shell__main,
.workspace-right-rail,
.workflow-panel {
    min-width: 0;
}

.workspace-right-rail {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.workspace-right-rail__card,
.workflow-panel,
.preview-surface,
.log-surface {
    background: #ffffff;
    border: 1px solid #dce4ef;
    border-radius: 20px;
    padding: 20px;
}

.workspace-right-rail__label,
.workflow-panel__eyebrow {
    margin: 0 0 6px;
    font-size: 0.75rem;
    color: #6f8098;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.workspace-status-bar {
    display: flex;
    gap: 20px;
    padding: 14px 18px;
    border-radius: 16px;
    background: #ffffff;
    border: 1px solid #dce4ef;
    color: #52627a;
    font-size: 0.88rem;
}

.workspace-tab-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
}

.workspace-tab {
    border: 1px solid #d1dae7;
    background: #ffffff;
    color: #40506a;
    border-radius: 999px;
    padding: 10px 16px;
}

.workspace-tab--active {
    background: #162444;
    color: #ffffff;
    border-color: #162444;
}

.workflow-panel__header,
.workspace-actions,
.workflow-columns,
.workflow-list {
    display: flex;
    gap: 16px;
}

.workflow-panel__header {
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 18px;
}

.workspace-actions {
    flex-wrap: wrap;
}

.workflow-columns {
    align-items: stretch;
}

.workflow-sidebar {
    width: 220px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.workflow-list {
    flex: 1;
    flex-direction: column;
}

.workflow-item,
.tree-item {
    background: #f7f9fc;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 16px;
}

.tree-item--active {
    border-color: #4a8f68;
    background: #edf7ef;
}

.preview-surface {
    min-height: 340px;
    display: grid;
    place-items: center;
    color: #70819a;
}

.log-surface {
    min-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: monospace;
    font-size: 0.85rem;
    background: #0f172a;
    color: #dbe7ff;
}

@media (max-width: 1100px) {
    .product-grid--split,
    .workspace-shell,
    .workflow-columns {
        grid-template-columns: 1fr;
        display: grid;
    }

    .workflow-sidebar {
        width: auto;
    }
}
```

- [ ] **Step 4: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS.

- [ ] **Step 5: Run targeted app tests**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/BukitJalil.App/Components/Workspace/ContentDraftPanel.razor \
  src/BukitJalil.App/Components/Workspace/PreviewValidationPanel.razor \
  src/BukitJalil.App/Components/Workspace/BuildDeployPanel.razor \
  src/BukitJalil.App/Components/Workspace/HistoryTimelinePanel.razor \
  src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor \
  src/BukitJalil.App/wwwroot/app.css \
  tests/BukitJalil.App.Tests/ProjectWorkspaceStateTests.cs
git commit -m "feat: add workflow tab panels"
```

### Task 7: Add 发布中心、历史记录、设置与诊断 Product Pages

**Files:**
- Create: `src/BukitJalil.App/Components/Pages/PublishCenter.razor`
- Create: `src/BukitJalil.App/Components/Pages/History.razor`
- Modify: `src/BukitJalil.App/Components/Pages/Weather.razor`
- Modify: `src/BukitJalil.App/Components/Pages/Settings.razor`

- [ ] **Step 1: Use build as the failing gate**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected after adding new routes and page components: build fails only if there are route or binding issues.

- [ ] **Step 2: Write minimal implementation**

Create `src/BukitJalil.App/Components/Pages/PublishCenter.razor`:

```razor
@page "/publish-center"

<PageTitle>发布中心</PageTitle>

<section class="product-page">
    <header class="product-page__header">
        <p class="product-page__eyebrow">发布中心</p>
        <h1>统一查看构建与部署</h1>
        <p class="product-page__lede">在一个页面里集中查看目标平台、执行状态和发布结果。</p>
    </header>

    <div class="product-grid product-grid--split">
        <section class="product-card">
            <div class="product-card__header">
                <div>
                    <p class="product-card__eyebrow">目标平台</p>
                    <h2>发布目标</h2>
                </div>
            </div>
            <p class="empty-state">后续把现有平台管理内容整合到这里。</p>
        </section>

        <section class="product-card">
            <div class="product-card__header">
                <div>
                    <p class="product-card__eyebrow">执行记录</p>
                    <h2>最近发布</h2>
                </div>
            </div>
            <p class="empty-state">后续显示构建与部署流水线记录。</p>
        </section>
    </div>
</section>
```

Create `src/BukitJalil.App/Components/Pages/History.razor`:

```razor
@page "/history"

<PageTitle>历史记录</PageTitle>

<section class="product-page">
    <header class="product-page__header">
        <p class="product-page__eyebrow">历史记录</p>
        <h1>查看生成、构建与发布时间线</h1>
        <p class="product-page__lede">后续在这里聚合会话摘要、结构版本和发布快照。</p>
    </header>

    <section class="product-card">
        <div class="product-card__header">
            <div>
                <p class="product-card__eyebrow">时间线</p>
                <h2>项目迭代记录</h2>
            </div>
        </div>
        <p class="empty-state">暂时显示占位，后续接入真实历史数据。</p>
    </section>
</section>
```

Replace `src/BukitJalil.App/Components/Pages/Weather.razor` with:

```razor
@page "/platforms"

<PageTitle>部署目标</PageTitle>

<section class="product-page">
    <header class="product-page__header">
        <p class="product-page__eyebrow">部署目标</p>
        <h1>兼容页：旧入口将逐步并入发布中心</h1>
        <p class="product-page__lede">保留现有路由以避免断链，同时提示用户迁移到新的发布中心。</p>
    </header>

    <section class="product-card">
        <div class="product-card__header">
            <div>
                <p class="product-card__eyebrow">兼容入口</p>
                <h2>发布中心迁移中</h2>
            </div>
        </div>
        <p class="empty-state">此页面后续只保留兼容能力，主发布体验迁移到“发布中心”。</p>
    </section>
</section>
```

Replace the headings and labels in `src/BukitJalil.App/Components/Pages/Settings.razor`:

```razor
<PageTitle>设置与诊断</PageTitle>

<section class="product-page">
    <header class="product-page__header">
        <p class="product-page__eyebrow">设置与诊断</p>
        <h1>配置 Bukit、模型与运行环境</h1>
        <p class="product-page__lede">
            统一管理 Bukit 路径、文档目录、默认模型以及 OpenAI-compatible 连接信息。
        </p>
    </header>
```

Also change visible labels to:

```text
Bukit 可执行路径
文档目录
默认 Provider
Provider Base URL
Provider API Key
Provider Model
保存设置
```

- [ ] **Step 3: Run build to verify it passes**

Run: `dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst`

Expected: PASS.

- [ ] **Step 4: Check diagnostics**

Run diagnostics for:

- `src/BukitJalil.App/Components/Pages/PublishCenter.razor`
- `src/BukitJalil.App/Components/Pages/History.razor`
- `src/BukitJalil.App/Components/Pages/Weather.razor`
- `src/BukitJalil.App/Components/Pages/Settings.razor`

Expected: empty diagnostics.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.App/Components/Pages/PublishCenter.razor \
  src/BukitJalil.App/Components/Pages/History.razor \
  src/BukitJalil.App/Components/Pages/Weather.razor \
  src/BukitJalil.App/Components/Pages/Settings.razor
git commit -m "feat: add Chinese product pages"
```

### Task 8: Rehome Existing Conversation Persistence Into the New Workspace Shell

**Files:**
- Modify: `src/BukitJalil.App/Components/Workspace/ConversationPanel.razor`
- Modify: `src/BukitJalil.App/Components/Layout/WorkspaceRightRail.razor`
- Modify: `src/BukitJalil.App/Components/Pages/Counter.razor`
- Modify: `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs`
- Modify: `tests/BukitJalil.App.Tests/UnitTest1.cs`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs`:

```csharp
[Fact]
public void Existing_multi_conversation_recovery_rule_still_survives_shell_rebuild()
{
    var store = new InMemoryWorkspaceConversationStore();
    var first = WorkspaceConversation.Create("fake", DateTimeOffset.Parse("2026-05-05T12:00:00Z"));
    var second = WorkspaceConversation.Create("openai-compatible", DateTimeOffset.Parse("2026-05-05T13:00:00Z"));

    store.Save(first, makeCurrent: true);
    store.Save(second, makeCurrent: false);
    store.Delete(first.Id);

    var shell = new WorkspaceShellState(
        store,
        () => DateTimeOffset.Parse("2026-05-05T14:00:00Z"),
        "fake");

    shell.Initialize();

    Assert.Equal(second.Id, shell.CurrentConversation.Id);
}
```

- [ ] **Step 2: Run test to verify it passes before UI rewiring**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj --filter Existing_multi_conversation_recovery_rule_still_survives_shell_rebuild -v minimal`

Expected: PASS. This guards the existing behavior before the conversation UI is moved.

- [ ] **Step 3: Write minimal implementation**

Update `src/BukitJalil.App/Components/Pages/Counter.razor` to inject the existing store and provider services again:

```razor
@inject IProviderRegistry ProviderRegistry
@inject ISettingsStore SettingsStore
@inject IWorkspaceConversationStore ConversationStore
@inject ISystemClock Clock
```

Inside `@code`, add:

```razor
    private WorkspaceShellState _conversationShell = default!;
    private WorkspaceSession _session = default!;
```

In `OnInitialized()`:

```razor
        var providers = ProviderRegistry.List();
        var settings = SettingsStore.Get();
        var defaultProviderId = WorkspaceDefaultProviderSelector.Resolve(
            providers,
            settings.DefaultProvider);

        _conversationShell = new WorkspaceShellState(ConversationStore, () => Clock.UtcNow, defaultProviderId);
        _conversationShell.Initialize();

        _session = new WorkspaceSession(ProviderRegistry);
        _session.Bind(_conversationShell.CurrentConversation);
```

Update `src/BukitJalil.App/Components/Workspace/ConversationPanel.razor` to accept the active session data:

```razor
@using BukitJalil.App.Workspace
@using BukitJalil.Core

<section class="workflow-panel">
    <div class="workflow-panel__header">
        <div>
            <p class="workflow-panel__eyebrow">需求对话</p>
            <h2>通过 AI 梳理网站需求</h2>
        </div>
    </div>

    <div class="workflow-list">
        @if (Session.Messages.Count == 0)
        {
            <p class="empty-state">还没有消息。先用中文描述网站目标、语言与页面需求。</p>
        }
        else
        {
            @foreach (var message in Session.Messages)
            {
                <article class="chat-message @(message.Role == LlmRole.User ? "chat-message--user" : "chat-message--assistant")">
                    <div class="chat-message__role">@message.Role</div>
                    <div class="chat-message__content">@message.Content</div>
                </article>
            }
        }
    </div>
</section>

@code {
    [Parameter, EditorRequired]
    public WorkspaceSession Session { get; set; } = default!;
}
```

Update `src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor` to pass the session to `ConversationPanel`:

```razor
    [Parameter]
    public WorkspaceSession? Session { get; set; }
```

and:

```razor
    case ProjectWorkspaceTab.Conversation:
        <ConversationPanel Session="@(Session ?? throw new InvalidOperationException("Conversation session is required."))" />
        break;
```

Finally, update the usage in `Counter.razor`:

```razor
            <WorkspaceTabHost State="_workspace" Session="_session" />
```

- [ ] **Step 4: Run app tests to verify no regression**

Run: `dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/BukitJalil.App/Components/Workspace/ConversationPanel.razor \
  src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor \
  src/BukitJalil.App/Components/Pages/Counter.razor \
  tests/BukitJalil.App.Tests/WorkspaceShellStateTests.cs \
  tests/BukitJalil.App.Tests/UnitTest1.cs
git commit -m "feat: rehome conversation state into workflow workspace"
```

### Task 9: Final Verification and Manual Desktop Review

**Files:**
- Modify: none expected

- [ ] **Step 1: Run core verification**

Run:

```bash
dotnet test tests/BukitJalil.Core.Tests/BukitJalil.Core.Tests.csproj -v minimal
dotnet test tests/BukitJalil.App.Tests/BukitJalil.App.Tests.csproj -v minimal
dotnet test tests/BukitJalil.Infrastructure.Tests/BukitJalil.Infrastructure.Tests.csproj -v minimal
dotnet build src/BukitJalil.App/BukitJalil.App.csproj -f net10.0-maccatalyst
```

Expected: all pass.

- [ ] **Step 2: Check diagnostics**

Verify diagnostics for:

- `src/BukitJalil.Core/AppNavigation.cs`
- `src/BukitJalil.SharedUi/Workspace/ProjectWorkspaceState.cs`
- `src/BukitJalil.App/Components/Layout/MainLayout.razor`
- `src/BukitJalil.App/Components/Pages/Home.razor`
- `src/BukitJalil.App/Components/Pages/Counter.razor`
- `src/BukitJalil.App/Components/Workspace/WorkspaceTabHost.razor`
- `src/BukitJalil.App/Components/Pages/PublishCenter.razor`
- `src/BukitJalil.App/Components/Pages/Settings.razor`

Expected: empty diagnostics except unrelated pre-existing warnings outside this file set.

- [ ] **Step 3: Manual desktop sanity check**

Verify these flows manually in the MAUI app:

1. Open the app and confirm the left sidebar uses Chinese product navigation.
2. Open `项目` and confirm the page shows Chinese project creation and recent projects.
3. Open `工作台` and confirm the seven workflow tabs render correctly.
4. Switch among `总览 / 需求对话 / 站点结构 / 内容草稿 / 预览校验 / 构建发布 / 变更历史`.
5. Confirm the right rail stays visible while tabs change.
6. Confirm the bottom status bar remains visible and reflects the current tab.
7. Confirm the existing conversation restore rule still works when the current conversation id is missing.
8. Open `发布中心`, `历史记录`, and `设置与诊断` and confirm Chinese copy and skeleton layouts render.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: rebuild BukitJalil desktop workflow shell"
```

## Self-Review

### Spec coverage

- Chinese app navigation is covered in Tasks 1, 3, 4, and 7.
- Workflow-first workspace shell is covered in Tasks 2, 5, and 6.
- AIBuilding feel preservation with new shell boundaries is covered in Tasks 3, 5, and 6.
- Reusing existing multi-conversation persistence inside the new shell is covered in Task 8.
- Phased migration and desktop-only scope are reflected in Tasks 3 through 9.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to previous task” shortcuts remain.
- Every task includes concrete file paths, tests or build gates, code snippets, commands, and commit steps.

### Type consistency

- `AppShellItem`, `ProjectWorkspaceTab`, `ProjectWorkspaceState`, `WorkspaceSession`, and `WorkspaceShellState` use consistent names throughout the plan.
- The workspace tab names match the approved spec: `总览 / 需求对话 / 站点结构 / 内容草稿 / 预览校验 / 构建发布 / 变更历史`.
- The conversation recovery rule remains in `WorkspaceShellState`, not in the storage layer.
