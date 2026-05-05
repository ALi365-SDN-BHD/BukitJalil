# BukitJalil UI Design

## Overview

BukitJalil is a cross-platform AI website builder app. The UI should feel like a focused creation workspace, not a marketing website.

Design goals:

- help users move from idea to generated static site quickly;
- keep AI output visible, editable, and reviewable;
- make validation, build, and deployment status obvious;
- work well on desktop first, then adapt to mobile companion use;
- support future reuse in Blazor Web App through shared Razor components.

Primary UI stack:

```text
.NET MAUI Blazor Hybrid
Razor shared components
CSS isolation
LiteDB-backed local state
```

## Design Principles

### 1. Workspace First

The first screen should be the project dashboard, not a landing page.

Users should immediately see:

- existing projects;
- project status;
- create project action;
- recent generation/build activity;
- settings health warnings.

### 2. Dense but Calm

BukitJalil is an operational tool. Use compact layouts, predictable navigation, and restrained styling.

Avoid:

- oversized hero sections;
- decorative gradient backgrounds;
- marketing copy blocks;
- nested cards;
- visual decoration that does not support workflow.

### 3. Review Before Build

AI output should never feel magical or hidden. The UI must always show the workflow state:

```text
Prompt -> Generated JSON -> Schema validation -> Draft approval -> Bukit build -> Export/deploy
```

### 4. Desktop First, Mobile Companion

Desktop layouts should support three working regions. Mobile layouts should collapse into task-focused tabs.

Desktop:

```text
Sidebar | Main workspace | Inspector
```

Mobile:

```text
Top project switcher
Tabbed workspace
Bottom primary action
```

## Information Architecture

```text
Projects
|-- Project Workspace
|   |-- Conversation
|   |-- Structure
|   |-- Content
|   |-- Build
|   `-- Deploy
|-- Generation History
|-- Settings
`-- Help / Diagnostics
```

## Navigation Model

### Desktop Navigation

Use a persistent left sidebar.

Sidebar sections:

```text
Projects
Recent
Settings
Diagnostics
```

Project workspace tabs:

```text
Overview
Conversation
Structure
Content
Build
Deploy
History
```

### Mobile Navigation

Use:

- top app bar with project switcher;
- segmented tabs for workspace sections;
- bottom action bar for primary actions.

Mobile tabs:

```text
Chat
Schema
Content
Build
Settings
```

Mobile should not show desktop-only Bukit local build actions unless a remote build API is configured.

## Key Screens

## 1. Projects Dashboard

Purpose:

Give users a clean overview of all local website projects.

Desktop layout:

```text
Left sidebar
Main:
  Toolbar
  Project table/list
  Recent activity
Right inspector:
  App readiness
  Bukit path status
  AI provider status
```

Primary actions:

- create project;
- open project;
- duplicate project;
- delete project;
- open settings.

Project row fields:

```text
Name
Type
Languages
Status
Updated
Latest build
```

Empty state:

- show create project form directly;
- do not show a marketing hero.

## 2. Create Project

Purpose:

Capture enough information to start AI generation.

Fields:

```text
Project name
Website type
Primary language
Additional languages
Tone
Target audience
Brief
```

Website type options:

```text
Corporate
Service Business
Landing Page
SEO Site
Portfolio
Custom
```

Tone options:

```text
Professional
Friendly
Premium
Technical
Minimal
Bold
```

Behavior:

- create project as draft;
- navigate to Project Workspace;
- show the brief in the Conversation panel.

## 3. Project Workspace

Purpose:

Main creation surface for one website project.

Desktop layout:

```text
Header:
  Project name
  Status
  Language switcher
  Build status

Left:
  Conversation and actions

Center:
  Active editor or preview

Right:
  Inspector
  Validation
  Generation metadata
```

Workspace tabs:

```text
Overview
Conversation
Structure
Content
Build
Deploy
History
```

## 4. Conversation Panel

Purpose:

Let users describe and refine the website through natural language.

Elements:

```text
Message list
Prompt input
Generation mode selector
Run button
Regenerate button
Prompt preview
```

Generation modes:

```text
Site structure
Page content
Article
SEO metadata
Localization
Refinement
```

Message types:

- user instruction;
- AI generation summary;
- validation result;
- build event;
- deployment event.

Important behavior:

- the panel should show what was generated;
- raw AI JSON should be available in an advanced drawer;
- failed validation should appear as an actionable message.

## 5. Structure Editor

Purpose:

Review and adjust generated `SiteDefinition`.

Layout:

```text
Page tree
Section list
Section inspector
Raw JSON toggle
Validation panel
```

Page tree:

```text
Home
About
Services
Articles
Contact
```

Section row:

```text
Type
Title
Status
Validation marker
```

Actions:

- add page;
- remove page;
- reorder pages;
- add section;
- remove section;
- reorder sections;
- regenerate selected section;
- approve structure.

## 6. Content Draft Editor

Purpose:

Edit AI-generated copy before build.

Layout:

```text
Language selector
Page selector
Section selector
Editable fields
SEO metadata panel
Validation panel
```

Editable field examples:

```text
Hero headline
Hero subheadline
CTA label
Feature title
Feature description
FAQ question
FAQ answer
SEO title
SEO description
```

Actions:

- save draft;
- regenerate field;
- regenerate section;
- translate to another language;
- approve content.

