# 04_Timer_Interrupt_Blink

## File Version

Version 1.2.3-d

## Short Project Description

Non-blocking LED blinking using periodic TCA0 overflow interrupts.

## Full Mini-Project Description

This mini-project configures the 16-bit TCA0 timer to generate an overflow interrupt approximately every 0.5 seconds.

Inside the interrupt service routine, PB1 is toggled. An LED connected to PB1 therefore changes state at every interrupt. One complete on-and-off blink cycle takes approximately 1 second.

Unlike the delay-based implementation in Mini-Project 03, this program does not keep the main loop inside a software delay. The main loop remains available for application code, although it is briefly interrupted whenever the timer ISR runs.

### User-Defined Timer Parameters

`F_CPU` specifies the CPU frequency used in the timer-period calculation. With the factory clock settings, this value is `3333333UL`, or approximately 3.333 MHz. This definition does not configure the hardware clock.

`TCA_PRESCALER` is the numeric timer clock division factor selected by the user. It must be one of the divider values supported by TCA0. Choose it so that the calculated `TCA_PER_VALUE` fits in the 16-bit `PER` register. An excessively small `TCA_PER_VALUE` reduces the available timing resolution.

`TCA_PERIOD_US` is the required timer interrupt interval in microseconds. This value is selected by the user.

`TCA_PER_VALUE` is the value written to the timer period register. In this mini-project, it is calculated automatically from `F_CPU`, `TCA_PRESCALER`, and `TCA_PERIOD_US`.

With the selected parameters, the actual interrupt interval is approximately `0.4998 s`.

## Hardware Requirements and Setup

An LED and a suitable current-limiting resistor are required.

Connect the LED circuit to `PB1` using wiring appropriate for the selected LED polarity.

For the ATtiny1624 in a SOIC-14 package, `PB1` is pin 8.

## Quick Start

1. Connect an LED and current-limiting resistor to `PB1`.
2. Compile and flash the mini-project.
3. Observe the LED.
4. The LED should change state approximately every 0.5 seconds.
5. A full blink cycle should take approximately 1 second.

Correct operation confirms that TCA0, the overflow interrupt, the ISR, global interrupts, and the PB1 output are working together.

For the ATtiny1624 in a SOIC-14 package, connect the LED circuit to pin 8 (`PB1`).

## What This Mini-Project Is For

This mini-project demonstrates:

- periodic timer interrupts using TCA0;
- non-blocking timing;
- interrupt service routine structure;
- GPIO control from an ISR;
- enabling global interrupts with `sei()`;
- keeping the main loop available for other work.

It can serve as a starting point for periodic background tasks that do not require a blocking software delay.

## Usage Options

You can:

- change `TCA_PERIOD_US` to select another interrupt period;
- select another supported TCA prescaler;
- move the output to another GPIO pin;
- replace the LED toggle with another short periodic operation;
- add application code to the main loop, including code that blocks the main loop, provided that it does not disable global interrupts.

When the CPU clock changes, update `F_CPU`.

Keep interrupt service routines short. Avoid blocking delays and long calculations inside the ISR.

## Code Description

### Main Compiler Header

`#include <xc.h>` provides the device-specific register and bit definitions used by the XC8 compiler.

### Interrupt Header

```c
#include <avr/interrupt.h>
```

This header provides the `ISR()` macro and the `sei()` function.

### CPU Clock Definition

```c
#define F_CPU 3333333UL
```

`F_CPU` specifies the CPU frequency used in the timer-period calculation. With the factory clock settings, this value is `3333333UL`, or approximately 3.333 MHz.

This definition does not configure the hardware clock.

### Timer Configuration Parameters

```c
#define TCA_PRESCALER 1024UL
#define TCA_PERIOD_US 500000UL
```

`TCA_PRESCALER` is the numeric value of the selected TCA0 clock divider.

`TCA_PERIOD_US` is the requested interrupt period in microseconds.

More details are provided in the **User-Defined Timer Parameters** section above.

### Timer Period Register Calculation

```c
#define TCA_PER_VALUE     ((uint16_t)(((F_CPU / TCA_PRESCALER) * TCA_PERIOD_US) / 1000000UL - 1UL))
```

This expression calculates the value written to the 16-bit TCA0 period register.

The result must fit in the 16-bit `PER` register.

Integer arithmetic quantizes the result to whole timer counts, so the actual period may differ slightly from the requested period.

With the values in this mini-project, the calculation is valid. When changing the parameters substantially, also ensure that the intermediate arithmetic remains within its supported range.

### TCA0 Initialization

`Init_TCA()`:

- selects normal counting mode;
- enables the TCA0 overflow interrupt;
- loads the calculated period value;
- selects the divide-by-1024 clock;
- starts TCA0.

The numeric `TCA_PRESCALER` definition and the hardware clock-selection constant must describe the same divider.

### TCA0 Overflow Interrupt

```c
ISR(TCA0_OVF_vect)
```

Place short code here that must run whenever the timer interrupt occurs.

In this mini-project, the only application action performed inside the ISR is toggling the PB1 output.

#### TCA0 Overflow Interrupt Flag Reset

The overflow interrupt flag is not cleared automatically. It must be cleared inside the ISR by writing `1` to the flag bit. Otherwise, the interrupt request may remain active and cause the ISR to be entered again immediately.

```c
TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;
```

Pay particular attention to this operation: a flag bit that is set to `1` is cleared by writing `1` to that bit.

### The Entry Point

`int main(void)` is the program entry point.

### PB1 Output Initialization

```c
PORTB.OUTCLR = PIN1_bm;
PORTB.DIRSET = PIN1_bm;
```

The output level is set low before PB1 is enabled as an output. This provides a defined initial output state.

### Timer Initialization

PB1 is configured before the timer starts because PB1 is toggled inside the timer ISR.

```c
Init_TCA();
```

After `Init_TCA()` returns, TCA0 is already running, but its interrupt cannot be serviced until global interrupts are enabled.

### Global Interrupt Initialization

Global interrupts must be enabled so that the TCA0 interrupt can be serviced.

```c
sei();
```

Call `sei()` after completing all initialization that enables interrupt sources.

### Main Infinite Loop

The `while (1)` loop keeps the program running continuously.

In this mini-project, the loop is empty because the periodic LED action is performed by the timer ISR.

Application code may be placed in the loop, including code that blocks the main loop. Enabled interrupts can still preempt that code, provided that it does not disable global interrupts.

The main-loop code and the ISR do not execute simultaneously on the CPU. When an interrupt occurs, the CPU temporarily suspends the main-loop code, executes the ISR, and then resumes the interrupted code.

### Main-Loop Application Code

Application code may be placed inside the main loop.

The timer ISR temporarily interrupts the main-loop code approximately every 0.5 seconds and then returns to it. The interruption normally lasts only a short time compared with the timer interval.

### This Code Is Never Reached

`return 0;` is not reached during normal operation because execution remains inside the infinite loop.

### Application Scope

This mini-project is intended for AVR microcontrollers with a compatible TCA0 peripheral and register interface.

### Tested Hardware

- `ATtiny1624`, SOIC-14
