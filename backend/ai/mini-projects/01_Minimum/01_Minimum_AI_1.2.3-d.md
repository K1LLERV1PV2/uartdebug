# 01_Minimum

## File Version

Version 1.2.3-d

## AI Summary

This mini-project provides a minimal standalone AVR C program. It contains the program entry point, an empty initialization area, and a main infinite loop without configuring or controlling any application peripherals. It can be reused as a clean base for generating a new AVR project or as a minimal program for replacing the behavior of a previously flashed project.

## Used Hardware

- An AVR 1-series or 2-series microcontroller compatible with the selected compiler and device configuration.
- A USB-UART adapter used as an UPDI programmer.
- A `1 kΩ` resistor between `TXD` and the shared UPDI line.
- A common ground connection between the USB-UART adapter and the microcontroller.
- A `+5 V` connection from the USB-UART adapter to the microcontroller `VCC` pin when the adapter is used to power the target.

The USB-UART signal voltage and power-output capability must be suitable for the connected microcontroller and external circuit.

## Tested Hardware

- `ATtiny1624`, SOIC-14

## Used Peripherals

The application code does not configure or use GPIO, timers, UART, ADC, interrupts, or other application peripherals.

The UPDI interface is used only to flash the microcontroller. For tinyAVR 2-series devices, UPDI is normally located on `PA0`.

## Important Code to Preserve

- Preserve exactly one `main()` function in the complete program.
- Keep the active compiler header consistent with the selected toolchain.
- Preserve the `while (1)` loop unless the program execution model is intentionally changed.
- Do not place required runtime code after the infinite loop.
- Keep every linked section marker synchronized with the corresponding heading in `_help.md` or `_AI.md`.

## Initialization Requirements

No application peripheral initialization is required.

The build environment must select the correct AVR device and compiler before compilation. Future one-time initialization code must be placed before the main infinite loop.

## Integration Rules

- Add global declarations, definitions, macros, and variables before `main()`.
- Add one-time initialization code before `while (1)`.
- Add repeated runtime code inside `while (1)`.
- If the receiving project already contains `main()`, merge the required code into the existing function instead of adding a second `main()`.
- Transfer all dependencies required by added functionality, including initialization code, global state, macros, functions, and interrupt service routines.
- When switching from XC8 to AVR-GCC, replace `#include <xc.h>` with `#include <avr/io.h>` and verify all compiler-specific code.

## Conflicts and Limitations

- The project produces no visible hardware response.
- Successful compilation and flashing confirm the basic workflow, but they do not verify any application peripheral.
- A blocking operation inside the main loop prevents later code in that loop from running until the operation finishes.
- Only one `main()` function may exist in the final program.
- Code placed after the infinite loop is not reached during normal operation.
- Compatibility with a specific AVR device is not confirmed until the project is compiled and flashed for that device.
- Supplying the target from the USB-UART adapter requires matching voltage levels and sufficient current capability.

## Possible Extensions

- Add explicit CPU clock configuration.
- Configure a GPIO output.
- Add timer, UART, ADC, or interrupt initialization.
- Use the mini-project as the base for a hardware-specific experiment.

## Code-Linked Component Descriptions

### Main Compiler Header

`#include <xc.h>` selects the device definitions provided by XC8. When using AVR-GCC, replace it with `#include <avr/io.h>` and verify compiler-specific differences.

### Your Global Data Can Be Placed Here

This location may contain file-scope declarations and definitions that must be available to `main()` and other functions.

### The Entry Point

`int main(void)` is the only program entry point in this mini-project.

### Your Initialization Code Can Be Placed Here

Code placed here runs once before the main infinite loop begins.

### Main Infinite Loop

The `while (1)` loop keeps normal program execution inside `main()` and repeatedly executes any code placed in its body.

### Your Repeated Code Can Be Placed Here

Code placed here runs repeatedly. Blocking operations delay all code that follows them in the same loop iteration.

### This Code Is Never Reached

`return 0;` is located after the infinite loop and is not reached during normal operation.
