# Prompts and Schemas Implementation Guide

## Overview

BukitJalil uses prompts to ask AI providers for structured output, and schemas to validate that output before it is stored, edited, built, or deployed.

The rule is simple:

```text
Prompt -> AI JSON output -> JSON Schema validation -> LiteDB draft -> Bukit handoff
```

AI output must never go directly into the build process. It must first pass schema validation.

## 1. Prompts Module

### 1.1 Purpose

The Prompts module defines reusable prompt templates for AI generation workflows.

It should support:

- site structure generation;
- page content generation;
- article generation;
- SEO metadata generation;
- translation/localization;
- regeneration and refinement;
- consistent structured JSON output.

### 1.2 Directory Structure

```text
prompts/
|-- README.md
|-- site-structure.md
|-- page-content.md
|-- article.md
|-- seo-metadata.md
|-- localization.md
`-- refinement.md
```

### 1.3 Prompt Responsibilities

#### `site-structure.md`

Generates the website structure.

Input:

- project name;
- project type;
- website brief;
- target audience;
- language;
- tone;
- required pages;
- preferred style.

Output:

- `SiteDefinition` JSON.

#### `page-content.md`

Generates editable page content.

Input:

- project context;
- page type;
- site schema;
- language;
- tone;
- SEO keywords.

Output:

- `ContentDraft` JSON.

#### `article.md`

Generates SEO articles from a topic or keyword.

Input:

- topic;
- keyword;
- audience;
- language;
- tone;
- desired outline depth.

Output:

- `ArticleDraft` JSON.

#### `seo-metadata.md`

Generates SEO metadata for pages or articles.

Input:

- page title;
- page purpose;
- content summary;
- language;
- keywords.

Output:

- `SeoMetadata` JSON.

#### `localization.md`

Translates and localizes existing content.

Input:

- source language;
- target language;
- original content;
- brand glossary;
- tone.

Output:

- localized `ContentDraft` JSON.

#### `refinement.md`

Improves existing AI output based on user feedback.

Input:

- current draft;
- user instruction;
- project context;
- target schema name.

Output:

- updated JSON matching the same schema.

### 1.4 Prompt Template Format

Each prompt file should follow the same structure:

```text
# Prompt Name

## Role

[Describe the AI role.]

## Task

[Describe the generation task.]

## Inputs

- ProjectName: {{project_name}}
- ProjectType: {{project_type}}
- Brief: {{brief}}
- Language: {{language}}
- Tone: {{tone}}

## Output Rules

- Return JSON only.
- Do not include markdown fences.
- Do not include explanations.
- Match schema: {{schema_name}}
- Use schema version: {{schema_version}}

## JSON Shape

[Short example of required shape.]
```

### 1.5 Prompt Rendering

Prompt files should not be string-built manually inside services.

Recommended service:

```csharp
public interface IPromptTemplateRenderer
{
    Task<string> RenderAsync(
        string templateName,
        IReadOnlyDictionary<string, string> variables,
        CancellationToken cancellationToken);
}
```

Recommended implementation:

```text
FilePromptTemplateRenderer
```

Responsibilities:

- load prompt file from `prompts/`;
- replace known placeholders;
- fail if required variables are missing;
- preserve prompt formatting;
- support tests with in-memory templates.

### 1.6 Prompt Versioning

Prompt changes can alter AI output, so version them.

Recommended fields:

```text
prompt_name
prompt_version
schema_name
schema_version
model
rendered_prompt_hash
```

Store these fields in `generation_runs`.

Example:

```json
{
  "prompt_name": "site-structure",
  "prompt_version": "1.0.0",
  "schema_name": "site-definition",
  "schema_version": "1.0.0",
  "model": "gpt-4.1",
  "rendered_prompt_hash": "sha256:..."
}
```

### 1.7 Prompt Runtime Flow

```text
User brief
  -> GenerateSiteRequest
  -> PromptTemplateRenderer
  -> IGenerationService
  -> AI provider
  -> Raw JSON
  -> ISchemaValidator
  -> GenerationResult
  -> LiteDB
```

### 1.8 Prompt Testing

Test cases:

- renders a prompt with all variables;
- fails when a required variable is missing;
- preserves output rules;
- includes schema name and version;
- does not require live AI credentials.

Recommended test file:

```text
tests/BukitJalil.Infrastructure.Tests/Prompts/PromptTemplateRendererTests.cs
```

## 2. Schemas Module

### 2.1 Purpose

The Schemas module defines machine-checkable contracts for all AI-generated and Bukit-bound JSON.

It should validate:

- AI site structure output;
- AI content draft output;
- article draft output;
- SEO metadata output;
- Bukit handoff JSON;
- imported project files later.

### 2.2 Directory Structure

```text
schemas/
|-- README.md
|-- site-definition.schema.json
|-- content-draft.schema.json
|-- article-draft.schema.json
|-- seo-metadata.schema.json
`-- bukit-handoff.schema.json
```

### 2.3 Schema Responsibilities

#### `site-definition.schema.json`

Validates generated website structure.

Required concepts:

- schema version;
- project id;
- language;
- pages;
- page sections;
- SEO metadata;
- generation metadata.

#### `content-draft.schema.json`

Validates page content.

Required concepts:

- project id;
- page id;
- language;
- content blocks;
- editable fields;
- draft status.

#### `article-draft.schema.json`

Validates generated article content.

Required concepts:

- topic;
- language;
- title;
- summary;
- outline;
- body sections;
- SEO metadata;
- draft status.

#### `seo-metadata.schema.json`

Validates SEO metadata.

Required concepts:

- title;
- description;
- keywords;
- canonical path;
- language.

#### `bukit-handoff.schema.json`

Validates the final data passed to Bukit.

Required concepts:

