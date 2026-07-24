# 02_CPU_Clock

## File Version

Version 1.2.3-b

## Short Project Description

CPU clock configuration examples for 20 MHz, 10 MHz and so on.

## What This Mini-Project Is For

This mini-project demonstrates how to change the default CPU clock frequency on tinyAVR 2-series microcontrollers.

It also demonstrates how to modify protected clock-control registers with the `_PROTECTED_WRITE()` macro.

You can use one of the included functions as the clock-initialization part of another mini-project.

## Code Description

### Main Compiler Header

`#include <xc.h>` provides the device-specific definitions used by the XC8 compiler.
The clock configuration functions in this mini-project use the XC8 `_PROTECTED_WRITE()` macro.

The `_PROTECTED_WRITE()` macro performs the Configuration Change Protection (CCP) write sequence required for modifying protected registers.

The CPU clock control registers used to change the CPU frequency are protected by CCP. Therefore, changing the CPU frequency requires the use of this mechanism.

### 20 MHz Clock With PB5 Output

`CPU_Max_Clock_20MHz_Out()` selects the internal 20 MHz oscillator, enables the system clock output, and disables the clock prescaler.
The CPU and peripheral clock frequency becomes 20 MHz.
The system clock is output on `PB5` when the selected microcontroller package supports this function.
For packages with fewer than 20 pins, such as SOIC-14, the clock signal is not available at an external pin. Therefore, this function serves no practical purpose for such packages.

The function variant that outputs the system clock to an external pin allows you to use an oscilloscope to verify that the specified CPU frequency has actually been set.
It also allows the CPU clock signal to be provided to other circuits in the system.

### 20 MHz Clock Without Output

`CPU_Max_Clock_20MHz_NoOutputSignal()` selects the internal 20 MHz oscillator and disables the clock prescaler.
The CPU and peripheral clock frequency becomes 20 MHz. No system clock output is enabled.
This function sets the CPU to its maximum frequency.

### 10 MHz Clock Without Output

`CPU_Clock_10MHz_NoOutputSignal()` selects the internal 20 MHz oscillator and enables division by 2.

The CPU and peripheral clock frequency becomes:

```text
20 MHz / 2 = 10 MHz
```

### The Entry Point

`int main(void)` is the program entry point.

### CPU Clock Selection

The supplied program calls:

```c
CPU_Max_Clock_20MHz_NoOutputSignal();
```

This selects the 20 MHz clock without enabling the system clock output.

Call only one clock configuration function. The clock must be configured before peripherals whose settings depend on the CPU or peripheral clock.

If no clock configuration function is called, the default frequency remains:

```text
20 MHz / 6 = 3.333 MHz
```

### Your Initialization Code Can Be Placed Here

You can place your code for other initialization tasks here.

### Main Infinite Loop

The main loop keeps program execution inside `main()` after the clock has been configured.

### Your Repeated Code Can Be Placed Here

This is where you can place code that must run repeatedly.

### This Code Is Never Reached

This statement is never reached during normal operation because program execution remains inside the infinite loop. It is included to prevent a compiler warning.

## Full Mini-Project Description

This mini-project contains three independent clock configuration functions:

| Function | CPU and Peripheral Clock | System Clock Output |
|---|---:|---|
| `CPU_Max_Clock_20MHz_Out()` | 20 MHz | `PB5` |
| `CPU_Max_Clock_20MHz_NoOutputSignal()` | 20 MHz | None |
| `CPU_Clock_10MHz_NoOutputSignal()` | 10 MHz | None |

The supplied program uses `CPU_Max_Clock_20MHz_NoOutputSignal()`.

The `_PROTECTED_WRITE()` macro is used because the clock-control registers are protected by Configuration Change Protection.

If no clock initialization function is used, the default CPU frequency is:

```text
20 MHz / 6 = 3.333333 MHz
```

Programs that use the default frequency often define the CPU frequency for functions that depend on it as follows:

```c
#define F_CPU 3333333UL
```

When another CPU frequency is selected, the value must be changed accordingly. For example, use the following definition for 20 MHz:

```c
#define F_CPU 20000000UL
```

The `F_CPU` definition does not configure the CPU clock. It tells program code and library functions which CPU frequency is being used.

## Hardware Requirements and Setup

No additional hardware is required to run the mini-project.

The USB-UART to UPDI connection is described in the `01_Minimum` mini-project.

An oscilloscope or frequency counter is required only when you want to observe the system clock output produced by `CPU_Max_Clock_20MHz_Out()`.

Connect the measurement input to `PB5` and connect the instrument ground to the microcontroller ground.

System clock output on `PB5` is not available on small 14-pin packages. Use one of the functions without clock output when the selected package does not support this signal.

## Quick Start

The quick-start procedure for this mini-project is the same as for the `01_Minimum` mini-project.

When `CPU_Max_Clock_20MHz_Out()` is used, you can observe the system clock signal on `PB5` with an oscilloscope.

## Observing Project Operation

When a function without system clock output is used, the mini-project produces no visible response.

When `CPU_Max_Clock_20MHz_Out()` is used, you can observe the system clock signal on `PB5` with an oscilloscope.

## Usage Options

To use a different included configuration, replace the function call in `main()` with one of these calls:

```c
CPU_Max_Clock_20MHz_Out();
```

This function outputs the 20 MHz system clock signal on `PB5` when the selected package supports this output.

You can also configure the CPU and peripheral clock frequency to 10 MHz:

```c
CPU_Clock_10MHz_NoOutputSignal();
```

If no clock configuration function is used, the CPU frequency remains at its default value of 3.333333 MHz.

Call only one clock configuration function during initialization.

Other prescaler values available in the source device definitions may include:

```text
CLKCTRL_PDIV_2X_gc     divide by 2
CLKCTRL_PDIV_4X_gc     divide by 4
CLKCTRL_PDIV_6X_gc     divide by 6
CLKCTRL_PDIV_10X_gc    divide by 10
CLKCTRL_PDIV_16X_gc    divide by 16
```

### Application Scope

This mini-project is intended for tinyAVR 2-series microcontrollers with a compatible `CLKCTRL` peripheral and register definitions.

The same clock-control interface may exist in other modern AVR families, but compatibility with those devices is not confirmed by this mini-project.

### Tested Hardware

The functions without system clock output were tested on:

- `ATtiny1624`, SOIC-14
