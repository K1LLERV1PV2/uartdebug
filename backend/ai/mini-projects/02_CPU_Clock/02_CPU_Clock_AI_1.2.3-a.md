# 02_CPU_Clock

## File Version

Version 1.2.3-a

## AI Summary

This mini-project provides three reusable initialization functions for selecting a 20 MHz or 10 MHz CPU and peripheral clock. One 20 MHz option also enables the system clock output on `PB5`. Protected clock registers are written with the XC8 `_PROTECTED_WRITE()` macro. The functions are intended to be copied or integrated as early system-initialization components.

## Used Hardware

- AVR 0/1-series microcontroller with clock-control registers compatible with the source code.
- Internal 20 MHz oscillator.
- Optional oscilloscope or frequency counter for observing the system clock output.
- Optional `PB5` connection when the selected package supports system clock output.

No exact tested microcontroller model or package is identified in the old source material.

## Used Peripherals

- Clock controller: `CLKCTRL`.
- Clock source: internal 20 MHz oscillator selected with `CLKCTRL_CLKSEL_OSC20M_gc`.
- Clock prescaler: `CLKCTRL.MCLKCTRLB`.
- Optional system clock output: `PB5`, enabled with `CLKCTRL_CLKOUT_bm`.
- Timers: none.
- USART instances: none.
- ADC: none.
- Interrupts: none.

## Important Code to Preserve

- `CPU_Max_Clock_20MHz_Out()`  
  Preserve both protected writes. The first selects the oscillator and enables clock output; the second disables the prescaler.

- `CPU_Max_Clock_20MHz_NoOutputSignal()`  
  Preserve both protected writes. The first selects the oscillator; the second disables the prescaler.

- `CPU_Clock_10MHz_NoOutputSignal()`  
  Preserve the oscillator selection and the prescaler configuration using `CLKCTRL_PDIV_2X_gc | CLKCTRL_PEN_bm`.

- `_PROTECTED_WRITE()`  
  Protected clock-control registers must not be replaced with ordinary register assignments without a confirmed compiler- and device-appropriate protected-write mechanism.

- Clock selection in `main()`  
  Only one of the three clock configuration functions should be called during initialization.

## Initialization Requirements

- Call the selected clock configuration function near the beginning of `main()`.
- Configure the clock before initializing peripherals whose baud rates, timer periods, delays, or other settings depend on the CPU or peripheral clock.
- Call only one clock configuration function.
- If no function is called, the old source states that the default clock remains 20 MHz divided by 6, or approximately 3.333 MHz.
- No interrupt initialization is required.

## Integration Rules

When reusing one clock option, copy the complete selected function and preserve its `_PROTECTED_WRITE()` operations.

Choose one of these functions:

- `CPU_Max_Clock_20MHz_Out()`;
- `CPU_Max_Clock_20MHz_NoOutputSignal()`;
- `CPU_Clock_10MHz_NoOutputSignal()`.

Call the selected function before other clock-dependent peripheral initialization.

When integrating `CPU_Max_Clock_20MHz_Out()`, confirm that the receiving microcontroller package supports the `PB5` system clock output.

The source code is written for XC8 and includes `<xc.h>`. The old combined file mentioned `<avr/io.h>` as an alternative header, but did not provide an AVR-GCC replacement for `_PROTECTED_WRITE()`. Direct AVR-GCC compatibility is therefore not confirmed by the supplied material.

## Conflicts and Limitations

- The selected function changes the CPU and peripheral clock globally. Existing peripheral timing calculations must match the selected frequency.
- Call only one clock configuration function during initialization.
- System clock output on `PB5` is not available on small 14-pin packages according to the old source material.
- `PB5` cannot be used independently by another function while it is assigned as the system clock output.
- The code depends on device definitions that provide `CLKCTRL`, the referenced bit masks, and `_PROTECTED_WRITE()`.
- No exact tested microcontroller or package is documented.
- The mini-project does not reserve timers, USART instances, ADC resources, or interrupt vectors.
