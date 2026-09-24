# Specification-to-code workflow

## One consistent project

Treat the specification, executable C, structured resource allocation and code guide as views of one project. The specification states the requested behavior; C implements it; the resource structure records what that C actually allocates; the guide explains that final implementation. The colleague describes specification, development and explanation as consecutive stages. In the server canvas these are one authorized processing operation, with clarification returned when a material decision is still missing.

Use the selected MCU and package as the target context. Resolve conflicts between that selection and the canvas explicitly; do not take an example device from a template. Physical package pin numbers, port names and peripheral routes are different facts and must agree. Use project names or versions already supplied where relevant, but do not block a valid implementation merely because the canvas lacks the colleague's `Ver.X.Y` heading format. Keep existing source and guide filenames on an update instead of creating version-suffixed duplicates.

## Review the requirements

Check for missing hardware information, incompatible parameter values, contradictions between requirements, terminology that changes meaning, and assumptions inherited from a sample. Ask only about a choice that materially prevents correct implementation and cannot be established from the current project, selected device or reviewed defaults. Board wiring must come from the user or project data; a datasheet does not reveal how their board is connected.

For a conflicting requirement, identify the actual value or statement, explain its implementation consequence briefly, and give a concrete correction or choice. Use an information annotation for a derived or non-obvious decision that needs no answer. Use a question for a necessary unresolved choice and an error for a known invalid parameter. A missing version label or a harmless stylistic difference is not an electrical or implementation error.

Annotations are discussion about the requirements, not automatically new requirements. Use the server's structured annotations, stable IDs, actual anchor quotes and one-based line hints. Preserve relevant answers. When an answer settles a requirement, incorporate the decision into the canvas before resolving the annotation so the next generation does not lose it. Do not silently replace a valid user requirement with an implementation preference. If an answer is ambiguous, keep that uncertainty visible rather than marking the question answered.

Only unresolved questions or errors that affect the requested generation prevent a generate result. Do not turn optional explanations into compulsory confirmations. The Process action already authorizes the operation described by the server contract; do not add the colleague's repeated per-file approval dialogue, quoted Markdown annotation format or temporary marker commands.

## Allocate before composing

Identify every requested resource and its dependencies: selected pin and direction, active level and safe initial state, peripheral instance and mode, route, clock source, period or baud settings, interrupt vector, software headers, and any shared buffer or state. A resource can have only one compatible owner. When examples touch the same clock, pin, timer, interrupt or output stream, combine their configuration deliberately rather than concatenate their initialization functions.

Choose a reviewed implementation whose preconditions fit the requirements. Do not force the CPU to an example's frequency when the behavior can use a reviewed independent clock. Conversely, do not claim CPU-independent timing for a mechanism that actually uses `CLK_PER`, delay loops or CPU execution. Carry nominal-clock accuracy, quantization and first-event behavior into the implementation decision when the requirement makes them material.

Use the existing server structured-spec schema. Its MCU/package, resource and dependency information replaces the colleague's separate YAML dialect. Return header names such as `xc.h` in `includes`; the server handles YAML serialization. Do not return C `#include` directives as YAML dependency values and do not introduce a parallel model for the same allocation. A blank new project can have no allocated resources; an update must preserve or deliberately revise the existing allocations rather than resetting them to an empty template.

## Update and validate together

Read the current implementation before changing it. Preserve relevant user functionality, resolve requested behavior against existing configuration, and update every dependent artifact in the same result. After changing a pin, clock, timing mechanism or interface, recheck all affected code, resources, annotations and guide sections. A local typo does not require restructuring unrelated parts of the project.

Before returning a project, inspect the complete candidate for one `main()`, unique ISR definitions, correct includes, coherent resource ownership, safe startup order, consistent constants and units, and agreement between code and guide. Do not declare completion with a C file from one design and resources or documentation from another. If a material requirement remains unsatisfied, return the appropriate canvas clarification instead of a partially synchronized generated project.

Use the configured compiler and source/resource validation results as separate evidence. Source review establishes an interpretation, compilation establishes what that exact toolchain accepted, and resource validation checks only the implemented allocation rules. None proves the circuit or physical timing. The server owns the displayed verification result; do not copy a previous project's successful compile or hardware check into a new generation.

## Source discrepancies

When technical sources disagree, record the competing statements, exact document revision/page or source location, affected implementation decision, and unresolved condition. Prefer the applicable reviewed errata over the older datasheet. An imported `Problems.md` entry is a dated observation, not proof that the current pinned source set still has an unresolved issue. Consult the current reviewed facts and errata before carrying it forward.

The colleague recorded USART STATUS reset and CLK2X wording discrepancies, plus TCB PWM8 byte-name inconsistencies. Preserve the method of tracing and resolving these issues. Do not generate alternate register spellings or a new mode merely because an older source suggests them. If the current local references still leave a necessary fact unresolved, use the server's limited external-lookup workflow; do not silently choose the most convenient interpretation.

## Sources

- `Project_Rules/Project_Description.md`, lines 3–56, for project stages and a permanent knowledge library.
- `Target_Projects/Base_project_rules.md`, lines 9–149 and 258–347, adapted to the existing canvas, schema and update operation.
- `AGENTS.md`, lines 39–57; `Project_Rules/AGENTS_Add_On.md`, lines 60–68, for review coherence without their approval gates.
- `Knowledge_Base/Problems.md`, lines 1–100, for discrepancy tracing, not its old unresolved-status claims.
- `Target_Projects/Project_One/Project_One.md`, lines 5–17; `Project_One.yaml`, lines 1–30; `Project_One (description).md`, lines 129–141.
