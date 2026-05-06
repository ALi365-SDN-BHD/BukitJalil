# BukitJalil AIBuilding UI Rebuild Design

## Goal

This spec defines a full desktop UI redesign for `BukitJalil`.

The redesign intentionally discards the current scaffolded UI and replaces it with a new Chinese-language product shell that:

- keeps the visual density and operating feel of `AIBuilding`;
- reorganizes the product around `BukitJalil`'s newer information architecture;
- upgrades the experience from a tool-panel collection into a structured workflow desktop product.

The primary goal is not pixel-for-pixel historical recreation. The goal is to preserve the strengths of `AIBuilding` while rebuilding the product around clearer workflow stages, reviewable outputs, and stronger state boundaries.

## Confirmed Direction

The design direction is fixed as:

- desktop-first only for the first version;
- full Chinese interface;
- discard the currently implemented app shell and page presentation;
- preserve `AIBuilding`'s visual temperament and working habits;
- reorganize page structure to fit `BukitJalil` rather than cloning the old page map;
- prioritize workflow orchestration and structured generation over chat-first interaction.

This means the product should still feel like a serious desktop AI site-building workstation, but the primary navigation and task model should guide the user through a clear production flow.

## Product Strategy

### Product Positioning

`BukitJalil` should become a Chinese desktop control console for AI-native static website production.

The product should help a user move from vague intent to deliverable output through these stages:

1. define the site requirement;
2. produce and review site structure;
3. produce and review content drafts;
4. preview and validate the result;
5. build and deploy through Bukit;
6. review history and continue iteration.

### Experience Principles

The redesign should follow these principles:

- `Desktop Tooling Feel`: dense, efficient, professional, no marketing-site chrome.
- `Workflow First`: users should always know the current stage and the next action.
- `AI As Copilot`: AI is always visible and active, but it is not the only primary surface.
- `Review Before Release`: structure, content, validation, build, and deployment each have visible review state.
- `Chinese Product Language`: all navigation, labels, empty states, and status messages are in Chinese.

## Information Architecture

### App-Level Navigation

The desktop app should use these top-level sections:

- `项目`
- `工作台`
- `发布中心`
- `历史记录`
- `设置与诊断`

These names replace the current technical-scaffold naming such as `Workspace`, `Platforms`, and `Settings`.

### Section Responsibilities

#### 项目

Responsibilities:

- create project;
- list projects;
- search projects;
- show recent projects;
- enter a selected project's workspace.

#### 工作台

Responsibilities:

- host the active project's full production workflow;
- provide the main project-level operating environment;
- maintain a stable shell while switching between workflow tabs.

#### 发布中心

Responsibilities:

- aggregate build and deployment views across projects;
- show deployment targets, statuses, and recent releases;
- act as the control plane for publishing tasks.

#### 历史记录

Responsibilities:

- aggregate historical generation events, snapshots, build records, and deployment records;
- support replay, diff inspection, and resume points.

#### 设置与诊断

Responsibilities:

- configure Bukit path, provider settings, workspace folders, and platform targets;
- surface system diagnostics and environment health;
- make failure causes and readiness status visible.

## Project Workspace Map

Inside `工作台`, the project-level tabs should be:

- `总览`
- `需求对话`
- `站点结构`
- `内容草稿`
- `预览校验`
- `构建发布`
- `变更历史`

These tabs represent workflow stages rather than arbitrary feature buckets.

### Why This Structure

The old `AIBuilding` habit of `Preview / Code / Files / Build / Log + AI chat` remains valuable as supporting context, but it should no longer define the whole product information architecture.

In the new design:

- `Preview / Code / Files / Build / Log` become task-specific panels or supporting views;
- workflow stages become the primary navigation model;
- chat becomes a permanent collaboration layer, not the only main interface.

## Workspace Shell

### Shared Layout

Every project workspace tab should live inside one stable desktop shell:

- top project bar;
- central task area;
- right collaboration rail;
- bottom status bar.

### Top Project Bar

Should display:

- project name;
- current stage;
- language context;
- save or sync status;
- primary actions like `预览`, `构建`, `发布`.

### Central Task Area

This is the main task surface and changes by tab:

- structure editor for `站点结构`;
- content editor for `内容草稿`;
- preview and issue list for `预览校验`;
- build and deployment controls for `构建发布`.

### Right Collaboration Rail

This rail should remain visible across the workspace.

It should contain:

- AI conversation;
- current task summary;
- suggested next actions;
- recent events;
- approval reminders or blocking alerts.

