# BukitJalil MAUI LiteDB MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build BukitJalil as a cross-platform .NET MAUI application that lets users create AI-generated static website projects, store drafts locally with LiteDB, generate structured site schema and content, and build/deploy through Bukit.

**Architecture:** Use .NET MAUI Blazor Hybrid as the primary cross-platform shell, with shared Razor components for desktop and mobile UI. Keep business logic in `BukitJalil.Core`, local persistence and integrations in `BukitJalil.Infrastructure`, and expose optional ASP.NET Core APIs later for remote build, sync, and SaaS mode.

**Tech Stack:** .NET 10, .NET MAUI Blazor Hybrid, Razor Class Library, LiteDB, Microsoft.Extensions.DependencyInjection, System.Text.Json, JSON Schema validation, OpenAI-compatible generation provider abstraction, local Bukit process adapter on desktop, optional ASP.NET Core Minimal API for remote sync/build.

---

## 1. Product Positioning

BukitJalil should be implemented as a **cross-platform AI website builder control app**.

The app is not only a web admin panel. It is a native desktop/mobile app that can:

- manage website projects locally;
- accept natural language website briefs;
- generate site structure and editable content;
- store AI drafts offline;
- preview schema/content before build;
- call Bukit to build static output;
- deploy locally or through future remote services.

## 2. Platform Strategy

### 2.1 Desktop First

Target desktop first:

- macOS via Mac Catalyst;
- Windows via WinUI 3.

Reason:

- Bukit build requires file-system access and process execution;
- local static artifacts are easier to inspect on desktop;
- desktop is the best environment for website creation workflows.

### 2.2 Mobile Companion

Support mobile as a companion experience:

- Android;
- iOS.

Mobile V1 should support:

- project viewing;
- prompt editing;
- AI content generation;
- schema/content review;
- remote build/deploy trigger later.

Mobile V1 should not run Bukit locally.

### 2.3 Future Web/SaaS Mode

Keep room for:

- web control panel;
- team workspace;
- cloud build workers;
- account/auth;
- billing;
- GitHub Pages and Cloudflare Pages deployment adapters.

Do not build SaaS in V1.

## 3. Recommended Solution Structure

```text
BukitJalil/
|-- src/
|   |-- BukitJalil.App/
|   |-- BukitJalil.SharedUi/
|   |-- BukitJalil.Core/
|   |-- BukitJalil.Infrastructure/
|   `-- BukitJalil.Api/
|-- tests/
|   |-- BukitJalil.Core.Tests/
|   |-- BukitJalil.Infrastructure.Tests/
|   `-- BukitJalil.App.Tests/
|-- prompts/
|-- schemas/
|-- docs/
`-- README.md
```

### 3.1 `BukitJalil.App`

.NET MAUI Blazor Hybrid host.

Responsibilities:

- app startup;
- native shell;
- platform-specific services;
- local app settings;
- secure storage;
- BlazorWebView hosting;
- file picker and folder picker integration;
- desktop/mobile capability detection.

### 3.2 `BukitJalil.SharedUi`

Shared Razor UI components.

Responsibilities:

- project dashboard;
- project workspace;
- conversation panel;
- site schema preview;
- content editor;
- build/deployment panels;
- reusable layout components.

This enables future reuse in a Blazor Web App if the project later adds a web control panel.

### 3.3 `BukitJalil.Core`

Pure domain layer.

Responsibilities:

- project models;
- site schema models;
- content draft models;
- generation contracts;
- build/deployment contracts;
- validation rules;
- workflow status types.

This project should not reference MAUI, LiteDB, OpenAI SDKs, or Bukit process code.

### 3.4 `BukitJalil.Infrastructure`

Implementation layer.

Responsibilities:

- LiteDB repositories;
- fake AI generation service;
- OpenAI generation provider;
- JSON schema validator;
- Bukit desktop adapter;
- local folder deployment service;
- remote build/deploy client later.

### 3.5 `BukitJalil.Api`

Optional future backend service.

Responsibilities:

- remote project sync;
- remote build queue;
- deployment worker API;
- SaaS mode API surface.

For V1 desktop app, this can remain minimal or unused.

## 4. Detailed Technology Stack

### 4.1 Runtime and Language

Use:

- .NET 10;
- C# 14;
- nullable reference types enabled;
- implicit usings enabled;
- file-scoped namespaces;
- records for immutable DTOs where appropriate.

Reason:

- aligns with the README direction;
- keeps one language across app, domain, integrations, and future API;
- works well with MAUI, Blazor Hybrid, and ASP.NET Core.

### 4.2 Cross-Platform UI

Use:

- .NET MAUI;
- MAUI Blazor Hybrid;
- Razor components;
- CSS isolation for component styling;
- minimal native XAML only for app shell and platform integration.

Reason:

- one UI codebase for macOS, Windows, Android, and iOS;
- Razor components are faster for a dashboard/chat/editor style UI than writing every screen in XAML;
- future Blazor Web App can reuse most UI components.

Main UI screens:

- Projects;
- Project Workspace;
- Conversation;
- Site Schema Preview;
- Content Draft Editor;
- Build;
- Deployment;
- Settings.

### 4.3 Local Database

Use:

- LiteDB;
- one local `.db` file per app installation;
- optional project export/import as JSON later.

Reason:

- document database fits AI-generated JSON-heavy data;
- no EF migrations needed for MVP;
- easy local/offline storage;
- suitable for MAUI desktop/mobile local persistence.

Recommended collections:

```text
projects
site_definitions
content_drafts
generation_runs
build_runs
deployment_runs
app_settings
```

Recommended document examples:

```csharp
public sealed class ProjectDocument
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public string Brief { get; set; } = "";
    public string[] Languages { get; set; } = [];
    public string Tone { get; set; } = "professional";
    public string Status { get; set; } = "draft";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

