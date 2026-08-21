# 05_UART_Basic_Transmission

## File Version

Version 1.2.3-c

## Short Project Description

Basic UART0 byte transmission using polling and a blocking delay between transmitted bytes.

## Full Mini-Project Description

This mini-project initializes UART0 and transmits one byte approximately every 20 ms.

After each transmission, the byte value is incremented. After `255`, the `uint8_t` value automatically returns to `0`, producing a repeating sawtooth sequence from `0` to `255`.

The project uses polling-based UART transmission. Before writing to `USART0.TXDATAL`, the program waits until the transmit buffer can accept another byte.

The 20 ms interval is created by `_delay_ms(20)`, so the main loop is blocked during this delay.

UART format:

```text
115200 baud, 8 data bits, no parity, 1 stop bit
```

Common notation:

```text
115200 8N1
```

The transmitted data can be observed in the UART section of **uartdebug.com**.

## Hardware Requirements and Setup

The intended setup uses two USB-UART adapters:

- one adapter for UPDI programming;
- a second adapter for observing UART0 transmission.

The second adapter connections:

```text
Microcontroller PB2 / TxD  ->  USB-UART RxD
Microcontroller GND        ->  USB-UART GND
```

The microcontroller and the receiving USB-UART adapter should use the same logic voltage level.

For tinyAVR 2-series devices in SOIC-14 packages, `PB2` is pin 7.

The microcontroller’s `RxD` pin is not used. To observe transmission, connect only `TxD` and common `GND`.

## Quick Start

### Hardware Connection

Connect the first USB-UART adapter to the microcontroller for programming through the UPDI interface.

Connect the second USB-UART adapter to the microcontroller for observing the transmitted data.

### Port Selection

#### UPDI Programmer Adapter Port Selection

In one browser tab, open the AVR section of **uartdebug.com** for programming the microcontroller.

The figure shows that no port is selected initially.

![472](Pasted%20image%2020260726152153.png)

After clicking the `Disconnected` button, the port selection window appears.

Select the port of the first adapter connected to the microcontroller programming interface (UPDI).

![387](Pasted%20image%2020260726152302.png)

If the adapter is connected to the microcontroller correctly and you selected the correct port, after clicking the `Connection` button you will see approximately the following:

- the button displays `Connected`;
- the connected microcontroller name is displayed, in this example `ATtiny1624`;
- the name next to the button is the automatically detected microcontroller name and its descriptor, which is the chip code assigned by the manufacturer;
- the name next to the `Compile` button is the compiler option.

![466](Pasted%20image%2020260726152346.png)

#### UART Observation Adapter Port Selection

In another browser tab, open the UART section of **uartdebug.com** for observing the transmitted data.

The figure shows that no port is selected initially.

![668](Pasted%20image%2020260726152507.png)

After clicking the `Disconnected` button, the port selection window appears.

![355](Pasted%20image%2020260726152540.png)

Select the port of the second adapter connected to the microcontroller UART0 transmitter, and click the `Connection` button.

Note that this must be a different port number. In this example, the UPDI adapter uses `COM15`, while the second adapter used for UART observation uses `COM24`.

If everything works correctly, you will see approximately the following:

![501](Pasted%20image%2020260726152615.png)

The most important indication is `Connected` on the button. This means that the connection was successful.

The text `WCH CH343 ...` may be different on your computer. It depends on the USB-UART adapter manufacturer.

The default UART settings have the correct values for this project: `115200 8N1`.

Program the microcontroller with this project.

In the UART tab, observe the received data.

Recommended **uartdebug.com** modes:

- **Graphic → Unsigned → 1 byte** — repeating sawtooth waveform;
- **Data → HEX** — hexadecimal values from `00` to `FF`.

## What This Mini-Project Is For

This mini-project demonstrates:

- UART0 initialization;
- direct one-byte transmission;
- polling the transmit-buffer-ready flag;
- writing to `USART0.TXDATAL`;
- producing a repeating byte sequence;
- viewing raw UART data graphically and in HEX.

It is the simplest practical transmission test before interrupt-driven UART projects.

## Usage Options

You can:

