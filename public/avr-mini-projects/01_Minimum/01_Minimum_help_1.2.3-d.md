# 01_Minimum

## File Version

Version 1.2.3-d

## Short Project Description

Minimal AVR project that can be used as the basis for your code.

## What This Mini-Project Is For

This mini-project can be your first step in working with the UartDebug.com website.

It can also serve as the initial template for your own code.

Later, you can flash this mini-project to replace the activity of another project with a minimal program that does not configure or control any peripherals.

## Code Description

### Main Compiler Header

`#include <xc.h>` is the default main header. This header is used with the XC8 compiler in MPLAB X IDE.

`#include <avr/io.h>` is an alternative header. This header is used with the AVR-GCC compiler.

### Your Global Data Can Be Placed Here

This is where you can place your global data and declarations.

For example:

- `#include` directives;
- `#define` directives;
- function declarations and definitions;
- global variables;
- and other global program elements.

### The Entry Point

`int main(void)` is the program entry point.

`int` is the function return type. It corresponds to the `return 0;` statement at the end of the function body.

### Your Initialization Code Can Be Placed Here

This is where you can place initialization code that must run once before the main loop begins.

### Main Infinite Loop

This loop keeps program execution inside `main()`.

The main infinite loop ensures predictable microcontroller behavior.

### Your Repeated Code Can Be Placed Here

This is where you can place code that must run repeatedly.

A blocking operation placed here prevents other code in the same loop from running until that operation finishes.

### This Code Is Never Reached

This statement is never reached during normal operation because program execution remains inside the infinite loop. It is included to prevent a compiler warning.

## Full Mini-Project Description

This mini-project contains the minimum code that can be compiled and flashed to a microcontroller.

Program execution begins with the function:

```c
int main(void)
```

After program execution starts and before the infinite loop begins, you can place your initialization code. This code runs once.

The `while (1)` infinite loop then begins. You can place code that must run repeatedly inside this loop.

If the loop contains no code, it acts as a trap that keeps program execution inside `main()`.

During normal operation, program execution never leaves this infinite loop.

## Hardware Requirements and Setup

The only requirement for this project is the correct connection of the USB-UART adapter to the microcontroller's UPDI interface.

```text
USB-UART                         Microcontroller

+5V ---------------------------- VCC

TXD -------[1 kΩ]----+
                      +--------- UPDI
RXD -----------------+

GND ---------------------------- GND
```

For tinyAVR 2-series microcontrollers, the UPDI signal is `PA0`.

For the SOIC-14 package, the UPDI signal is on pin 10.

The resistor value can be from `1 kΩ` to `3 kΩ`.

After the programmer is connected to the microcontroller, this and other mini-projects can be flashed. No additional hardware is required for this mini-project.

## Quick Start

Open the AVR section of the UartDebug.com website.

In the upper-left corner, click the `Disconnected` button. A window showing the computer's COM ports will open.

Connect the programmer to the computer.

The name of the virtual COM port will appear at the bottom of the list. Select it.

![403](Pasted%20image%2020260720202929.png)

If everything is connected correctly, the `Chip` line will display the name of the microcontroller that can be flashed.

![320](Pasted%20image%2020260720203447.png)

Click the `+` button and select the `01_Minimum` mini-project.

![622](Pasted%20image%2020260720203718.png)

Click the `Flash` button.

If flashing completes successfully, `OK` will appear at the bottom of the message window.

![244](Pasted%20image%2020260720203813.png)

## Observing Project Operation

This project produces no visible response from the microcontroller.

Its main purpose is to practice working with the UartDebug.com website.

## Usage Options

You can add your own code to this mini-project.

You can replace `#include <xc.h>` with `#include <avr/io.h>` if you want to use this project later with the AVR-GCC compiler.

You can intentionally make a syntax error in the code and observe how the UartDebug website responds.

### Application Scope

This mini-project can be used with AVR 1-series and 2-series microcontrollers.

### Tested Hardware

- `ATtiny1624`, SOIC-14