## 7. Schema Validation Panel

Purpose:

Make AI output quality visible.

States:

```text
Not validated
Valid
Invalid
Warning
```

Show:

- schema name;
- schema version;
- validation timestamp;
- error path;
- error message;
- regenerate action.

Example:

```text
site-definition v1.0.0
Invalid at $.pages[0].sections[2].type
Expected: hero, features, cta, faq, article
```

## 8. Build Panel

Purpose:

Run Bukit build and inspect build results.

Desktop layout:

```text
Bukit path status
Input schema status
Build button
Build progress
Build logs
Artifact path
```

States:

```text
Ready
Missing Bukit path
Invalid schema
Building
Build succeeded
Build failed
```

Mobile behavior:

- show remote build status if configured;
- otherwise show that local Bukit build is desktop-only.

## 9. Deployment Panel

Purpose:

Export or deploy generated static output.

V1 actions:

- choose output folder;
- export artifacts;
- view deployment result;
- open output folder on desktop.

Future actions:

- deploy to GitHub Pages;
- deploy to Cloudflare Pages;
- deploy to self-hosted server.

Deployment states:

```text
Not deployed
Ready to export
Exporting
Exported
Deployment failed
```

## 10. Settings

Purpose:

Configure app, AI, Bukit, storage, and remote services.

Sections:

```text
AI Provider
Bukit
Workspace
Deployment
Remote API
Platform Capabilities
Diagnostics
```

Settings fields:

```text
AI provider
OpenAI model
OpenAI API key
Bukit path
Workspace path
Default export path
Remote API URL
```

Secrets:

- store API keys in platform secure storage;
- do not show full secret values after save.

## Component Library

Recommended shared components:

```text
AppShellLayout
SidebarNav
TopBar
ProjectStatusBadge
ProjectList
CreateProjectPanel
ConversationPanel
PromptInput
GenerationModeSelector
SiteSchemaPreview
PageTree
SectionList
SectionInspector
ContentDraftEditor
SeoMetadataEditor
SchemaValidationPanel
BuildPanel
BuildLogViewer
DeploymentPanel
SettingsForm
PlatformCapabilityBanner
RawJsonViewer
```

## Visual Design

### Layout

Use stable, compact dimensions.

Desktop:

```text
Sidebar: 240px
Inspector: 320px
Header: 56px
Toolbar: 44px
```

Mobile:

```text
Top bar: 56px
Bottom action bar: 64px
Touch target minimum: 44px
```

### Color System

Use a neutral operational palette with status colors.

Recommended tokens:

```text
background
surface
surface-muted
border
text
text-muted
accent
success
warning
danger
info
```

Avoid a one-hue interface. The app should not read as entirely purple, blue, beige, or dark slate.

### Typography

Use system fonts.

Recommended sizes:

```text
Page title: 22px
Section title: 16px
Body: 14px
Metadata: 12px
Button: 14px
Code/JSON: 13px monospace
```

Do not scale text with viewport width.

### Icons

Use an icon set such as Lucide where available.

Recommended icons:

```text
Projects: folder
Generate: sparkles
Schema: braces
Content: file-text
Build: hammer
Deploy: upload-cloud
Settings: settings
Errors: triangle-alert
Success: check-circle
```

Use tooltips for icon-only controls.

## State Design

### Project Status

```text
Draft
Generated
Content Ready
Validated
Built
Deployed
Failed
```

### Generation Status

```text
Idle
Rendering prompt
Generating
Validating
Saved as draft
Failed validation
Generation failed
```

### Build Status

```text
Not ready
Ready
Running
Succeeded
Failed
Cancelled
```

## Empty States

### No Projects

Show the create project panel directly.

Primary action:

```text
Create Project
```

### No Generated Schema

Show the conversation panel and generation mode set to `Site structure`.

Primary action:

```text
Generate Structure
```

### No Bukit Path

Show a settings shortcut.

Primary action:

```text
Set Bukit Path
```

## Error Handling

Error messages should be specific and actionable.

Examples:

```text
OpenAI API key is missing. Add it in Settings to use OpenAI generation.
Bukit path is not configured. Set a local Bukit path before building.
Schema validation failed. Review the highlighted JSON path or regenerate the section.
Local Bukit build is not available on mobile. Configure remote build to continue.
```

## Accessibility

Requirements:

- keyboard navigation on desktop;
- visible focus states;
- accessible labels for icon buttons;
- readable contrast;
- no text overlap in narrow layouts;
- stable button dimensions;
- error text not conveyed by color only.

## Initial MVP Screens

Build these first:

```text
Projects Dashboard
Create Project Panel
Project Workspace
Conversation Panel
Schema Preview
Content Draft Editor
Settings
```

Build next:

```text
Build Panel
Deployment Panel
Generation History
Diagnostics
```

## Recommended First Implementation Slice

1. Create `AppShellLayout`.
2. Create `ProjectsPage`.
3. Create `CreateProjectPanel`.
4. Create `ProjectWorkspacePage`.
5. Create `ConversationPanel`.
6. Create `SchemaValidationPanel`.
7. Add responsive CSS for desktop and mobile.
8. Wire UI to fake in-memory data before LiteDB.
9. Replace fake data with LiteDB repositories.
10. Add real generation/build actions after the UI flow is stable.
