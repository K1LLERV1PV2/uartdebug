# AVR project workspace

UARTDebug targets desktop and laptop browsers. Its three existing panes represent Project Specification, C Code, and Code Description, in that order. The first visit has no selected project or automatic main.c. New project creates an empty draft.

## Canonical project structure

The private Sergey-Bulanov/UartDebug2 repository defines project rules and technical knowledge. Its tracked files remain unchanged on the server. A target project has its own folder under Target_Projects; versions use Name Ver.X.Y when needed to distinguish projects.

- Name.md: editable project specification.
- Name.c: C source.
- Name.yaml: internal resources and dependencies.
- Name (description).md: description of the actual code, when present.

Internal YAML and AI files do not appear in the user file list or code editor. They remain available to AI, import and account synchronization. Logical project filenames are separate from storage keys so independent projects can use the same names. Legacy source content is preserved during migration; old question answers become inline Markdown remarks once.

## Explicit stages

POST /api/avr/ai/canvas uses uartdebug-project/v2 and an explicit operation:

| Operation | Control | Allowed output |
| --- | --- | --- |
| analyze | Review specification | Specification Markdown and inline remarks |
| generate | Generate code | C source and hidden resource YAML |
| describe | Describe code | Markdown describing the supplied current C |

Empty review input is valid. The agent asks for missing identity, version and requirements instead of inventing a target. Generation requires unambiguous choices and preserves the specification. Description preserves specification, C and resources.

The model receives AGENTS.md, AGENTS_Add_On.md, Project_Description.md and Base_project_rules.md completely, once, followed by applicable knowledge entry points. Bounded local retrieval follows repository pointers. Notes, temporary artifacts, protected Problems.md files and unrelated target projects are excluded. Each request pins one immutable materials release.

## Validation and storage

The server validates structured output before application. Resource YAML contains ordered microcontroller, hardware_resources and software_dependencies mappings with full include directives; duplicate keys, aliases and custom tags are rejected. C checks cover project identity, required regions, xc.h as the first directive, main/loop structure and exactly preserved user region contents. Generated C is compiled with bounded repair attempts. Compilation does not establish hardware correctness.

The browser rejects responses if the account, selected project, specification revision, target or relevant project contents changed during the request. Partial stage output is merged into the current project. Account snapshots retain optimistic revision and identity checks.

Curated examples are derived from User_Examples. Their functional C tokens are retained; structural markers and project metadata are adapters outside the mirror. Repository target samples require sign-in. Raw knowledge and rules are not public file routes.

See [materials deployment](AI_MATERIALS_DEPLOYMENT.md) and [AI service setup](../backend/AI-SETUP.md).
