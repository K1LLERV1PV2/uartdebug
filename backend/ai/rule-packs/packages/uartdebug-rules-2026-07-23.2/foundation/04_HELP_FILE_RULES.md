# 04_HELP_FILE_RULES.md

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

This file defines the rules for creating human-facing mini-project help files in **UartDebug**.

It applies to files named:

```text
<MiniProjectName>_help.md
```

This file should contain only rules for human-facing help documentation.

General mini-project development rules are defined in:

```text
03_DEVELOPMENT_RULES.md
```

AI-facing description rules are defined in:

```text
05_AI_FILE_RULES.md
```

## Human Help File Role

The `_help.md` file explains the mini-project for a human user.

It should be practical and understandable for beginners.

It should explain:

- what the mini-project does;
- what additional hardware and setup are required;
- what the user should do after flashing;
- what result should be observed;
- why the mini-project is useful;
- how it may be configured or reused when applicable.

The `_help.md` file should not replace the C code or the AI-facing description file.

## Human Help File Structure

The `_help.md` file has a defined core structure.

Additional section names may be introduced later by the project owner.

## Required and Optional Sections

Every `_help.md` file must contain these required elements and sections:

```text
Document Title
File Version
One-Line Description
Full Mini-Project Description
Hardware Requirements and Setup
Quick Start
What This Mini-Project Is For
```

These required elements and sections must not be omitted.

The following sections are optional:

```text
Tested Hardware
Usage Options
Code-Linked Component Descriptions
```

Include an optional section only when it contains useful information for the specific mini-project.

Do not add empty or purely formal optional sections.

## Document Title

The first line of the `_help.md` file must be a level-one Markdown heading containing the logical mini-project name.

Example:

```markdown
# 09_UART0_Interrupt_Transmission
```

For a file named:

```text
09_UART0_Interrupt_Transmission_help.md
```

the document title is:

```markdown
# 09_UART0_Interrupt_Transmission
```

The title must not contain:

- the `_help` suffix;
- a revision or variant identifier;
- an automatically added filename suffix.

Use the stable technical mini-project name, including its number.

The `File Version` section must immediately follow the document title.

## File Version

The `_help.md` file must contain the internal version of that specific help file.

Use this format:

```markdown
### File Version

Variant 1.2.4-b
```

The heading must remain:

```text
File Version
```

The revision or variant identifier must be written in the section content, not included in the heading.

The first two numeric parts must match the current project version.

The first three numeric parts must match the **Mini-Project Revision** shared by the active files of that mini-project.

The variant letter may differ from the variant letters of the related C and `_AI.md` files.

Detailed versioning rules are defined in:

```text
02_PROJECT_VERSIONING.md
03_DEVELOPMENT_RULES.md
```

## One-Line Description

This section contains a short single-line description of the mini-project.

It should describe the mini-project in a form suitable for quick identification by a human user.

Avoid detailed implementation information in this section.

## Full Mini-Project Description

This section explains what the mini-project does.

It may briefly describe the general operating principle when this helps the user understand the observed behavior.

It may also explain the relationship between the program behavior and the result visible to the user.

Detailed explanations of individual code fragments, functions, registers, or implementation decisions should be placed in the related code-linked component sections.

Do not turn this section into a line-by-line code explanation.

## Hardware Requirements and Setup

This section describes the additional hardware and setup required by the specific mini-project.

Do not normally repeat the basic project hardware:

- the microcontroller;
- one USB-UART adapter for UPDI programming;
- the UPDI resistor.

Basic hardware may be mentioned when this is necessary to:

- explain a specific connection;
- distinguish between devices;
- prevent a wiring error;
- describe an important voltage or signal-level requirement;
- describe an electrical or safety requirement.

When no additional hardware is required, state this explicitly:

```text
No additional hardware is required.
```

When additional hardware is required, describe:

- what hardware is needed;
- how it must be connected;
- any important voltage, signal-level, or safety requirements;
- how additional tools must be configured;
- how **UartDebug** must be configured when applicable.

Examples of additional hardware may include:

- a second USB-UART adapter;
- an LED and resistor;
- measurement tools;
- project-specific external components.

## Tested Hardware

This optional section identifies the hardware on which the mini-project was actually tested.

For each tested device, specify only:

- the exact microcontroller model;
- the package.

Example:

```markdown
### Tested Hardware

- `ATtiny1624`, SOIC-14
```

When several devices were tested, list each model and package separately.

Do not include devices whose compatibility is only assumed or expected.

## Quick Start

This section provides a short sequence of actions for running and checking the mini-project after the program has been flashed.

Use numbered steps when this improves clarity.

The section should include, when applicable:

- required **UartDebug** or terminal settings;
- actions the user must perform;
- the expected observable result;
- a short indication of what confirms correct operation.

Do not repeat detailed wiring instructions already given in `Hardware Requirements and Setup`.

Do not include long explanations of the internal implementation.

## What This Mini-Project Is For

This section explains why the mini-project is useful.

It may describe:

- the main learning objective;
- the peripheral or programming technique being demonstrated;
- the debugging or testing purpose;
- possible future applications of the demonstrated approach.

Do not use this section for detailed operating instructions or lists of adjustable parameters.

## Usage Options

This optional section explains how the user may apply, configure, or reuse the mini-project.

It may describe:

- adjustable parameters;
- selectable modes;
- reusable functions or code fragments;
- alternative usage scenarios;
- controlled modifications that do not change the primary purpose of the mini-project.

Avoid repeating the purpose and learning objectives already described in `What This Mini-Project Is For`.

## Code-Linked Component Descriptions

This optional section contains human-facing explanations of code components linked to section markers in the C file.

Include a linked component description in `_help.md` when it helps the user:

- understand the purpose of a code fragment;
- safely change an important parameter;
- understand a peripheral or function;
- recognize an important limitation;
- reuse part of the mini-project.

The Markdown heading must exactly match the corresponding linked section marker in the C file.

Example in the C file:

```c
//#### UART Baud Rate Selection
```

Corresponding heading in `_help.md`:

```markdown
#### UART Baud Rate Selection
```

A linked section does not need to appear in `_help.md` when its explanation is useful only for AI-assisted development and is provided in `_AI.md`.

Do not add linked sections merely to repeat obvious code.

Detailed marker syntax and matching rules are defined in:

```text
03_DEVELOPMENT_RULES.md
```

## Style Rules

The `_help.md` file should be written in English.

The text should be:

- concise;
- practical;
- beginner-friendly;
- technically accurate.

Avoid unnecessary theory.

Explain what is useful for running, observing, understanding, configuring, or safely modifying the mini-project.

Use short paragraphs and lists when they improve clarity.

Do not duplicate information between sections without a practical reason.