- site definition;
- pages;
- content;
- assets;
- output settings;
- build metadata.

### 2.4 Site Definition Schema Example

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://bukitjalil.local/schemas/site-definition.schema.json",
  "title": "SiteDefinition",
  "type": "object",
  "required": ["schemaVersion", "projectId", "language", "pages"],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "const": "1.0.0"
    },
    "projectId": {
      "type": "string",
      "format": "uuid"
    },
    "language": {
      "type": "string",
      "minLength": 2
    },
    "pages": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "slug", "title", "sections"],
        "properties": {
          "id": {
            "type": "string"
          },
          "slug": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "sections": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["type", "data"],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": ["hero", "features", "cta", "faq", "article"]
                },
                "data": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    }
  },
  "additionalProperties": false
}
```

### 2.5 Schema Validation Service

Core interface:

```csharp
public interface ISchemaValidator
{
    Task<SchemaValidationResult> ValidateAsync(
        string schemaName,
        string json,
        CancellationToken cancellationToken);
}
```

Result model:

```csharp
public sealed record SchemaValidationResult(
    bool IsValid,
    IReadOnlyList<SchemaValidationError> Errors);

public sealed record SchemaValidationError(
    string Path,
    string Message);
```

Recommended implementation:

```text
JsonSchemaValidator
```

Responsibilities:

- load schema from `schemas/`;
- validate raw AI JSON;
- return readable error paths;
- block invalid output from being saved as approved;
- block invalid output from being passed to Bukit.

### 2.6 Schema Versioning

Each generated document should include:

```json
{
  "schemaVersion": "1.0.0"
}
```

Versioning rules:

- patch version: non-breaking descriptions or optional fields;
- minor version: new optional fields;
- major version: breaking structural changes.

LiteDB documents should store:

```text
schema_name
schema_version
raw_json
validation_status
validation_errors
```

### 2.7 Validation Flow

```text
Raw AI JSON
  -> Parse as JSON
  -> Validate against schema
  -> If invalid: save as failed generation run
  -> If valid: save as draft
  -> User reviews draft
  -> Approve draft
  -> Convert to Bukit handoff
  -> Validate Bukit handoff schema
  -> Build
```

### 2.8 Error Handling

Validation failures should be visible to the user in a developer-friendly way.

Show:

- schema name;
- JSON path;
- error message;
- generation run id;
- retry/regenerate action.

Example UI message:

```text
Site schema validation failed at $.pages[0].sections[1].type:
Expected one of hero, features, cta, faq, article.
```

### 2.9 Schema Testing

Test cases:

- valid site definition passes;
- missing required fields fail;
- invalid section type fails;
- invalid language fails;
- valid content draft passes;
- invalid Bukit handoff is blocked.

Recommended test files:

```text
tests/BukitJalil.Infrastructure.Tests/Schemas/SchemaValidatorTests.cs
tests/BukitJalil.Infrastructure.Tests/Schemas/SiteDefinitionSchemaTests.cs
tests/BukitJalil.Infrastructure.Tests/Schemas/BukitHandoffSchemaTests.cs
```

## 3. Prompt and Schema Integration

### 3.1 Generation Service Integration

The generation service should combine prompt rendering and schema validation.

Recommended flow:

```csharp
public sealed class GenerationWorkflow
{
    private readonly IPromptTemplateRenderer _promptRenderer;
    private readonly IGenerationService _generationService;
    private readonly ISchemaValidator _schemaValidator;
    private readonly IGenerationRunRepository _generationRuns;

    public async Task<GenerationResult> GenerateSiteAsync(
        GenerateSiteRequest request,
        CancellationToken cancellationToken)
    {
        var prompt = await _promptRenderer.RenderAsync(
            "site-structure",
            request.ToPromptVariables(),
            cancellationToken);

        var result = await _generationService.GenerateSiteAsync(
            request with { RenderedPrompt = prompt },
            cancellationToken);

        var validation = await _schemaValidator.ValidateAsync(
            "site-definition",
            result.RawJson,
            cancellationToken);

        await _generationRuns.SaveAsync(result, validation, cancellationToken);

        return result with { Validation = validation };
    }
}
```

### 3.2 LiteDB Integration

Recommended collections:

```text
generation_runs
site_definitions
content_drafts
```

`generation_runs` stores raw AI results, even failed validation results.

`site_definitions` stores valid drafts.

`content_drafts` stores valid editable content.

### 3.3 Bukit Integration

Bukit should receive only validated handoff JSON.

Flow:

```text
SiteDefinition + ContentDraft
  -> BukitHandoffMapper
  -> bukit-handoff JSON
  -> Validate against bukit-handoff.schema.json
  -> DesktopBukitBuildService
```

### 3.4 UI Integration

The UI should show:

- rendered generation status;
- validation status;
- schema preview;
- validation errors;
- approve/regenerate buttons;
- raw JSON view for advanced users.

Recommended components:

```text
GenerationStatusBadge
SchemaValidationPanel
RawJsonViewer
PromptPreviewDialog
```

## 4. Implementation Order

1. Create `prompts/` and `schemas/` folders.
2. Add initial prompt files.
3. Add initial schema files.
4. Implement `IPromptTemplateRenderer`.
5. Implement `ISchemaValidator`.
6. Add fake generation provider.
7. Add generation workflow service.
8. Save generation runs into LiteDB.
9. Add UI validation display.
10. Add Bukit handoff validation before build.

## 5. MVP Acceptance Criteria

- Prompt templates are stored as files, not hard-coded strings.
- Prompt rendering fails when required variables are missing.
- AI output is validated before becoming a draft.
- Invalid output is saved as a failed generation run with validation errors.
- Valid site schema is saved as a draft.
- Bukit handoff JSON is validated before build.
- Tests run without live AI credentials.
