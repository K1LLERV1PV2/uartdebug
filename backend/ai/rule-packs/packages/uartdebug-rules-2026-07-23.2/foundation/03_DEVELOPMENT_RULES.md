# 03_DEVELOPMENT_RULES.md

## File Version

This file revision is:

```text
Revision 1.2.3
```

## Project Version

```text
Version 1.2
```

## Purpose

This file defines the general development rules for **UartDebug** mini-projects.

It should contain only rules that directly affect mini-project development as a whole.

A mini-project should be simple enough for learning and precise enough for reuse.

Detailed rules for human-facing help files are defined in:

```text
04_HELP_FILE_RULES.md
```

Detailed rules for AI-facing description files are defined in:

```text
05_AI_FILE_RULES.md
```

## Main Project Folders

The basic folder structure for mini-project development uses these main working folders:

```text
MiniProjects/
ReferenceMaterials/
```

`MiniProjects/` contains active mini-projects created and developed in the current UartDebug structure.

`ReferenceMaterials/` contains legacy, draft, reference, and additional materials that may be analyzed, adapted, or converted into new mini-projects or other active project files.

Files in `ReferenceMaterials/` are not active project rules and are not finished mini-projects unless the project owner explicitly adopts or converts them.

Materials in `ReferenceMaterials/` must not be modified automatically.

## Reference Materials Folder

The `ReferenceMaterials/` folder may contain:

- materials from previous projects;
- old versions of code;
- old documentation;
- old agent instruction files;
- notes;
- drafts;
- reference materials;
- technical fragments;
- materials for later adaptation.

The purpose of `ReferenceMaterials/` is to preserve useful reference material without mixing it with current mini-projects or active foundation rules.

AI assistants may analyze files in `ReferenceMaterials/` when explicitly asked.

AI assistants may use these materials as a basis for new files in `MiniProjects/` when explicitly instructed.

A new or converted active project file must follow the current UartDebug project rules.

## Mini-Project Folder Structure

All mini-projects must be placed inside the `MiniProjects` folder.

Each mini-project must have its own folder.

The mini-project folder name must include the mini-project number and name.

Example:

```text
MiniProjects/
  01_Minimum/
  02_CPU_Clock/
  03_Delay-Based_Blink/
```

This file defines the general structure of mini-projects.

It must not contain the full list of mini-projects, because the list may expand over time.

## Mini-Project File Structure

Each mini-project must contain at least these three core files:

```text
<MiniProjectName>.c
<MiniProjectName>_help.md
<MiniProjectName>_AI.md
```

Example:

```text
MiniProjects/
  09_UART0_Interrupt_Transmission/
    09_UART0_Interrupt_Transmission.c
    09_UART0_Interrupt_Transmission_help.md
    09_UART0_Interrupt_Transmission_AI.md
```

The `.c` file contains the compilable program code.

The `_help.md` file contains the human-facing explanation.

The `_AI.md` file contains the AI-facing technical description and reuse guidance.

Additional files may be added when they are technically or educationally necessary.

Possible additional files include:

- header files;
- additional source files;
- test data;
- schematics;
- images.

Additional files should not be added without a clear purpose.

## Mini-Project Revision and File Versions

All active files inside one mini-project are tightly linked.

The first two numeric parts of every file version must match the current project version.

The first three numeric parts must be the same for all active files of the same mini-project.

These first three numeric parts define the **Mini-Project Revision**.

Each individual file has its own complete internal **File Version**.

Variant letters may differ between files because the files may be edited independently.

Example:

```text
Mini-Project Revision: 1.2.4

09_Project.c        Variant 1.2.4-a
09_Project_help.md  Variant 1.2.4-c
09_Project_AI.md    Variant 1.2.4-b
```

Each core mini-project file must contain its internal file version.

In the C file:

```c
//### File Version
// Variant 1.2.4-a
```

In the Markdown files:

```markdown
### File Version

Variant 1.2.4-b
```

The `File Version` heading must remain stable.

The dynamic revision or variant value must be written in the section content, not included in the heading.

Detailed versioning rules are defined in:

```text
02_PROJECT_VERSIONING.md
```

## Mini-Project Definition

A mini-project is a small, functionally complete, standalone bare-metal C project built around one primary technical or educational objective.

A mini-project should:

- have a clear purpose;
- compile as a standalone project;
- run without borrowing required files from another mini-project;
- fully demonstrate its stated objective;
- contain the code and documentation needed to build, understand, and verify it;
- be useful for learning;
- be useful as a verified building block for AI-assisted development.

Supporting mechanisms may be included when they are necessary to demonstrate the primary objective.

A mini-project does not need to contain only one peripheral, function, or technology.

Supporting elements should not turn it into a collection of several unrelated new topics.

## Mini-Project Growth Rule

Mini-projects should grow gradually in complexity.

A later mini-project may use more peripherals, interrupts, external hardware, or integration rules than an earlier one.

Do not overload one mini-project with too many unrelated ideas.

## Mini-Project Code Preservation

When modifying an existing mini-project, preserve its working behavior, educational purpose, and established structure unless the project owner explicitly approves a change.

Do not remove working code, documentation, or examples merely to simplify or shorten the mini-project.

Necessary substantial restructuring should be discussed before changes are made and should proceed only after explicit approval from the project owner.

## Preferred Implementation Direction

Time-critical, periodic, or concurrent operations should generally be implemented using peripheral hardware or interrupts when this improves timing, responsiveness, or program structure.

Blocking operations may still be used when they are simple, appropriate for the educational objective, or do not create significant practical problems in the specific mini-project.

The implementation method should be selected according to the purpose and timing requirements of the mini-project rather than by applying a fixed execution-time threshold.

## C-File Comment Rule

Comments in the C file should be minimal.

The C file may contain ordinary comments when needed.

The C file may also contain linked section markers.

## Linked Section Markers

A linked section marker is a C comment line in which the characters immediately after `//` form a complete Markdown heading.

Example:

```c
//#### UART Baud Rate Selection
```

Corresponding Markdown heading:

```markdown
#### UART Baud Rate Selection
```

The marker and the corresponding Markdown heading must match exactly in:

- heading level;
- heading text;
- letter case;
- punctuation.

Do not insert a space between `//` and the first `#`.

Correct:

```c
//#### UART Baud Rate Selection
```

Incorrect:

```c
// #### UART Baud Rate Selection
```

Each linked section marker in the C file must have a corresponding heading in at least one of these related files:

```text
<MiniProjectName>_help.md
<MiniProjectName>_AI.md
```

A corresponding heading may appear:

- only in `_help.md` when the explanation is intended for a human user;
- only in `_AI.md` when the explanation is intended for AI-assisted development;
- in both files when the section is useful for both audiences.

A linked section marker must not be absent from both related Markdown files.

Linked section markers should normally be unique within the C file unless repeated use is explicitly intentional.

A corresponding heading may appear once in `_help.md`, once in `_AI.md`, or once in each file.

Prefer specific headings:

```c
//#### GPIO Initialization
//#### USART0 Initialization
```

Avoid ambiguous repeated headings such as:

```c
//#### Initialization
```

Dynamic values must not be included in linked headings.

Use a stable heading and place the dynamic value in the section content.

Example:

```c
//### File Version
// Variant 1.2.4-a
```

Linked section markers allow humans and AI assistants to match parts of the C code with the related documentation.
