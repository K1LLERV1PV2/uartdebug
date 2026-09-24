# AVR code construction

## Scope and style

Use this methodology when composing or updating bare-metal AVR C for the configured XC8 compiler. It organizes a supported implementation; it does not add support for a device, peripheral mode or register sequence that has no reviewed recipe. Hardware facts, required synchronization and allowed resources come from the selected device reference and applicable recipe.

The colleague's working example uses short `static` initialization functions such as `led_init()` and `pit_init()`, an `ISR()` handler and a small `main()`. Prefer that readable division when the behavior has distinct setup and service steps. These names and the example's LED wiring are examples, not mandatory project names or pin assignments. Keep useful existing naming conventions on updates.

## Headers and configuration

Include `<xc.h>` once to select the actual target's definitions. Add only headers that the implementation uses. A configuration macro required while a header is parsed must precede that header. In particular, a CPU-dependent delay header requires the actual `F_CPU` definition before its include. Do not define a fictitious CPU frequency merely to fill a template: a GPIO plus independent RTC/PIT implementation may leave the CPU clock unchanged and omit both `F_CPU` and delay headers under its reviewed recipe.

Use the installed device pack's register names, bit masks, field masks, enumeration values and vector names. Do not recreate their numeric definitions in the program. Give genuinely project-specific settings descriptive names. For example, `LED_PIN_bm` can alias the verified `PIN1_bm` when the selected LED is on port pin 1. Do not hide a hardware field behind an unexplained number, or add an extra macro for every register assignment without a readability benefit.

Check each configuration value against the actual allocation and hardware assumptions. A symbol that compiles can still select the wrong route, polarity, clock or period. Keep pin masks separate from physical package pin numbers, and make units visible in arithmetic and descriptive names.

## File structure and functions

Keep a clear order: project information when available; required headers and configuration constants; shared state and helper functions; interrupt handlers; then `int main(void)`. Function prototypes may be used where the implementation benefits from them. Keep one definition of `main()` and one handler per allocated vector when combining examples. Place file-local helpers and state at the narrowest practical scope; the colleague's `static` helper functions are a suitable pattern for a single-source project.

Group related statements, separate independent initialization stages with a blank line, and avoid excessive empty scaffolding. A short operation of a few lines can remain directly in its relevant initialization or main-loop block when a wrapper would add no meaning. Extract a function when it names a useful operation or keeps the control flow understandable; a fixed line-count limit is not required.

Existing user code is functional input. Preserve code unrelated to the requested change and inspect any ownership boundaries before moving it. The imported example's `//+`, `//-` and `//X` comments are legacy source conventions, not commands for the server agent. Do not introduce that command language or empty AI/user regions into newly generated code. Use the server's normal source/guide heading mechanism and stable filenames.

## Initialization and synchronization

Choose the smallest reviewed mechanism that meets the behavior, then identify its pin, route, clock, interrupt and shared-state dependencies before writing setup code. Configure a safe output latch level before enabling its output driver. For an active-low LED this normally means setting the latch high before setting the direction bit; verify the selected pin and circuit rather than copying the example's `PORTB` and `PIN1_bm` blindly.

A known reset value may remove a redundant write only when initialization is explicitly once after reset and the value has been checked in the applicable documentation. The precondition includes the absence of earlier code that could have changed the register. A callable reinitialization routine must establish the state it depends on. Do not silently turn a boot-only recipe into a runtime reset/reconfiguration procedure.

Where the peripheral requires a busy check or synchronization wait, keep the relevant wait/write sequence visually together. Separate it from unrelated register operations. The formatting pattern is:

```c
while ((PERIPHERAL.STATUS & REGISTER_BUSY_bm) != 0u) {}
PERIPHERAL.REGISTER = required_value;
while ((PERIPHERAL.STATUS & REGISTER_BUSY_bm) != 0u) {}
```

This is pseudocode for layout, not a register recipe. Do not generate these placeholder symbols. Add the pre-write wait, post-write wait or both only when the selected register's reviewed sequence requires them, and use its exact status register and busy mask. A wait with no useful body may use `{}` on one line. Never apply the RTC/PIT busy mask to another peripheral by analogy. Document any wait that can prevent startup if a required hardware condition never arrives.

## Main flow and interrupts

Keep one-time setup before the main loop. Initialization should not contain a second application loop that prevents the rest of startup from executing. Necessary peripheral synchronization waits follow the relevant recipe and are distinct from such an application loop. Prepare output state, peripheral configuration and ISR-shared state before the single startup `sei()` when interrupts are used. Do not enable global interrupts inside a helper that leaves other initialization unfinished. A project with no interrupt source does not need `sei()` merely because a template contains it.

Use the main loop for recurring application work. It may be empty when the complete requested behavior is handled by an approved interrupt mechanism. Do not add a nested endless loop that starves the other tasks in the main loop, and do not put functional work after an unconditional main loop. Assess the effect of any blocking operation on the other requested work; an educational polling example is not automatically safe in a composed application.

Keep each ISR focused on servicing its source and performing the short action or publishing state required by the design. Follow the peripheral's flag semantics: a write-one-to-clear flag is acknowledged by assigning the intended mask, never by a read-modify-write `|=`. In the reviewed LED/PIT pattern the handler acknowledges the PIT event and uses the GPIO hardware toggle register. Do not infer that every peripheral has the same acknowledgement order or toggle operation. For communication buffers or event handoff, also load the applicable interrupt methodology; `volatile` alone is not a complete ownership or atomicity design.

## Sources

- `Knowledge_Base/AVR_Programming_General_Rules.md`, lines 5–11, 19–31 and 45–51.
- `Target_Projects/Base_project_rules.md`, lines 151–256, adapted from its initial-project and legacy-region conventions.
- `Target_Projects/Project_One/Project_One.c`, lines 4–60; `Project_One (description).md`, lines 30–127.
- `Project_Rules/Project_Description.md`, lines 58–81, used only to identify and exclude the legacy command-marker mechanism.
