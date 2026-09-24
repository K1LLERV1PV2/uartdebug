# Explain the implemented AVR project

## Derive the guide from the final code

Write the guide after the candidate C and resource allocation agree. Explain the code that will actually be returned, including the selected mechanism and its limitations. Do not describe an abandoned implementation, an unimplemented feature or a source example as though it were this project. Keep the guide educational enough that a user can trace a requirement through the relevant initialization function, hardware resource and recurring action without narrating every C token.

Use the visitor's language for the guide, annotations and other explanatory output according to the server locale contract. Device symbols, C identifiers and schema keys remain unchanged. Store methodology in English and text as UTF-8; an imported Russian-language example is not a requirement to generate all future documentation in Russian. Check encoding before treating visibly corrupted Cyrillic text as a defective source.

Use the existing source `//#` heading mechanism for code-to-guide navigation. Every such source marker must match a guide heading of the same level and exact text. The colleague's `//+`, `//-` and `//X` regions are not documentation anchors for this application. Do not create a second AI-only Markdown explanation or duplicate the guide as a separate private specification.

## Explain hardware and configuration

Start with the purpose and observable behavior. Identify the exact MCU and package. For each connected signal, state the physical package pin and matching port signal where the project has that information. Explain active-high or active-low behavior and the initial safe state, rather than assuming that a high output always means an active device. A short text wiring chain can explain a simple connection, but do not invent component values, connections or hardware properties absent from the specification.

Explain why each non-obvious header or configuration definition is needed. For instance, `<xc.h>` supplies device definitions and `<avr/interrupt.h>` supplies AVR interrupt facilities when those are used. Explain a missing `F_CPU` only if it matters to understanding the selected independent-clock mechanism; do not turn absence of that macro into a universal project rule.

Describe the responsibilities of the initialization functions and their meaningful order. Connect a latch-before-direction sequence with the inactive output level it establishes. Describe necessary synchronization around a register write in the terms of that peripheral. Explain which setup relies on a verified reset default and state its boot-only precondition. Document how an event is acknowledged and how the output or shared state then changes.

## Explain timing and limits

Name the clock that actually drives the mechanism. Distinguish CPU clock, peripheral clock and an independent RTC clock. Give the requested nominal timing or baud with explicit units, and explain the relationship to the selected hardware setting. Use the server's calculated values and reviewed formulas; do not manufacture a measured period, exact oscillator frequency or unsupported precision.

For a toggle on every periodic event, distinguish the event interval, on/off duration and complete waveform period. In the colleague's LED example, 4096 cycles of nominal 32768 Hz correspond to a nominal 125 ms event interval and a nominal 250 ms full blink cycle. These numbers illustrate that distinction; do not copy them into a project with different requirements. Oscillator tolerance still affects actual timing even when the nominal division is exact.

Explain startup behavior separately from steady-state behavior when the peripheral makes them different. The reviewed RTC/PIT mechanism uses an already-running prescaler phase, so its first event need not occur after a complete selected period. Do not claim an exact first edge without a reviewed implementation that provides one.

Explain parameter changes as coordinated changes to the specification, resources, code and guide. A hardware enumeration may support only a fixed set of intervals; changing a prose millisecond value does not create an arbitrary supported period. If a requested change needs another mode or resource, identify that requirement and use a reviewed recipe when available. The colleague's suggestion of RTC counter mode for other intervals is not itself approval for that mode in the server.

## Verification and maintenance

Describe a practical check of the requested observable behavior and any assumptions the check depends on. Keep suggested checks separate from tests actually performed. Never carry hardware-test claims from another version or a different timing mechanism into the current project. The colleague correctly separates its earlier RTC-counter hardware check from the untested PIT replacement; preserve that distinction for every subsequent change.

Use the server's verification placeholder and translated messages exactly as required by the output contract. Let the server state whether the current source compiled. Do not add another independent success statement in source comments, resource descriptions, canvas text or the guide. Explain material limits, including clock accuracy and unverified electrical behavior, without implying that compilation tests them.

Check terminology, values, units, names, code/guide headings and links after a change. Keep accepted requirements and known limitations in their appropriate artifact so they survive the next update without duplicated or contradictory definitions. Cite the pinned official document revision and page for technical facts; credit the imported methodology through its recorded provenance rather than treating a tutorial as the authority for device behavior.

## Sources

- `Project_Rules/Project_Description.md`, lines 10–18, for explanation derived from generated C.
- `Target_Projects/Project_One/Project_One (description).md`, lines 1–141, for purpose, wiring, dependencies, parameters, initialization, ISR/main flow, timing limits, changes and honest verification status.
- `Target_Projects/Project_One/Project_One.md`, lines 5–17; `Project_One.yaml`, lines 1–30, for agreement with requirements and resource allocation.
- `AGENTS.md`, lines 7–11 and 39–57; `Project_Rules/AGENTS_Add_On.md`, lines 77–84, adapted to the server's visitor-locale contract.
