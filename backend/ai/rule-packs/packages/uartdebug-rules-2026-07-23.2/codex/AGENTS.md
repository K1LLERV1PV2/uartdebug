# AGENTS.md

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

This file contains instructions specifically for Codex-style agents working with the **UartDebug** repository.

Common rules for ChatGPT, Codex, and other AI assistants are defined in:

```text
01_START_HERE_FOR_AI.md
```

This file should not duplicate common project rules unless a short reminder is necessary for safe repository work.

## Required First Step

`AGENTS.md` is the repository entry file for Codex-style agents.

Before modifying the repository, read these foundation files in order:

```text
01_START_HERE_FOR_AI.md
02_PROJECT_VERSIONING.md
03_DEVELOPMENT_RULES.md
04_HELP_FILE_RULES.md
05_AI_FILE_RULES.md
06_ACTIVE_RULE_UPDATES.md
```

Follow the common approval, scope, versioning, code-preservation, language, and conflict-handling rules defined there.

## Foundation File Name Resolution

The repository entry file for Codex must be named exactly:

```text
AGENTS.md
```

The repository copy of this file must not contain a revision or variant identifier.

This filename restriction applies only to the repository copy named `AGENTS.md`.

Downloaded, transferred, archived, or Project Sources copies may include the complete revision or variant identifier according to:

```text
02_PROJECT_VERSIONING.md
```

When locating the project foundation files listed in this document, interpret each listed name as a **Logical File Name**.

Examples:

```text
01_START_HERE_FOR_AI.md
02_PROJECT_VERSIONING.md
03_DEVELOPMENT_RULES.md
04_HELP_FILE_RULES.md
05_AI_FILE_RULES.md
06_ACTIVE_RULE_UPDATES.md
```

An **Actual File Name** may contain the complete revision or variant identifier.

Examples:

```text
01_START_HERE_FOR_AI_1.2.3-b.md
02_PROJECT_VERSIONING_1.2.4-a.md
03_DEVELOPMENT_RULES_1.2.2-c.md
```

An actual file name may also contain an automatically added parenthesized numeric suffix.

Example:

```text
01_START_HERE_FOR_AI_1.2.2-e(2).md
```

When matching an actual file to a logical file name:

1. identify the stable descriptive part of the file name;
2. ignore the appended revision or variant identifier;
3. ignore any automatically added parenthesized numeric suffix;
4. use the internal `File Version` to determine the file version.

If several actual files correspond to the same logical file name, use the latest active non-rejected file according to:

```text
02_PROJECT_VERSIONING.md
```

## Repository Areas

The main mini-project development area is:

```text
MiniProjects/
```

A mini-project normally has this structure:

```text
MiniProjects/
  <MiniProjectName>/
    <MiniProjectName>.c
    <MiniProjectName>_help.md
    <MiniProjectName>_AI.md
```

Use this template when creating a new mini-project:

```text
MiniProjects/_Template/
```

The repository may also contain:

```text
ReferenceMaterials/
```

Files in `ReferenceMaterials/` are legacy, draft, reference, or additional materials.

Files in `ReferenceMaterials/` may be analyzed, adapted, or converted only when explicitly requested.

Analysis or adaptation does not make the original reference file an active rule, verified code, or finished mini-project.

A reference file becomes active only after explicit adoption or conversion into the active project structure.

## Foundation File Reload Rule

The project foundation files are:

```text
01_START_HERE_FOR_AI.md
02_PROJECT_VERSIONING.md
03_DEVELOPMENT_RULES.md
04_HELP_FILE_RULES.md
05_AI_FILE_RULES.md
06_ACTIVE_RULE_UPDATES.md
```

If Codex becomes aware that any of these files was modified during the current work session, it must reread every modified foundation file before continuing work.

This applies whether the modification was made:

- directly by the project owner;
- by Codex after an explicit instruction from the project owner;
- by another approved tool or process visible in the current repository.

After rereading the modified file or files, Codex must:

1. apply the updated rules to all subsequent work in the current session;
2. check whether the changes conflict with other active foundation files;
3. report any meaningful conflict instead of resolving it silently;
4. avoid continuing with an older interpretation of the modified rules.

This automatic reread rule applies to files `01_` through `06_`.

It does not apply to `AGENTS.md` itself, because Codex normally builds the `AGENTS.md` instruction chain when a run or session starts.

After a significant change to `AGENTS.md`, begin a new Codex task or session to ensure that the updated agent instructions are fully active.

## Repository Inspection

Before editing:

1. inspect the relevant files and nearby repository structure;
2. identify all files directly linked to the requested change;
3. check whether the change affects related `.c`, `_help.md`, or `_AI.md` files;
4. avoid assuming that similarly named files have the same role or version;
5. use internal file-version information according to `02_PROJECT_VERSIONING.md`.

Do not search unrelated repository areas without a reason connected to the current task.

## File Operations

Modify only files required by the current task.

Preserve existing paths and names unless renaming or reorganizing was explicitly requested.

Do not create additional helper files, reports, backups, generated documentation, or alternate versions inside the repository unless requested.

Do not overwrite reference material or verified code merely to make formatting more uniform.

When creating a new mini-project:

1. copy the structure of `MiniProjects/_Template/`;
2. replace placeholder names consistently;
3. keep `.c`, `_help.md`, and `_AI.md` synchronized;
4. follow the version and linked-section rules from the foundation files.

## Build and Verification

When a code change is requested and the required tools are available:

1. run only the build, compilation, or test commands relevant to the change;
2. do not introduce new tools or dependencies without approval;
3. report the exact command executed and its result;
4. distinguish warnings from errors;
5. never claim that a build or test succeeded if it was not run;
6. state clearly when verification could not be completed.

Do not modify verified code merely to eliminate a warning unless the project owner approved the change.

## Generated Files and Dependencies

Do not add generated build artifacts to the repository unless explicitly instructed.

Do not edit generated files when the source file or configuration should be edited instead.

Do not install, add, or update external dependencies without explicit approval.

Keep repository structure simple and avoid unnecessary files.

## Git Safety

Do not perform any of the following without an explicit instruction from the project owner:

- create a commit;
- push changes;
- pull or merge remote changes;
- create, delete, rename, or switch branches;
- rebase;
- reset;
- amend a commit;
- rewrite history;
- delete untracked files;
- use destructive checkout or restore operations;
- change remote repository settings.

Before any potentially destructive Git command, explain what it will affect.

If the project owner is practicing Git manually, do not execute Git commands instead of the project owner unless explicitly asked.

Read-only Git commands may be used when needed to understand repository state, but their results must not be treated as permission to modify the repository.

## Reporting After Changes

After completing an approved repository change, report briefly:

1. which files were changed;
2. what was changed;
3. what verification was performed;
4. any unresolved warning, limitation, or required manual check.

Do not describe a working file as final, stable, or a Revision unless the project owner explicitly says so.

## Repository Hygiene

Do not add unnecessary files.

Do not mix `ReferenceMaterials/` with active mini-projects.

Do not silently move files between project areas.

Do not leave temporary build artifacts, editor files, or backup copies in the repository.

Do not make unrelated cleanup changes while implementing a focused task.
