# 01_START_HERE_FOR_AI.md

## File Version

This file revision is:

```text
Revision 1.2.3
```

## Project Version

```text
Version 1.2
```

## Project Name

Always call this project:

```text
UartDebug
```

## Purpose

This file is the shared first foundation file for ChatGPT, Codex, other AI assistants, and human collaborators working on **UartDebug**.

It contains the most important common working rules.

Detailed rules are defined in the specialized project foundation files.

Codex-specific repository and execution rules are defined in:

```text
AGENTS.md
```

## What UartDebug Is

**UartDebug** is a project for developing practical technologies, tools, examples, and workflows for microcontroller programming.

At the current stage, the project focuses on:

- AVR microcontrollers;
- UPDI programming;
- bare-metal C;
- numbered mini-projects;
- integration with **uartdebug.com**.

The mini-projects are intended for two purposes:

1. teaching users step by step;
2. giving AI assistants verified building blocks for creating more complex microcontroller projects.


## Working File Priority in the Current Chat

During work in the current ChatGPT chat, a newer working version of the same logical project file created for download in response to an explicit instruction from the project owner, and not subsequently rejected by the project owner, has priority over an older version stored in **Project Sources**.

Determine the newer working version primarily from the internal `File Version` section.

Do not use file creation dates or modification dates as the main version source.

Use the files in **Project Sources** as the fallback for project documents that do not have a newer working version in the current chat.

This priority rule applies only within the current chat.

A file created without an explicit instruction from the project owner does not become an active working version and must be ignored.

Creating a downloadable file does not automatically replace the corresponding file in **Project Sources**.

If the project owner says that work is finished for the day, that a pause is beginning, or that the current work session is ending, compare the current working versions with the corresponding files in **Project Sources**.

If one or more project sources are older than the current working versions, remind the project owner which source files should be replaced.

In a new chat, the files in **Project Sources** are the primary project context unless the project owner explicitly provides or identifies newer working versions.

Before starting a new chat, the project owner should replace the accumulated outdated files in **Project Sources** with the latest active non-rejected versions, or explicitly provide the newer working files again.

Codex must not treat a chat-only downloadable version as an active repository file unless that version has been placed in the repository or explicitly provided for the current Codex task.

## Required Reading Order

Read the project foundation files in this order:

```text
01_START_HERE_FOR_AI.md
02_PROJECT_VERSIONING.md
03_DEVELOPMENT_RULES.md
04_HELP_FILE_RULES.md
05_AI_FILE_RULES.md
06_ACTIVE_RULE_UPDATES.md
```

Codex-style agents must also follow:

```text
AGENTS.md
```

In a Codex repository, `AGENTS.md` is loaded as the repository entry file.

It directs the agent to read the foundation files listed above before modifying the repository.

## Roles of the Main Files

```text
01_START_HERE_FOR_AI.md     Shared first foundation file and common rules for all AI assistants.
02_PROJECT_VERSIONING.md    Project versioning and file-version rules.
03_DEVELOPMENT_RULES.md     General mini-project development rules.
04_HELP_FILE_RULES.md       Rules for human-facing mini-project help files.
05_AI_FILE_RULES.md         Rules for AI-facing mini-project description files.
06_ACTIVE_RULE_UPDATES.md   Controlled buffer for active changes to foundation files and AGENTS.md.
AGENTS.md                   Codex-specific repository and execution rules.
README.md                   Short human-facing project overview.
```

Common rules must be stored in the shared foundation files.

`AGENTS.md` should contain only rules that are specifically useful for Codex-style repository work and should not unnecessarily duplicate common rules.

## Priority and Approval

The priority order is:

```text
Current explicit instruction from the project owner
Active buffered rules in 06_ACTIVE_RULE_UPDATES.md
Rules in the target foundation files and AGENTS.md
```

An explicit current instruction from the project owner has priority over project files.

Active buffered rules in `06_ACTIVE_RULE_UPDATES.md` have priority over conflicting older rules in the target foundation files and `AGENTS.md`.

Do not create, modify, rename, finalize, or reorganize project files without an explicit instruction from the project owner.

Discussion, analysis, suggestions, and proposed wording are not implementation approval.

If the project owner requests only analysis, do not edit files.

Before editing, briefly state what will be changed.

## Scope of Work

Work only within the current explicit task.

Edit only the files and sections required by the task.

Do not add unrelated functions, files, dependencies, or structural changes intended for later stages unless explicitly requested.

Do not silently expand the scope of work.

## Practical Value of Additions

Do not add a rule, section, or descriptive statement merely for completeness.

Add it only when it:

- changes a practical decision;
- prevents a realistic error;
- improves development quality.

## Work Session Continuity

Before proposing the next step, check what has already been completed or resolved in the current work session.

Do not:

- repeat completed analysis;
- reopen a resolved question without a new reason;
- request information that has already been provided.

## Clarification and Constructive Criticism

Do not make a doubtful assumption silently when it may produce an incorrect change.

Ask for clarification or present clear alternatives when the request is materially ambiguous.

If there is an important objection or improvement, state it briefly, specifically, and with a reason.

If the user appears to have named a file or action that does not match the stated goal, point out the mismatch before implementing the change.

Do not add unnecessary theory or overly academic wording.

## Conflict and Consistency Handling

When checking project files, look for:

- internal contradictions;
- incomplete rules;
- duplicated definitions;
- inconsistent terminology;
- version and numbering errors;
- broken Markdown links;
- inconsistencies between related project files;
- mismatches between C linked section markers and Markdown headings;
- mismatches between `.c`, `_help.md`, and `_AI.md` files of one mini-project.

When reporting a meaningful conflict:

1. identify where it is located;
2. explain what the conflict is;
3. explain why it matters;
4. propose a possible correction.

Do not resolve a meaningful conflict silently.

## Editing Principles

Do not rewrite an entire file when a local change is sufficient.

Preserve the existing style and important user-authored wording.

Do not remove user-authored text without a clear reason.

If a major reduction or reorganization appears necessary, explain its purpose, discuss the proposed change with the project owner, obtain explicit approval, and only then make the change.

After editing:

1. recheck the changed fragment;
2. verify neighboring numbering when numbering changed;
3. verify internal links when headings changed;
4. verify related files when shared terminology or structure changed.

## Code Preservation

Do not change verified C code without an explicit instruction from the project owner.

If code looks suspicious, report the issue separately.

Do not silently rewrite verified code.

## Input Integrity

If a user message appears incomplete, accidentally sent, or ends with meaningless characters, do not begin a significant action immediately.

First ask whether the message is complete and whether work should begin.

Do not apply this rule to harmless typing errors when the intended request is still clear.


## Language and Encoding

Discussion with the project owner may be in Russian.

Project files should normally be written in English.

All Markdown files must be UTF-8 without BOM.

If Cyrillic text appears corrupted, first verify that the file is being read as UTF-8 before editing it.
