🏔 BukitJalil

AI-Native Website Builder Control Panel
Conversational UI for Static Site Generation

1. Introduction

BukitJalil is an AI-driven user interface and project management platform designed to simplify and automate the process of building static websites.

It enables users to create, manage, and deploy websites through natural language interaction, eliminating the need for traditional development workflows.

BukitJalil works as the upper-layer control system of Bukit, forming a complete pipeline:

Idea → AI Generation → Static Build → Deployment

2. Vision

BukitJalil aims to redefine website creation by transforming it from a technical process into a conversational experience.

Traditional Model
Manual design
Frontend development
Content writing
Deployment setup
BukitJalil Model
Describe intent
AI generates structure
AI generates content
System builds and deploys
3. System Architecture
BukitJalil (UI + AI Layer)
        ↓
AI Agents + Workflow Engine
        ↓
Bukit (Static Site Engine)
        ↓
Generated HTML
        ↓
Deployment (CDN / Server)
Layer Responsibilities
Layer	Responsibility
BukitJalil	UI, AI interaction, project orchestration
AI Layer	Content, template, and workflow generation
Bukit	Static site compilation
Deployment	Hosting and delivery
4. Core Features
4.1 Project Management

BukitJalil organizes websites into structured projects.

Capabilities:

Multi-project management
Multi-language support (EN / ZH / MS)
Draft & published states
Project-level AI context memory

Example:

{
  "project_id": "proj_001",
  "name": "ESD Service Website",
  "type": "service",
  "languages": ["en", "zh"],
  "template": "corporate",
  "status": "draft"
}
4.2 AI Template Generation

Instead of selecting predefined templates, BukitJalil generates UI structures dynamically.

Input:

Create a corporate website for ESD services, clean and professional style

Output:

{
  "layout": "landing",
  "sections": [
    { "type": "hero", "title": "Professional ESD Services" },
    { "type": "features" },
    { "type": "cta" }
  ]
}

Key Concept:

Templates are generated, not selected
UI is defined using structured schema
Rendering is deterministic
4.3 AI Content Generation

Automatically generates structured content:

Company profiles
Service descriptions
Marketing copy
SEO articles
Multi-language content

Features:

Prompt templates
JSON-structured output
Editable and regeneratable
4.4 Conversational Interface (AI Agents)

All operations are driven by natural language.

Supported actions:

Create project
Modify layout
Generate content
Publish site

Example Flow:

User: Build an ESD service website in English and Chinese

System:
✔ Project created
✔ Template generated
✔ Content generated
✔ Ready for deployment
4.5 Deployment System

BukitJalil integrates with the Bukit engine to generate static output and deploy it.

Supported Targets:

GitHub Pages
Cloudflare Pages
Self-hosted servers

Pipeline:

AI → Schema → Build → Deploy
5. AI Agent Architecture

BukitJalil uses a modular agent system:

Agent	Responsibility
Project Agent	Project creation and configuration
Template Agent	UI schema generation
Content Agent	Content generation
Deploy Agent	Deployment orchestration
6. Technical Stack
Backend
.NET 8
ASP.NET Core (Minimal API)
Frontend
Blazor or React
Component-based UI system
AI Layer
OpenAI API or local LLM
Prompt templates
JSON Schema validation
7. Project Structure
bukit-jalil/
├── src/
│   ├── Api/
│   ├── Core/
│   ├── Agents/
│   ├── Templates/
│   └── Renderer/
│
├── web/
├── prompts/
├── schemas/
└── docs/
8. Integration with Bukit

BukitJalil does not directly render HTML.

Instead, it:

Generates structured schema
Passes it to Bukit
Bukit builds static output
9. Use Cases
Corporate websites
Government or compliance services (e.g. ESD)
Landing pages
SEO content generation
Multi-language business sites
AI-powered content systems
10. Roadmap
V1 (Current)
Project management
Basic UI generation
Content generation
V2
Conversational project creation
Advanced template system
Multi-language workflows
V3
SaaS multi-user system
API key management
Subscription billing
V4
Automated SEO site networks
Continuous content generation
Template marketplace
11. Limitations
AI-generated content requires human review
UI generation is schema-based (not arbitrary HTML)
Deployment targets should be limited in early stages
12. Contribution

We welcome contributions in:

UI template design
Prompt engineering
Agent architecture
Plugin systems
13. License

MIT License

14. Summary

BukitJalil transforms website creation from a development process into a conversational workflow, powered by AI and structured generation.
