# 05_AI_FILE_RULES.md

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

This file defines the rules for creating AI-facing mini-project description files in **UartDebug**.

It applies to files named:

```text
<MiniProjectName>_AI.md
```

The `_AI.md` file is an active technical companion to the mini-project C file and human-facing help file.

General mini-project development rules are defined in:

```text
03_DEVELOPMENT_RULES.md
```

Human-facing help rules are defined in:

```text
04_HELP_FILE_RULES.md
```

Detailed versioning rules are defined in:

```text
02_PROJECT_VERSIONING.md
```

## AI Description File Role

The `_AI.md` file should help AI assistants:

- understand the code structure;
- preserve important code fragments;
- reuse functions or modules;
- integrate the mini-project into larger projects;
- identify dependencies, conflicts, and limitations;
- modify or extend the mini-project safely;
- distinguish verified facts from assumptions.

The `_AI.md` file should not replace the C code or the human-facing help file.

Markdown is the required primary format.

YAML may be used only as an optional structured addition.

## Required and Optional Sections

Every `_AI.md` file must contain these required elements and sections:

```text
Document Title
File Version
AI Summary
Used Hardware
Used Peripherals
Important Code to Preserve
Initialization Requirements
Integration Rules
Conflicts and Limitations
```

These required elements and sections must not be omitted.

When no project-specific information exists for a required section, state this explicitly instead of leaving the section empty.

The following sections are optional:

```text
Tested Hardware
Possible Extensions
YAML Specification
Code-Linked Component Descriptions
```

Include an optional section only when it contains useful information for the specific mini-project.

Do not add empty or purely formal optional sections.

## Document Title

The first line of the `_AI.md` file must be a level-one Markdown heading containing the logical mini-project name.

Example:

```markdown
# 09_UART0_Interrupt_Transmission
```

For a file named:

```text
09_UART0_Interrupt_Transmission_AI.md
```

the document title is:

```markdown
# 09_UART0_Interrupt_Transmission
```

The title must not contain:

- the `_AI` suffix;
- a revision or variant identifier;
- an automatically added filename suffix.

Use the stable technical mini-project name, including its number.

The `File Version` section must immediately follow the document title.

## File Version

The `_AI.md` file must contain the internal version of that specific AI description file.

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

The variant letter may differ from the variant letters of the related C and `_help.md` files.

## AI Summary

This section provides a concise technical summary of the mini-project.

It should identify:

- the primary purpose;
- the main implementation approach;
- the most important behavior;
- the main reuse or integration value.

Do not turn this section into a full code walkthrough.

## Used Hardware

This section identifies physical hardware that is relevant to understanding, running, or integrating the mini-project.

Describe the target microcontroller at the most useful confirmed level of specificity.

Depending on the mini-project, this may be:

- a compatible microcontroller family or series;
- a group of devices with the required peripherals and register structure;
- one exact microcontroller model;
- one exact package when pin availability or package-specific limitations are important.

Do not require an exact microcontroller model when differences between compatible devices are not relevant to the mini-project.

Do not imply compatibility with an entire family when that compatibility has not been verified or cannot be reasonably established.

State package-dependent pin or peripheral limitations when they affect the mini-project.

The section may also include:

- boards;
- external adapters;
- sensors, indicators, resistors, or other components;
- measurement equipment;
- important physical connections.

Include only hardware information useful for the specific mini-project.

## Tested Hardware

This optional section identifies hardware on which the mini-project was actually tested.

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

## Used Peripherals

This section identifies internal microcontroller resources used by the mini-project.

Use exact peripheral and resource names whenever possible.

It may include:

- peripheral instances such as `USART0`, `TCA0`, or `TCB0`;
- GPIO ports and pins;
- interrupt vectors;
- peripheral routing;
- internal hardware resources that may conflict with other code.

Do not use only a general peripheral type when the exact instance is known.

If no special peripheral resources are used, state this explicitly.

## Important Code to Preserve

This section identifies project-specific code fragments that require special care during modification or integration.

For each important element, specify when useful:

- the exact function, variable, macro, ISR, register operation, or linked section;
- what must be preserved;
- why it is important;
- what may fail if it is changed incorrectly;
- whether controlled changes are allowed.

Do not declare the entire file immutable without a technical reason.

Example:

