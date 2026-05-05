# BukitJalil Features and Modules

## Overview

BukitJalil is a cross-platform AI website builder control app based on .NET MAUI, LiteDB, AI generation, and Bukit static site building.

The product can be summarized as:

```text
.NET MAUI app -> LiteDB local data -> AI generation -> Bukit static build -> deployment/export
```

The application should support desktop-first website creation while keeping mobile companion features and future SaaS mode possible.

## Feature List

### 1. Project Management

- Create website projects.
- View local project list.
- Edit project name, type, brief, language, and tone.
- Delete projects.
- Track project status: draft, generated, built, deployed.
- Save project data locally.
- Reopen historical projects offline.

### 2. AI Conversational Website Creation

- Accept natural language website requirements.
- Generate website structure from a project brief.
- Support regeneration.
- Save generation history.
- View prompts and generated results.
- Use a fake provider for local testing.
- Use an OpenAI-compatible provider for real generation.

### 3. Website Schema Generation

- Generate structured site JSON.
- Generate page lists.
- Generate page sections.
- Support section types such as Hero, Features, CTA, FAQ, and Article.
- Validate generated schema.
- Save schema drafts.
- Approve schema before build.

### 4. Content Generation

- Generate homepage copy.
- Generate service descriptions.
- Generate company profiles.
- Generate FAQ content.
- Generate SEO titles and descriptions.
- Generate multilingual content.
- Generate articles from topics.
- Edit AI-generated content.
- Save content drafts.
- Approve content drafts.

### 5. Local Data Storage

- Use LiteDB for local persistence.
- Store projects.
- Store site schemas.
- Store content drafts.
- Store AI generation records.
- Store build records.
- Store deployment records.
- Store app settings.
- Restore data after app restart.

### 6. Bukit Build Integration

- Configure local Bukit path.
- Convert `SiteDefinition` into Bukit handoff JSON.
- Execute local Bukit builds on desktop platforms.
- Capture build logs.
- Record build status.
- Save static artifact path.
- Display build errors when the build fails.

### 7. Deployment and Export

- Select local output directory.
- Export build artifacts to a selected folder.
- Record deployment time.
- Record deployment status.
- Display deployment result path.
- Leave room for GitHub Pages deployment.
- Leave room for Cloudflare Pages deployment.
- Leave room for self-hosted server deployment.

### 8. Settings Center

- Set OpenAI API key.
- Select AI provider.
- Set OpenAI model.
- Set local Bukit path.
- Set workspace path.
- Set deployment output path.
- Set future remote API URL.
- Check current platform capabilities.
- Show which features are available on desktop and mobile.

### 9. Cross-Platform Capabilities

- Support macOS desktop.
- Support Windows desktop.
- Support Android mobile.
- Support iOS mobile.
- Support local Bukit builds on desktop.
- Support project review and content editing on mobile.
- Support future remote build and deployment triggering on mobile.

### 10. Future Remote Services

- Project sync API.
- Remote build API.
- Remote deployment API.
- User accounts.
- Team collaboration.
- SaaS mode.
- Multi-device sync.

## Module Breakdown

### 1. `BukitJalil.App`

The .NET MAUI host application.

Responsibilities:

- App startup.
- MAUI shell.
- `BlazorWebView` hosting.
- Platform capability detection.
- Local file and folder picking.
- Secure storage.
- App lifecycle handling.
- Dependency injection entry point.

Main contents:

```text
MauiProgram.cs
App.xaml
MainPage.xaml
Platform services
Secure storage
App settings bootstrap
```

### 2. `BukitJalil.SharedUi`

The shared UI layer based on Razor components.

Responsibilities:

- Project list page.
- Project workspace page.
- Conversation panel.
- Schema preview.
- Content editor.
- Build panel.
- Deployment panel.
- Settings page.

Main components:

```text
ProjectsPage
ProjectWorkspacePage
ConversationPanel
SiteSchemaPreview
ContentDraftEditor
BuildPanel
DeploymentPanel
SettingsPage
```

### 3. `BukitJalil.Core`

The core domain layer.

This project should not depend on MAUI, LiteDB, OpenAI SDKs, or Bukit process execution.

Responsibilities:

- Define business models.
- Define workflow contracts.
- Define validation rules.
- Define project, generation, build, and deployment status types.

Main models:

```text
WebsiteProject
SiteDefinition
SitePage
SiteSection
ContentDraft
GenerationRun
BuildRun
DeploymentRun
AppSetting
```

Main interfaces:

```text
IProjectRepository
IGenerationService
ISchemaValidator
IBukitBuildService
IDeploymentService
IAppSettingsService
IPlatformCapabilityService
```

### 4. `BukitJalil.Infrastructure`

The infrastructure implementation layer.

Responsibilities:

- LiteDB persistence.
- Fake AI generation.
- OpenAI-compatible generation.
- JSON schema validation.
- Desktop Bukit build execution.
- Mobile remote build placeholder.
- Local folder deployment.
- Remote deployment placeholder.

Main services:

```text
LiteDbProjectRepository
LiteDbConnectionFactory
FakeGenerationService
OpenAiGenerationService
JsonSchemaValidator
DesktopBukitBuildService
MobileRemoteBukitBuildService
LocalFolderDeploymentService
RemoteDeploymentService
```

LiteDB collections:

```text
projects
site_definitions
content_drafts
generation_runs
build_runs
deployment_runs
app_settings
```

### 5. `BukitJalil.Api`

The optional future backend service.

For V1, this can stay minimal or unused. It exists to support future remote build, sync, and SaaS features.

Future responsibilities:

- Project sync.
- Remote build.
- Remote deployment.
- Authentication.
- Team workspace.
- Billing.
- Cloud deployment.

Example endpoints:

```text
POST /api/sync/projects
POST /api/projects/{id}/build
GET  /api/projects/{id}/builds/latest
POST /api/projects/{id}/deploy
```

### 6. Prompts

The AI prompt template module.

Files:

```text
prompts/site-structure.md
prompts/page-content.md
prompts/article.md
```

Responsibilities:

- Generate website structures.
- Generate page content.
- Generate articles.
- Keep AI outputs consistent.

### 7. Schemas

The JSON Schema validation module.

Files:

```text
schemas/site-definition.schema.json
schemas/content-draft.schema.json
schemas/article-draft.schema.json
schemas/bukit-handoff.schema.json
```

Responsibilities:

- Validate AI output.
- Validate content drafts.
- Validate Bukit handoff data.
- Prevent invalid data from entering the build process.

### 8. Tests

The test suite.

Projects:

```text
BukitJalil.Core.Tests
BukitJalil.Infrastructure.Tests
BukitJalil.App.Tests
```

Test focus:

- Domain models.
- LiteDB repositories.
- Fake AI provider.
- Prompt rendering.
- Schema validation.
- Bukit handoff.
- Build workflow.
- ViewModel behavior.

## MVP Priority

### Priority 1

Build these first:

```text
BukitJalil.App
BukitJalil.SharedUi
BukitJalil.Core
BukitJalil.Infrastructure
LiteDB persistence
FakeGenerationService
```

### Priority 2

Build after the local app flow works:

```text
OpenAiGenerationService
Schema validation
Bukit build adapter
Local deployment
Settings page
```

### Priority 3

Build later:

```text
BukitJalil.Api
Remote build
Cloud deployment
Project sync
SaaS features
```

## System Summary

```text
MAUI cross-platform app handles the user experience.
LiteDB stores local project data.
AI providers generate structure and content.
Bukit builds static websites.
Future APIs handle sync, remote builds, and SaaS mode.
```