- generate a transmitted data sequence different from the sawtooth sequence used in this project;
- select another supported standard baud rate; when changing the baud rate, also change the receive baud-rate setting in the UART section of **uartdebug.com**;
- use UART1 instead of UART0; this requires code changes and connection of the second adapter to another microcontroller output;
- change the CPU frequency as demonstrated in Project 02; update `F_CPU` in this project to match the new frequency.

## Common Mistakes

- Connecting `TxD` to adapter `TxD` instead of adapter `RxD`.
- Forgetting common `GND`.
- Using different logic voltage levels.
- Selecting the wrong COM port.
- Selecting the wrong baud rate.
- Forgetting that `_delay_ms(20)` blocks the main loop.

## Code Description

### Main Compiler Header

`#include <xc.h>` provides device-specific register and bit definitions for XC8.

### CPU Clock Definition

```c
#define F_CPU 3333333UL
```

`F_CPU` is used by the delay library and the UART baud-rate calculation.

With the factory clock settings, the CPU frequency is approximately 3.333 MHz.

This definition does not configure the hardware clock.

### Delay Library

```c
#include <util/delay.h>
```

This header provides `_delay_ms()` and `_delay_us()`.

`F_CPU` must be defined before including this header.

### User-Defined UART Parameters

```c
#define BAUD_RATE 115200UL
#define CLK_PER   F_CPU
```

`BAUD_RATE` is selected by the user.

`CLK_PER` is the peripheral clock used in the baud calculation. Here it equals `F_CPU`.

### USART Baud Register Calculation

```c
#define USART_BAUD_RATE     ((uint16_t)(((float)CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5))
```

This expression calculates the value written to `USART0.BAUD`.

The floating-point expression and `+ 0.5` round the result to the nearest integer.

### USART0 Initialization

`USART_Init()` configures UART0 before transmission.

#### UART Frame Format

The `USART0.CTRLC` assignment selects asynchronous mode, no parity, 8 data bits, and 1 stop bit: `8N1`.

#### USART Baud Rate Register

```c
USART0.BAUD = USART_BAUD_RATE;
```

This register configures the USART baud-rate generator. With the current clock and `BAUD_RATE` settings, it provides approximately 115200 baud.

#### UART0 TxD Pin Configuration

```c
PORTB.DIRSET = PIN2_bm;
```

PB2 is configured as the UART0 transmit output.

For tinyAVR 2-series devices in SOIC-14 packages, `PB2` is pin 7.

#### USART Transmitter Enable

```c
USART0.CTRLB = USART_TXEN_bm;
```

This enables the USART0 transmitter.

### UART1 Initialization Note

To convert the example to UART1:

1. Replace `USART0.` with `USART1.`.
2. Replace `PORTB.DIRSET = PIN2_bm;` with `PORTA.DIRSET = PIN1_bm;`.

For the intended SOIC-14 tinyAVR 2-series devices, UART1 `TxD` is `PA1`, pin 11.

### The Entry Point

`int main(void)` is the program entry point.

### Output Data Variable

```c
uint8_t out_data = 0;
```

This variable stores the next transmitted byte. After `255`, it automatically rolls over to `0`.

### USART0 Initialization Call

```c
USART_Init();
```

UART0 is configured before the main loop starts.

### Main Infinite Loop

The `while (1)` loop repeats the transmit sequence continuously.

### Data Register Empty Check

```c
while (!(USART0.STATUS & USART_DREIF_bm))
{
    ;
}
```

This polling loop waits until the transmit buffer can accept another byte.

At a 20 ms interval, the buffer is normally already ready, but the check keeps transmission safe if the interval is reduced.

### Byte Transmission

```c
USART0.TXDATAL = out_data;
```

This places one byte in the USART transmit buffer.

### Output Data Increment

```c
out_data++;
```

The transmitted sequence repeats from `0` through `255`.

### Transmission Interval

```c
_delay_ms(20);
```

This creates an interval of approximately 20 ms between bytes and blocks the main loop.

At `115200 8N1`, the physical transmission of one byte takes approximately 87 µs.

### Application Scope

This mini-project is intended for tinyAVR 2-series devices with compatible USART and pin-routing registers.

### Tested Hardware

- `ATtiny1624`, SOIC-14
