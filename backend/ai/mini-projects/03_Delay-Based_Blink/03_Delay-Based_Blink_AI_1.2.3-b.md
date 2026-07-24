# 03_Delay-Based_Blink

## File Version

Version 1.2.3-b

## AI Summary

This mini-project demonstrates continuous LED blinking on `PB1` by toggling the GPIO output inside the main loop and using `_delay_ms(500)` as a blocking software delay. It provides a simple reusable pattern for GPIO output initialization, output toggling, and basic hardware verification.

## Used Hardware

- An AVR microcontroller that provides the `PORTB` peripheral and `PB1`.
- One LED.
- One series current-limiting resistor from `1 kΩ` to `3 kΩ`.
- For the ATtiny1624 in a SOIC-14 package, `PB1` is pin 8.

## Tested Hardware

- `ATtiny1624`, SOIC-14

## Used Peripherals

- GPIO peripheral: `PORTB`.
- GPIO pin: `PB1`.
- Output register operations: `PORTB.OUTCLR`, `PORTB.DIRSET`, and `PORTB.OUTTGL`.
- CPU clock assumption: default frequency of approximately `3.333333 MHz`.
- Timers: none.
- Interrupts: none.

## Important Code to Preserve

- `#define F_CPU 3333333UL` must remain before `#include <util/delay.h>`.
- `F_CPU` must match the actual CPU frequency. An incorrect value produces incorrect software-delay durations.
- Compiler optimization must be enabled for accurate delay timing.
- Preserve the initialization order in which `PORTB.OUTCLR` is executed before `PORTB.DIRSET`. This sets the output level before the output driver is enabled.
- `PORTB.OUTTGL = PIN1_bm;` performs the output toggle without a read-modify-write sequence.

## Initialization Requirements

- If another module changes the CPU frequency, update `F_CPU` to match the resulting frequency before compiling.
- Configure `PB1` by setting the desired output level before enabling output mode.
- No timer or interrupt initialization is required.

## Integration Rules

When reusing the blinking behavior, transfer or adapt these elements together:

- the `F_CPU` definition;
- the `<util/delay.h>` include;
- the selected port and pin-mask definitions;
- the output-level and direction initialization;
- the toggle operation;
- the blocking delay call.

If another GPIO pin is selected, update all related port registers and pin masks consistently.

## Conflicts and Limitations

- The mini-project occupies `PB1` as a GPIO output.
- `_delay_ms()` blocks normal main-loop execution, so no other main-loop work can run during the delay.
- Delay accuracy depends on `F_CPU` matching the actual CPU clock and on compiler optimization being enabled.
- The mini-project does not use timers or interrupts, but its blocking behavior may interfere with code that requires continuous or timely processing.