This preserves the `AIBuilding` working habit of a continuously accessible AI assistant without making the chat panel responsible for all product interaction.

### Bottom Status Bar

Should display lightweight operational state:

- validation state;
- Bukit environment state;
- current build or deploy state;
- last error summary;
- background task status.

## Tab Definitions

### 总览

Purpose:

- orient the user immediately after entering a project.

Panels:

- project summary;
- current workflow stage;
- pending actions;
- recent generation output;
- quick entry cards.

Primary actions:

- `继续需求梳理`
- `进入结构编辑`
- `查看预览`
- `开始构建`

### 需求对话

Purpose:

- capture and refine natural-language intent without mixing it with structure editing or content editing.

Panels:

- conversation transcript;
- requirement summary card;
- constraints and assumptions;
- AI suggested actions;
- target site brief.

Outputs:

- structure proposal;
- content direction;
- build/deploy constraints.

Transition:

- after requirement confirmation, move into `站点结构`.

### 站点结构

Purpose:

- turn conversational intent into explicit, reviewable site structure.

Panels:

- page tree;
- section list;
- structure preview;
- schema or JSON view;
- validation results;
- approval controls.

Primary actions:

- `新增页面`
- `调整区块顺序`
- `重生成结构`
- `批准结构`

Transition:

- approved structure unlocks `内容草稿`.

### 内容草稿

Purpose:

- manage per-page and per-section copy rather than discussing all content in chat.

Panels:

- page content list;
- section-level content editor;
- language switcher;
- AI rewrite suggestions;
- draft approval state.

Primary actions:

- `生成草稿`
- `改写选中区块`
- `切换语言`
- `批准内容`

Transition:

- approved content flows into `预览校验`.

### 预览校验

Purpose:

- show whether the generated site is ready to move toward delivery.

Panels:

- live preview;
- issue list;
- issue-to-content or issue-to-structure jump links;
- structure validation summary;
- content validation summary;
- release risk warnings.

Primary actions:

- `定位问题`
- `退回结构`
- `退回内容`
- `进入构建`

### 构建发布

Purpose:

- unify build and deploy into one controlled release stage.

Panels:

- build configuration;
- deployment targets;
- execution controls;
- logs;
- build result;
- deployment result.

Primary actions:

- `本地构建`
- `选择目标平台`
- `发布`
- `查看失败日志`

This stage absorbs much of the old `Build / Log / Deploy` experience, but places it under a workflow stage instead of exposing it as separate top-level navigation.

### 变更历史

Purpose:

- make iteration visible and reversible.

Panels:

- conversation summaries;
- structure versions;
- content versions;
- build records;
- deployment timeline;
- rollback entry points.

Primary actions:

- `查看差异`
- `恢复版本`
- `重新进入某阶段`

This is one of the strongest upgrade opportunities versus the older product shape because it makes the AI-driven workflow inspectable over time.

## Product Flow

The main project flow should be:

1. `总览`
2. `需求对话`
3. `站点结构`
4. `内容草稿`
5. `预览校验`
6. `构建发布`
7. `变更历史`

This flow should feel explicit in the UI.

Users should always be able to answer:

- where am I now?
- what output exists from the previous stage?
- what must be approved before I continue?
- what is the next action?

## What To Preserve From AIBuilding

The redesign should preserve these experience qualities:

- desktop-first workstation density;
- visible AI copilot on the right side;
- strong toolbar and project-context framing;
- engineering-aware surfaces such as preview, files, code, build, and logs;
- natural language as the entry point for creation and iteration.

## What To Discard

The redesign should explicitly discard these implementation and UX patterns:

- one giant workspace component carrying every concern;
- chat as the only true interface;
- top-level navigation made of technical utility surfaces;
- mixed English and technical naming in product navigation;
- unstructured panel accumulation with weak stage boundaries.

## Implementation Architecture

The implementation should be split into three layers:

- product shell layer;
- workflow state layer;
- domain service layer.

### Product Shell Layer

Recommended components:

- `AppShell`
- `ProjectWorkspaceShell`
- `WorkspaceTabHost`

Responsibilities:

- layout;
- navigation;
- page composition;
- active tab switching;
- high-level shell presentation.

Non-responsibilities:

- persistence details;
- schema generation;
- preview execution;
- build execution;
- deploy execution;
- file operations.

### Workflow State Layer

Recommended state objects:

- `ProjectWorkspaceState`
- `ConversationState`
- `StructureState`
- `ContentState`
- `PreviewValidationState`
- `BuildDeployState`
- `HistoryState`

