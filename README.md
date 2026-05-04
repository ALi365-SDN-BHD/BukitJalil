# 🏔️ BukitJalil

AI-native website builder control panel with a conversational UI for static site generation.

## 📌 Overview

BukitJalil is an AI-driven user interface and project management platform designed to simplify and automate the process of building static websites.

It enables users to create, manage, and deploy websites through natural language interaction, reducing the need for traditional development workflows.

BukitJalil works as the upper-layer control system of Bukit, forming a complete creation pipeline:

```text
Idea -> AI Generation -> Static Build -> Deployment
```

## 🎯 Vision

BukitJalil aims to redefine website creation by transforming it from a technical process into a conversational experience.

### 🧱 Traditional Model

- 🎨 Design: manual design and iteration
- 💻 Development: frontend implementation
- 📝 Content: copywriting and editing
- 🚀 Operations: deployment setup

### ✨ BukitJalil Model

- 💬 Intent: describe the website goal
- 🧩 Structure: AI generates the site schema
- 📝 Content: AI prepares editable content
- 🚀 Delivery: system builds and deploys

## 🏗️ System Architecture

```text
BukitJalil (UI + AI Layer)
  -> AI Agents + Workflow Engine
  -> Bukit (Static Site Engine)
  -> Generated HTML
  -> Deployment (CDN / Server)
```

### 🧭 Layer Responsibilities

| Layer | Responsibility |
| --- | --- |
| Control Panel | UI, AI interaction, project orchestration |
| AI Layer | Content, template, and workflow generation |
| Build Engine | Static site compilation through Bukit |
| Deployment | Hosting and delivery |

## ⚙️ Core Features

### 📁 Project Management

BukitJalil organizes websites into structured projects.

Capabilities:

- 📁 Projects: multi-project management
- 🌐 Languages: multi-language support
- 🟢 Publishing: draft and published states
- 🧠 Context: project-level AI memory

Example:

```json
{
  "project_id": "proj_001",
  "name": "Corporate Website",
  "type": "service",
  "languages": ["en", "zh"],
  "template": "corporate",
  "status": "draft"
}
```

### 🧩 AI Template Generation

Instead of selecting predefined templates, BukitJalil generates UI structures dynamically.

Input:

```text
Create a corporate website for professional services, clean and modern style.
```

Output:

```json
{
  "layout": "landing",
  "sections": [
    { "type": "hero", "title": "Professional Services" },
    { "type": "features" },
    { "type": "cta" }
  ]
}
```

Key concepts:

- ✨ Generation: templates are generated, not selected
- 🧾 Schema: UI is defined using structured data
- 🎯 Rendering: output remains deterministic

### 📝 AI Content Generation

BukitJalil automatically generates structured, editable, and reusable website content from a project brief, page goal, target audience, brand tone, and language settings.

Content types:

- 🏢 Company profiles
- 🛠️ Service descriptions
- 📣 Marketing copy
- 🔎 SEO articles
- 🌐 Multi-language content
- 🧭 Navigation labels
- 🎯 Hero headlines and CTA copy
- ❓ FAQ sections
- 🧾 Metadata, titles, and descriptions
- ✍️ Topic-based articles from user-provided themes

Features:

- 💬 Prompts: reusable prompt templates
- 🧾 Data: JSON-structured output
- ✏️ Editing: editable and regeneratable content
- 🌐 Localization: generate, translate, and refine content per language
- 🔎 SEO: produce search-friendly titles, descriptions, headings, and article outlines
- 🧠 Context: keep project memory for consistent terminology and tone
- ✅ Review: keep generated content in draft state until approved
- ✍️ Article generation: create full articles from a user-entered topic, keyword, or content brief

Content workflow:

```text
Project Brief -> Content Plan -> Structured Draft -> Human Review -> Publishable Content
```

Topic-based article workflow:

```text
User Topic -> Article Outline -> Draft Article -> SEO Review -> Publishable Article
```

Example output:

```json
{
  "page": "home",
  "language": "en",
  "tone": "professional",
  "seo": {
    "title": "Professional Services for Modern Businesses",
    "description": "Build trust with clear service pages, strong messaging, and fast static delivery."
  },
  "sections": [
    {
      "type": "hero",
      "headline": "Build a Better Business Website with AI",
      "subheadline": "Generate structure, content, and deployment-ready pages from a single conversation.",
      "cta": "Start a Project"
    },
    {
      "type": "features",
      "items": [
        "AI-generated page structure",
        "Editable business content",
        "Multi-language publishing"
      ]
    }
  ]
}
```

