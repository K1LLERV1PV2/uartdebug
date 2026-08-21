# 04_Timer_Interrupt_Blink

## File Version

Version 1.2.3-d

## AI Summary

This mini-project configures TCA0 in normal 16-bit mode to generate an overflow interrupt approximately every 0.5 seconds.

`ISR(TCA0_OVF_vect)` toggles PB1 and clears the TCA0 overflow interrupt flag. The main loop remains available for application code between interrupts.

The module is a reusable example of periodic interrupt-driven execution without a blocking software delay.

## Used Hardware

- AVR microcontroller with a compatible TCA0 peripheral and register interface.
- GPIO output `PB1`.
- LED and current-limiting resistor connected to `PB1`.

For the tested ATtiny1624 in a SOIC-14 package, `PB1` is pin 8.

## Tested Hardware

- `ATtiny1624`, SOIC-14

## Used Peripherals

- Timer/counter instance: `TCA0`.
- TCA operating mode: SINGLE 16-bit normal mode.
- Interrupt source: TCA0 overflow.
- Interrupt vector: `TCA0_OVF_vect`.
- GPIO resource: `PB1`.
- Global interrupt enable through `sei()`.

## Important Code to Preserve

- `TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;`  
  Preserve the write-one-to-clear operation inside `ISR(TCA0_OVF_vect)`. If it is removed, the interrupt request may remain active and cause immediate repeated ISR entry.

- `TCA_PRESCALER` and `TCA_SINGLE_CLKSEL_DIV1024_gc`  
  These values must represent the same timer clock divider.

- `F_CPU`  
  It must represent the CPU frequency assumed by the timer-period calculation. With the factory clock settings used by this mini-project, the value is `3333333UL`.

- `TCA_PER_VALUE`  
  The calculated value must fit in the 16-bit `TCA0.SINGLE.PER` register. When parameters are changed substantially, intermediate arithmetic must also remain within its supported range.

- `sei()`  
  Global interrupts must be enabled after GPIO and TCA0 initialization.

## Initialization Requirements

Use this initialization order:

1. Set the initial PB1 output level.
2. Configure PB1 as an output.
3. Call `Init_TCA()`.
4. Call `sei()`.
5. Enter the main loop.

`Init_TCA()`:

- selects normal counting mode;
- enables the TCA0 overflow interrupt;
- writes `TCA_PER_VALUE` to `TCA0.SINGLE.PER`;
- selects the divide-by-1024 timer clock;
- enables TCA0.

## Integration Rules

When reusing the timer mechanism, transfer or adapt together:

- `F_CPU`;
- `TCA_PRESCALER`;
- `TCA_PERIOD_US`;
- `TCA_PER_VALUE`;
- `Init_TCA()`;
- `ISR(TCA0_OVF_vect)`;
- the call to `sei()`.

When PB1 blinking is not required, replace the ISR action:

```c
PORTB.OUTTGL = PIN1_bm;
```

Preserve the overflow-flag reset:

```c
TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;
```

Keep ISR work short and deterministic. Move lengthy processing to the main loop when practical.

Main-loop code may block the main loop, but it must not disable global interrupts if periodic ISR execution must continue.

## Conflicts and Limitations

- Another module cannot independently configure TCA0 without merging the configurations.
- Another definition of `ISR(TCA0_OVF_vect)` will conflict with this mini-project.
- PB1 cannot be independently controlled by another module while it is used for LED toggling.
- The timer period is quantized to whole timer counts.
- Integer arithmetic may introduce a small period error.
- `TCA_PER_VALUE` must fit in the 16-bit `PER` register.
- Intermediate arithmetic may overflow when parameters are changed substantially.
- The main loop and ISR do not execute simultaneously on the CPU. The ISR temporarily preempts the main-loop code.
- Excessive ISR execution time reduces the time available to the main loop.
- Compatibility is limited to AVR devices with a compatible TCA0 peripheral and register interface.

## Possible Extensions

- Change the interrupt interval.
- Use another GPIO output.
- Replace the LED toggle with another short periodic action.
- Set a flag in the ISR and process it in the main loop.
- Combine periodic timer interrupts with UART or ADC processing.
- Add a controlled runtime update of the timer period.
