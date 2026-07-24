# 03_Delay-Based_Blink

## File Version

Version 1.2.3-b

## Short Project Description

LED blinking is the “Hello, World!” of microcontroller programming.

## What This Mini-Project Is For

This is the simplest project for visually confirming that a microcontroller is operating.

It can be used to confirm that the compiler, programmer, microcontroller, GPIO output, and external LED circuit are working correctly.

It also introduces GPIO output control and the blocking delay functions `_delay_ms()` and `_delay_us()`.

## Code Description

### Main Compiler Header

`#include <xc.h>` provides the device-specific definitions used by the XC8 compiler.

### CPU Clock Definition

```c
#define F_CPU 3333333UL
```

`F_CPU` tells the delay library that the CPU clock frequency is `3,333,333 Hz`.

This value corresponds to the default clock configuration:

```text
20 MHz / 6 = 3.333333 MHz
```

`F_CPU` does not change the CPU frequency. It must match the actual CPU frequency so that the delay library can calculate the software delays correctly.

If the CPU clock is changed, the `F_CPU` value must also be updated.

### Delay Library

```c
#include <util/delay.h>
```

This header provides the blocking delay functions `_delay_ms()` and `_delay_us()`.

The `F_CPU` definition must appear before this header is included.


### The Entry Point

`int main(void)` is the program entry point.

### Configure PB1 as an Output

```c
PORTB.OUTCLR = PIN1_bm;
PORTB.DIRSET = PIN1_bm;
```

The first instruction sets the `PB1` output level low.

The second instruction enables output mode for `PB1`.

Setting the output level before enabling the output driver helps prevent an unwanted pulse on the pin. This can be especially important when the pin controls external switching components such as MOSFET gates.

### Main Infinite Loop

The infinite loop repeatedly toggles `PB1` and then waits for the blocking delay to finish.

### Toggle the LED

```c
PORTB.OUTTGL = PIN1_bm;
```

This instruction toggles the `PB1` output state without first reading its current state.

Each execution changes the LED from on to off or from off to on.

### Software Delay

```c
_delay_ms(500);
```

This function creates a blocking delay of approximately `500 ms` when `F_CPU` matches the actual CPU frequency.

During the delay, the program cannot execute other code in the main loop.

Blocking delays are convenient for simple demonstration programs. Applications that must perform other work during the waiting period normally use hardware timers or timer interrupts.

### This Code Is Never Reached

The `return 0;` statement is not reached during normal operation because execution remains inside the infinite loop. It is included to prevent a compiler warning.

## Full Mini-Project Description

This mini-project continuously blinks an LED connected to `PB1`.

After startup, the program first sets the output level low and then configures `PB1` as an output.

Inside the infinite loop, the program toggles `PB1` and waits for `500 ms`. Because the pin changes state once every `500 ms`, one complete on-and-off blinking cycle takes approximately one second.

The delay is produced entirely by software and blocks normal main-loop execution while it is active.

## Hardware Requirements and Setup

Connect an LED and a current-limiting resistor in series between `PB1` and ground:

```text
PB1 --------[1 kΩ to 3 kΩ]--------|>|-------- GND
                                   LED
```

The LED polarity must be correct. The anode connects toward `PB1`, and the cathode connects toward ground.

A resistor from `1 kΩ` to `3 kΩ` may be used. A lower resistance produces a brighter LED and a higher current. A higher resistance reduces both brightness and current consumption.

For the ATtiny1624 in a SOIC-14 package, `PB1` is pin 8.

## Quick Start

1. Connect the LED and its series resistor to `PB1` as shown above.
2. Flash the `03_Delay-Based_Blink` mini-project to the microcontroller.
3. Observe the LED.

The LED should remain on for approximately `500 ms`, remain off for approximately `500 ms`, and repeat continuously.

Continuous blinking confirms that the microcontroller is executing the program and controlling `PB1`.

## Observing Project Operation

The LED provides the simplest visible indication of project operation.

The `PB1` waveform may also be observed with an oscilloscope or logic analyzer. The output changes state every `500 ms`.

## Usage Options

You can change the argument passed to `_delay_ms()` to change the blinking speed.

For example:

```c
_delay_ms(100);
```

produces a faster blink, while:

```c
_delay_ms(1000);
```

keeps each output state for approximately one second.

You can also replace `PB1` with another available GPIO pin by changing the port and pin-mask register references together.

You can use the `_delay_us()` function for microsecond delays. However, the changes at the microcontroller pin will be too fast to see directly and normally require an oscilloscope or logic analyzer for observation.

### Application Scope

The source mini-project uses the modern AVR `PORT` peripheral register interface and assumes the default CPU frequency of approximately `3.333 MHz`.

### Tested Hardware

The mini-project was tested on the following microcontroller:

- `ATtiny1624`, SOIC-14