```csharp
public sealed class SiteDefinitionDocument
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public string Language { get; set; } = "";
    public string SchemaJson { get; set; } = "";
    public string Status { get; set; } = "draft";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
```

### 4.4 App State and MVVM

Use:

- dependency injection through `Microsoft.Extensions.DependencyInjection`;
- ViewModel classes for non-trivial screens;
- Razor components for rendering;
- async commands for generation/build/deploy actions.

Avoid:

- putting business logic directly inside Razor components;
- direct LiteDB usage from UI;
- direct OpenAI/Bukit calls from UI.

Recommended pattern:

```text
Razor Component -> ViewModel -> Core Service Interface -> Infrastructure Implementation
```

### 4.5 AI Generation Layer

Use:

- provider abstraction in Core;
- fake deterministic provider for development/tests;
- OpenAI-compatible provider for real generation;
- prompt files under `prompts/`;
- schema files under `schemas/`.

Interfaces:

```csharp
public interface IGenerationService
{
    Task<GenerationResult> GenerateSiteAsync(GenerateSiteRequest request, CancellationToken cancellationToken);
    Task<GenerationResult> GenerateContentAsync(GenerateContentRequest request, CancellationToken cancellationToken);
    Task<GenerationResult> GenerateArticleAsync(GenerateArticleRequest request, CancellationToken cancellationToken);
}
```

Provider options:

```text
Fake        deterministic local output
OpenAI      production AI generation
LocalLlm    future local model integration
```

Output format:

- structured JSON;
- validated before saving;
- stored as draft until user approves.

### 4.6 Schema Validation

Use:

- JSON Schema files under `schemas/`;
- validation service before storing or building;
- version field inside generated schema.

Recommended schemas:

```text
schemas/site-definition.schema.json
schemas/content-draft.schema.json
schemas/article-draft.schema.json
schemas/bukit-handoff.schema.json
```

Reason:

- AI output must not be trusted blindly;
- Bukit build should only receive deterministic, validated handoff data.

### 4.7 Bukit Integration

Use:

- configured local Bukit repository path or executable path;
- process adapter only on desktop platforms;
- remote adapter placeholder for mobile.

Desktop flow:

```text
SiteDefinition -> Bukit handoff JSON -> Bukit build command -> static artifacts
```

Mobile flow:

```text
SiteDefinition -> Remote build request -> Remote Bukit worker -> static artifacts
```

Core interface:

```csharp
public interface IBukitBuildService
{
    Task<BuildResult> BuildAsync(BuildRequest request, CancellationToken cancellationToken);
}
```

Build result should include:

- status;
- logs;
- artifact path;
- started time;
- completed time;
- error message.

### 4.8 Deployment Layer

V1 deployment:

- local folder deployment on desktop;
- export build artifact folder;
- optional open output folder action.

V2 deployment:

- GitHub Pages;
- Cloudflare Pages;
- self-hosted server;
- remote deploy API.

Core interface:

```csharp
public interface IDeploymentService
{
    Task<DeploymentResult> DeployAsync(DeploymentRequest request, CancellationToken cancellationToken);
}
```

### 4.9 Configuration and Secrets

Use:

- local app settings document in LiteDB for non-secret settings;
- platform secure storage for API keys;
- environment variables for development overrides;
- settings screen inside MAUI app.

Settings:

```text
AI provider
OpenAI model
Bukit path
Workspace path
Deployment output path
Remote API URL
```

Secrets:

- OpenAI API key;
- future GitHub token;
- future Cloudflare token.

Do not store secrets in source files or README examples.

### 4.10 Optional Backend API

Use later:

- ASP.NET Core Minimal APIs;
- background worker;
- PostgreSQL for SaaS;
- object storage for artifacts.

V1 API can be skeletal.

Future endpoints:

```text
POST /api/sync/projects
POST /api/projects/{id}/build
GET  /api/projects/{id}/builds/latest
POST /api/projects/{id}/deploy
```

### 4.11 Testing Stack

Use:

- xUnit;
- FluentAssertions or built-in assertions;
- temporary LiteDB files for repository tests;
- fake generation provider for deterministic tests;
- fake Bukit adapter for build workflow tests.

Test layers:

```text
Core.Tests             domain and workflow contracts
Infrastructure.Tests   LiteDB, schema validation, prompt rendering, adapter behavior
App.Tests              view model tests
```

Avoid requiring:

- live OpenAI key;
- real Bukit execution;
- real deployment credentials;
- real mobile device for unit tests.

### 4.12 Packaging and Distribution

V1:

- run from developer machine;
- support macOS and Windows first.

Later:

- macOS app signing/notarization;
- Windows MSIX or installer;
- Android APK/AAB;
- iOS TestFlight.

## 5. MVP Functional Scope

Build in V1:

- local project creation;
- local project list;
- project settings;
- prompt-based site generation;
- content draft generation;
- schema preview;
- content editing;
- LiteDB persistence;
- desktop Bukit build;
- local artifact output;
- settings screen;
- fake AI provider;
- OpenAI provider abstraction.

Defer:

- user accounts;
- team collaboration;
- billing;
- mobile local Bukit build;
- GitHub Pages deployment;
- Cloudflare Pages deployment;
- marketplace;
- remote worker scaling.

## 6. Implementation Phases

### Phase 1: Scaffold MAUI Solution

Create:

- `BukitJalil.App`;
- `BukitJalil.SharedUi`;
- `BukitJalil.Core`;
- `BukitJalil.Infrastructure`;
- test projects.

Verify:

- MAUI app launches;
- shared Razor UI renders;
- solution builds.

### Phase 2: Core Domain

Implement:

- `WebsiteProject`;
- `SiteDefinition`;
- `SitePage`;
- `SiteSection`;
- `ContentDraft`;
- `GenerationRun`;
- `BuildRun`;
- `DeploymentRun`.

Verify:

- domain tests pass;
- objects serialize to JSON.

### Phase 3: LiteDB Persistence

Implement:

- `ILocalProjectRepository`;
- `LiteDbProjectRepository`;
- `LiteDbConnectionFactory`;
- collection indexes.

Verify:

- create project;
- update project;
- save site definition;
- reopen database after app restart.

### Phase 4: MAUI App Shell

Implement:

- navigation;
- dashboard layout;
- settings page;
- dependency injection;
- platform capability service.

Verify:

- desktop and mobile layouts do not break;
- settings persist.

### Phase 5: Generation Workflow

Implement:

- fake generation provider;
- prompt templates;
- OpenAI provider skeleton;
- schema validation;
- generation history.

Verify:

- generate deterministic sample site;
- save output to LiteDB;
- invalid schema is rejected.

### Phase 6: Project Workspace UI

Implement:

- conversation panel;
- schema preview;
- content draft editor;
- approve/regenerate actions.

Verify:

- user can generate and edit a draft;
- app state survives navigation.

### Phase 7: Bukit Desktop Build

Implement:

- Bukit path settings;
- handoff JSON writer;
- desktop process runner;
- build log capture;
- artifact path tracking.

Verify:

- fake build works in tests;
- real build can be run manually when Bukit is configured.

### Phase 8: Deployment MVP

Implement:

- local folder deployment;
- artifact export;
- deployment history.

Verify:

- output folder receives generated static files;
- deployment record is saved.

### Phase 9: Documentation

Update:

- `README.md`;
- `docs/development.md`;
- `docs/platform-support.md`;
- `docs/litedb-storage.md`;
- `docs/bukit-integration.md`.

Verify:

- a new developer can understand setup and platform limits.

## 7. Key Design Decisions

### Use LiteDB Instead of SQLite/EF Core

Reason:

- AI outputs are document-shaped;
- schema drafts evolve quickly;
- MVP does not need relational migrations;
- local/offline-first storage is the priority.

### Use MAUI Blazor Hybrid Instead of Pure XAML

Reason:

- dashboard/chat/editor UI is faster to build in Razor;
- future Web UI reuse is possible;
- less duplicated UI logic.

### Keep API Optional in V1

Reason:

- desktop local mode can ship sooner;
- mobile remote build can be added after the core app is stable;
- avoids premature SaaS infrastructure.

### Build Locally Only on Desktop

Reason:

- process execution and local toolchain access are practical on desktop;
- mobile sandboxing makes local Bukit builds unsuitable for V1.

## 8. Acceptance Criteria

- The MAUI app launches on at least one desktop platform.
- Projects are stored in LiteDB and survive app restarts.
- A user can create a project with name, brief, type, language, and tone.
- A user can generate a site schema using the fake provider.
- A user can generate and edit content drafts.
- Generated output is validated before build.
- Desktop app can hand off validated schema to a configured Bukit path.
- Build logs are visible in the app.
- Local deployment/export creates an artifact record.
- Tests pass without OpenAI credentials or a real Bukit installation.
