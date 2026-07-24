# 02_PROJECT_VERSIONING.md

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

This file defines the versioning and file-naming system used for active **UartDebug** project files.

It applies to:

- project foundation files;
- other active working files;
- mini-project files;
- `AGENTS.md`;
- `README.md`;
- other files that are part of the active project state.

Reference materials are handled separately and are not required to match the current project version.

## Main Terms

The versioning system uses four terms:

```text
Stage     -> 1
Version   -> 1.2
Revision  -> 1.2.3
Variant   -> 1.2.3-b
```

## Stage

A **Stage** is a large development phase of the project.

Example:

```text
Stage 1
```

A stage may last for a long time.

A later stage may or may not be reached.

## Version

A **Version** is the common active project context inside a stage.

Example:

```text
Version 1.2
```

The first number identifies the stage.

The second number identifies the version inside that stage.

All active project files must use the same first two numbers.

Example:

```text
01_START_HERE_FOR_AI.md   1.2.2-e
02_PROJECT_VERSIONING.md  1.2.2-c
03_DEVELOPMENT_RULES.md   1.2.1-f
```

These files belong to the same project version:

```text
Version 1.2
```

A file whose first two numbers are different belongs to another project version and must not be silently mixed with the current active project files.

## Revision

A **Revision** is a numbered, relatively stable state inside a project version.

A revision has three numeric parts and no letter suffix.

Example:

```text
Revision 1.2.3
```

The third number identifies the revision.

For a project foundation file, the third number tracks the revision of that individual file.

Different foundation files may therefore have different third numbers.

For a mini-project, the third number identifies the common revision of the complete mini-project file set.

A revision number must not be reused for a different state of the same logical file or explicitly related file group.

## Variant

A **Variant** is a working modification associated with a revision.

A variant adds a letter suffix to the revision number.

Example:

```text
Variant 1.2.3-b
```

Variants may develop in sequence:

```text
Revision 1.2.3
Variant 1.2.3-a
Variant 1.2.3-b
Variant 1.2.3-c
```

A revision without a letter is a relatively stable state.

Variants with letters are working states created after or in relation to that revision.

A variant must not be converted into a revision merely by removing its letter.

A new revision number is assigned only after an explicit instruction from the project owner.

## Internal File Version Rule

Every active project file must contain an internal file version.

This requirement also applies to minimal active files such as:

```text
README.md
```

The internal version must identify the file as either:

```text
Revision X.Y.Z
```

or:

```text
Variant X.Y.Z-a
```

The internal file version is the authoritative source for determining the version of the file.

## Reference Materials Exception

Reference materials are not active project files unless the project owner explicitly converts or adopts them into the active project structure.

Reference materials are not required to use the current project version.

They may retain:

- their original version;
- a historical version;
- another versioning system;
- no UartDebug project version.

After a reference material file is converted into an active UartDebug project file, it must follow the active project versioning rules.

## Foundation File Revision Rule

Each project foundation file has its own revision number.

The first two numbers must match the current project version.

The third number and the variant letter may differ between foundation files.

Example:

```text
01_START_HERE_FOR_AI.md   Variant 1.2.2-e
02_PROJECT_VERSIONING.md  Variant 1.2.2-c
03_DEVELOPMENT_RULES.md   Variant 1.2.1-f
```

This is valid because all files belong to:

```text
Version 1.2
```

## Mini-Project Revision Rule

All active files inside one mini-project must use the same first three numbers.

Example:

```text
09_Project.c        Variant 1.2.4-a
09_Project_help.md  Variant 1.2.4-c
09_Project_AI.md    Variant 1.2.4-b
```

These files belong to the same mini-project revision:

```text
1.2.4
```

The variant letters may differ because each file may be edited independently.

## Revision Alignment Rule

The project owner may explicitly request that a selected group of related files be brought to one common revision.

The new common revision must use the next revision number that has not previously been used for that group.

It must be greater than every revision number previously used for that group.

Example before alignment:

```text
01_START_HERE_FOR_AI.md   Variant 1.2.1-a
02_PROJECT_VERSIONING.md  Variant 1.2.2-b
03_DEVELOPMENT_RULES.md   Variant 1.2.1-c
```

The highest previously used revision number is:

```text
1.2.2
```

After an explicit instruction to align the group, the files may become:

```text
01_START_HERE_FOR_AI.md   Revision 1.2.3
02_PROJECT_VERSIONING.md  Revision 1.2.3
03_DEVELOPMENT_RULES.md   Revision 1.2.3
```

Later working changes may continue as:

```text
Variant 1.2.3-a
Variant 1.2.3-b
```