Design rule:

- one state object owns one workflow domain;
- shared project-level state stays in `ProjectWorkspaceState`;
- each tab component consumes actions and read models through explicit boundaries.

### Domain Service Layer

Recommended services:

- `ProjectService`
- `ConversationService`
- `StructureService`
- `ContentService`
- `PreviewService`
- `BuildService`
- `DeploymentService`
- `HistoryService`

These services own real product logic and integrations. UI components and state objects should orchestrate them rather than replace them.

## Component Decomposition

Recommended reusable components:

- `AppSidebar`
- `AppTopbar`
- `WorkspaceRightRail`
- `WorkspaceStatusBar`
- `OverviewPanel`
- `ConversationPanel`
- `StructureEditorPanel`
- `ContentDraftPanel`
- `PreviewValidationPanel`
- `BuildDeployPanel`
- `HistoryTimelinePanel`

This decomposition keeps the new UI visually rich while avoiding the old monolith pattern.

## Data Flow

The primary flow should be:

- `需求对话` produces `结构草案`;
- `结构草案` approval produces a content drafting task;
- `内容草稿` approval unlocks preview and validation;
- `预览校验` approval unlocks build and deployment;
- `构建发布` results and stage snapshots feed `变更历史`.

The important rule is:

- chat is not the final source of truth;
- every workflow stage has its own formal output;
- approvals act as the transition gates between stages.

## Chinese Product Language

All first-class UI text should be Chinese, including:

- navigation labels;
- tab names;
- primary and secondary actions;
- status badges;
- validation messages;
- empty states;
- helper text;
- build and deploy summaries.

English may remain only where technically necessary, such as:

- external provider ids;
- schema field names in code-oriented views;
- external platform names;
- raw log lines that originate from tools.

## Migration Approach

This redesign should not be implemented as one giant replacement patch.

Recommended phases:

### Phase 1: Shell and Navigation Reset

- replace the current app shell;
- introduce Chinese navigation;
- introduce the new workspace shell and tab host;
- stop treating current pages as the long-term information architecture.

### Phase 2: Workflow Tabs and State Boundaries

- establish `总览 / 需求对话 / 站点结构 / 内容草稿 / 预览校验 / 构建发布 / 变更历史`;
- split state by workflow domain;
- connect the existing conversation persistence into the new shell.

### Phase 3: Engineering Surfaces Rehomed

- move preview, code, file, build, and log surfaces into their correct workflow locations;
- remove old page-level assumptions.

### Phase 4: History and Reviewability

- add approvals;
- add snapshots and rollback points;
- make iteration history visible.

## Testing Strategy

Use four layers of verification:

### State Tests

Test:

- tab switching;
- stage switching;
- review gates;
- restore flows;
- cross-tab coordination.

### Service Tests

Test:

- structure generation integration;
- content persistence;
- preview and validation aggregation;
- build log capture;
- deployment recording.

### Component Tests

Test:

- navigation rendering;
- Chinese labels;
- empty states;
- button enable/disable rules;
- right-rail and status-bar behavior.

### End-to-End Verification

Test the main journey:

1. create or open project;
2. refine requirements in AI conversation;
3. generate and approve structure;
4. generate and approve content;
5. validate preview;
6. build and deploy;
7. inspect history and resume.

## Out of Scope For This Design Slice

This spec does not define:

- mobile companion UX beyond explicitly excluding it from the first version;
- cloud sync;
- multiplayer collaboration;
- advanced theming system design;
- backend service protocols in detail;
- final pixel-perfect visual tokens.

Those can be defined in later specs once the product map and workflow shell are stable.

## Acceptance Criteria

This redesign direction is accepted when:

- the app-level navigation is fully redefined in Chinese;
- the project workspace is organized around workflow stages rather than technical utility panels;
- the right-side AI copilot pattern is preserved;
- `AIBuilding` feel is preserved without preserving its monolithic implementation;
- the design clearly separates shell, state, and service responsibilities;
- the redesign can be implemented in phases without blocking future evolution.

## Summary

This design turns `BukitJalil` into a Chinese desktop AI site-production console that inherits the strengths of `AIBuilding` but reorganizes the product around a clearer, more reviewable, and more extensible workflow:

- keep the workstation feel;
- move from chat-first to workflow-first;
- preserve AI as a persistent copilot;
- formalize stage outputs and approvals;
- rebuild the UI on better architectural boundaries.