Topic-based article example:

```json
{
  "topic": "How AI helps small businesses build websites faster",
  "language": "en",
  "article": {
    "title": "How AI Helps Small Businesses Build Websites Faster",
    "summary": "AI can reduce planning, writing, layout, and publishing time for small business websites.",
    "outline": [
      "Why small businesses need faster website creation",
      "How AI turns a topic into page structure",
      "How AI generates editable website content",
      "How static site deployment keeps delivery fast"
    ],
    "status": "draft"
  }
}
```

### 💬 Conversational Interface

All operations are driven by natural language.

Supported actions:

- ➕ Create: create a project
- 🛠️ Modify: update layout and sections
- ✨ Generate: produce structured content
- 🚀 Publish: build and deploy the site

Example flow:

```text
User: Build a professional services website in English and Chinese.

System:
- Project created
- Template generated
- Content generated
- Ready for deployment
```

### 🚀 Deployment System

BukitJalil integrates with the Bukit engine to generate static output and deploy it.

Supported targets:

- 🐙 GitHub: GitHub Pages
- ☁️ Cloudflare: Cloudflare Pages
- 🖥️ Server: self-hosted environments

Pipeline:

```text
AI -> Schema -> Build -> Deploy
```

## 🤖 AI Agent Architecture

BukitJalil uses a modular agent system:

| Agent | Responsibility |
| --- | --- |
| Project Agent | Project creation and configuration |
| Template Agent | UI schema generation |
| Content Agent | Content generation |
| Deploy Agent | Deployment orchestration |

## 🧰 Technical Stack

### 🖥️ Backend

- ⚙️ .NET 10 LTS
- 🌐 ASP.NET Core 10
- 💻 C# 14
- ⚡ Minimal APIs
- 📦 Native AOT-ready services where appropriate
- 🧭 .NET Aspire for cloud-native orchestration when needed

### 🎨 Frontend

- 🧱 Blazor Web App or React
- 🧩 Component-based UI system
- 🌐 Progressive enhancement for generated static output

### 🧠 AI Layer

- 🤖 OpenAI API or local LLM
- 💬 Prompt templates
- ✅ JSON Schema validation
- 🧾 Structured outputs for deterministic workflows

## 🗂️ Project Structure

```text
bukit-jalil/
|-- src/
|   |-- Api/
|   |-- Core/
|   |-- Agents/
|   |-- Templates/
|   `-- Renderer/
|-- web/
|-- prompts/
|-- schemas/
`-- docs/
```

## 🔗 Integration with Bukit

BukitJalil does not directly render HTML. Instead, it:

- 🧾 Schema: generates structured site definitions
- 🔗 Handoff: passes schema to Bukit
- 🏗️ Build: lets Bukit create static output

## 💼 Use Cases

- 🏢 Corporate websites
- 🛠️ Service business websites
- 🎯 Landing pages
- 🔎 SEO content generation
- 🌐 Multi-language business sites
- 🤖 AI-powered content systems

## 🛣️ Roadmap

### 🚧 V1: Current

- 📁 Projects: project management
- 🧩 UI: basic UI generation
- 📝 Content: content generation

### 🧪 V2

- 💬 Conversation: conversational project creation
- 🧩 Templates: advanced template system
- 🌐 Localization: multi-language workflows

### 🏢 V3

- 🏢 SaaS: multi-user system
- 🔐 Security: API key management
- 💳 Billing: subscription billing

### 🌍 V4

- 🔎 SEO: automated site networks
- 📝 Content: continuous content generation
- 🧩 Ecosystem: template marketplace

## ⚠️ Limitations

- 👀 Review: AI-generated content requires human review
- 🧾 Rendering: UI generation is schema-based, not arbitrary HTML
- 🚀 Deployment: targets should be limited in early stages

## 🤝 Contribution

We welcome contributions in:

- 🎨 Design: UI template design
- 🤖 AI: prompt engineering
- 🧠 Agents: agent architecture
- 🔌 Extensions: plugin systems

## 📄 License

MIT License

## ✅ Summary

BukitJalil transforms website creation from a development process into a conversational workflow, powered by AI and structured generation.