Do not reuse an older revision number for a new aligned state.

## Active Working Variant Rule

A new file created and provided to the project owner in response to an explicit instruction becomes the active working variant by default.

A separate confirmation of acceptance is not required.

The project owner may later explicitly reject or not accept that file, even after downloading it or uploading it to Project Sources.

After rejection:

- the rejected file becomes inactive;
- it must not be used as the basis for further work;
- the latest previous non-rejected version becomes active again.

Example:

```text
Variant 1.2.3-b  active
Variant 1.2.3-c  created and provided, then rejected
```

The active working version becomes:

```text
Variant 1.2.3-b
```

A rejected variant letter must not be reused.

The next new variant in this example should be:

```text
Variant 1.2.3-d
```

A file created without an explicit instruction from the project owner does not become an active working version.

## Logical File Name

A **Logical File Name** is the stable project name of a file.

It does not contain version information.

Examples:

```text
01_START_HERE_FOR_AI.md
02_PROJECT_VERSIONING.md
03_DEVELOPMENT_RULES.md
```

Logical file names must be used in:

- required reading lists;
- references between project files;
- descriptions of file roles;
- general project instructions.

Using logical file names prevents internal references from changing whenever a revision or variant changes.

## Actual File Name

An **Actual File Name** is the name of a specific stored, downloaded, transferred, or uploaded file instance.

An actual file name may be identical to the logical file name:

```text
02_PROJECT_VERSIONING.md
```

It may also include the complete revision or variant:

```text
02_PROJECT_VERSIONING_1.2.3.md
02_PROJECT_VERSIONING_1.2.3-b.md
```

When version information is included in an actual file name, it should include the complete revision or variant identifier.

The actual file name is useful for:

- downloading;
- transferring files;
- storing several historical states;
- visually identifying a revision or variant.

Internal project references must still use the logical file name unless they intentionally refer to one specific historical file instance.

## File Name and Internal Version Consistency

The logical file name identifies the role of the document.

The internal `File Version` identifies its revision or variant and is authoritative.

The actual file name is supporting information.

If an actual file name contains a version that does not match the internal `File Version`, report the mismatch as an error.

Do not silently change the internal version or assume that the actual file name is authoritative.

## Pre-Delivery Version Check

Before providing new or updated project files, verify:

- the internal `File Version` of every affected file;
- consistency between the internal version and the actual file name;
- consistency with the current project version;
- the shared first three version numbers of related mini-project files;
- that no affected active file was unintentionally left on an older version.

Do not provide the files until detected version inconsistencies have been corrected or explicitly reported to the project owner.

## Project Source Filename Suffix Rule

When ChatGPT automatically adds a numeric suffix in parentheses to an actual file name uploaded to Project Sources, treat the suffix as a storage artifact.

Examples:

```text
01_START_HERE_FOR_AI_1.2.2-e(3).md
AGENTS_1.2.2-c(2).md
README_1.2.2-a(4).md
```

A suffix such as `(1)`, `(2)`, `(3)`, or another number does not change:

- the logical file name;
- the file role;
- the internal revision or variant;
- the relationship of the file to other project documents.

Ignore the automatically added parenthesized numeric suffix when interpreting the actual file name.

If several files have the same logical file name and the same internal version, treat them as duplicate copies of the same file state.

## Latest Active File Rule

If several files represent the same logical project document, use the latest active non-rejected version.

Determine the version primarily from the internal `File Version`.

Use the actual file name only as supporting information.

Do not use file creation dates or modification dates as the main version source.

A newer rejected variant must be ignored.

Example:

```text
Variant 1.2.3-b  active
Variant 1.2.3-c  rejected
```

The latest active working version is:

```text
Variant 1.2.3-b
```

If two files have the same logical file name and the same internal version, treat them as duplicate copies unless their contents differ.

If their contents differ despite having the same internal version, report a versioning error.

## Version Comparison Rule

Versions are compared in this order:

```text
Stage number
Version number
Revision number
Revision without a letter
Variant suffix
```

For the same revision number:

```text
Revision 1.2.3
Variant 1.2.3-a
Variant 1.2.3-b
Variant 1.2.3-c
```

The comparison order is:

```text
Revision 1.2.3
< Variant 1.2.3-a
< Variant 1.2.3-b
< Variant 1.2.3-c
< Revision 1.2.4
```

Examples:

```text
1.2.2 is later than 1.2.1
1.2.1-b is later than 1.2.1-a
1.3.1 belongs to a different project version than 1.2.4
```

Comparison order does not make a rejected variant active.

A rejected variant remains inactive even if its identifier is numerically or alphabetically later.