```markdown
### Important Code to Preserve

- `ISR(USART0_DRE_vect)`  
  Preserve the interrupt-disable condition executed after the last byte is transmitted.  
  Removing it may cause continuous interrupts.

- `current_tx_ptr` and `current_tx_byte_count`  
  Preserve their coordinated update order inside the ISR.
```

When no code fragments require special preservation beyond the general project rules, state:

```text
No code fragments require special preservation beyond the general project code-preservation rules.
```

## Initialization Requirements

This section describes what must be configured before the mini-project logic can operate correctly.

It may include:

- required initialization functions;
- required call order;
- clock configuration;
- initial variable values;
- peripheral setup;
- interrupt enable requirements;
- global interrupt enable requirements.

Describe order dependencies explicitly when they are important.

Example:

```markdown
### Initialization Requirements

- Call `USART_Init()` before starting transmission.
- Call `sei()` after all interrupt-controlled peripherals are configured.
```

## Integration Rules

This section describes what must be transferred, preserved, or adapted when reusing the mini-project in another project.

It may include:

- required functions;
- global variables;
- macros and constants;
- interrupt service routines;
- initialization dependencies;
- required file-level definitions;
- code fragments that must be transferred together;
- assumptions that the receiving project must satisfy.

Use exact technical identifiers.

Example:

```markdown
### Integration Rules

When reusing the transmission engine, also copy:

- `USART_Init()`;
- `USART_SendBuffer()`;
- `ISR(USART0_DRE_vect)`;
- the transmission state variables.
```

## Conflicts and Limitations

This section describes conditions that may prevent correct operation or limit integration.

It may include:

- already occupied peripheral instances;
- interrupt-vector conflicts;
- pin or routing conflicts;
- buffer limitations;
- blocking behavior;
- timing limitations;
- clock assumptions;
- lifetime requirements for transmitted or referenced data;
- restrictions on starting a new operation before the previous one is complete.

Distinguish confirmed limitations from possible concerns.

Example:

```markdown
### Conflicts and Limitations

- `USART0` cannot be independently configured by another module.
- A new transmission must not start while the previous buffer is active.
- The transmitted buffer must remain valid until transmission is complete.
```

When no project-specific conflicts are currently known, state this explicitly.

## Possible Extensions

This optional section describes controlled ways in which the mini-project may be extended.

It may include:

- additional operating modes;
- alternative peripheral instances;
- interface extensions;
- larger buffers;
- additional reusable functions;
- progression to a more advanced mini-project.

Extensions must be presented as possibilities, not as instructions to modify verified code automatically.

Do not include speculative extensions that have no clear technical or educational value.

## YAML Specification

A YAML block may be included as an optional structured addition to the Markdown content.

YAML must not replace the required Markdown sections.

YAML may be useful for structured data such as:

- peripherals;
- pins;
- interrupts;
- dependencies;
- parameters;
- integration constraints.

Do not add an empty YAML placeholder.

Do not define or treat a YAML schema as final without an explicit instruction from the project owner.

## Code-Linked Component Descriptions

This optional section contains AI-facing explanations of code components linked to section markers in the C file.

Include a linked component description in `_AI.md` when it helps an AI assistant:

- preserve a critical dependency;
- safely change a parameter;
- reuse or integrate a code fragment;
- understand a peripheral constraint;
- select between supported implementation options;
- avoid an unsafe or incompatible modification.

The Markdown heading must exactly match the corresponding linked section marker in the C file.

Example in the C file:

```c
//#### Transmission Buffer Lifetime
```

Corresponding heading in `_AI.md`:

```markdown
#### Transmission Buffer Lifetime
```

A linked section does not need to appear in `_AI.md` when its explanation is useful only for a human user and is provided in `_help.md`.

Do not add linked sections merely to restate obvious code.

Detailed marker syntax and matching rules are defined in:

```text
03_DEVELOPMENT_RULES.md
```

## Style Rules

The `_AI.md` file should be written in English.

Use exact names for:

- functions;
- variables;
- macros;
- registers;
- interrupt vectors;
- peripherals;
- pins;
- files.

Format technical identifiers as code.

Clearly distinguish:

- verified facts;
- project requirements;
- assumptions;
- possible extensions.

Do not present assumed compatibility or unverified behavior as confirmed.

Avoid vague descriptions and unnecessary background information.

Keep explanations focused on analysis, preservation, modification, reuse, and integration.
