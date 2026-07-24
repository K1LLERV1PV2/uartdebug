# 06_ACTIVE_RULE_UPDATES.md

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

This file is an active buffer for changes to:

```text
01_START_HERE_FOR_AI.md
02_PROJECT_VERSIONING.md
03_DEVELOPMENT_RULES.md
04_HELP_FILE_RULES.md
05_AI_FILE_RULES.md
AGENTS.md
```

## Buffer Control Rules

The default mode is:

```text
Direct Foundation Editing
```

In this mode, rule changes are not accumulated in this file. After an explicit instruction from the project owner, they are made directly in the relevant target file.

When work is focused on mini-projects or other target files and a new foundation-rule change appears, the AI assistant should offer to switch to:

```text
Buffered Foundation Updates
```

Only the project owner may switch the mode.

If the owner declines, the mode remains unchanged. The AI assistant should identify the appropriate target file and may offer buffer mode again when another foundation-rule change appears later.

In `Buffered Foundation Updates` mode:

- new foundation-rule changes are recorded in this file;
- recorded rules apply immediately together with the rules in the target files;
- when a recorded rule conflicts with an older target-file rule, the recorded rule has priority;
- the target files are not modified until the project owner explicitly requests transfer;
- before every addition to this file, the AI assistant must state that the rule change will be recorded here;
- no addition may be made without an explicit instruction from the project owner;
- after successful transfer to the target file, the transferred entry must be removed from this file.

The buffer mode remains active until the project owner explicitly changes it.

Changing the buffer mode affects only where future foundation-rule changes are recorded.

Existing entries in `Buffered Rule Updates` remain active until they are transferred to their target files or explicitly removed by the project owner.

Before directly editing a target file, check whether `Buffered Rule Updates` contains an active entry for that file.

If the proposed change affects an active buffered entry, do not edit the target file until the project owner explicitly chooses to transfer, update, or remove that buffered entry.

Changes to the buffer-control rules, `Buffer Mode`, or the structure of `06_ACTIVE_RULE_UPDATES.md` are always made directly in this file after an explicit instruction from the project owner.

Changes to `06_ACTIVE_RULE_UPDATES.md` itself are not recorded as buffered rule updates.

Each buffered rule entry must use this minimum structure:

```markdown
### Target File

<Logical File Name>

### Rule Update

<Exact text or precise meaning of the active rule>
```

## Buffer Mode

```text
Direct Foundation Editing
```

## Buffered Rule Updates

No buffered rule updates.
