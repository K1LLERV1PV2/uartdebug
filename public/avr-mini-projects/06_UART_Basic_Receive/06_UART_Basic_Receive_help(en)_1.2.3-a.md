# 06_UART_Basic_Receive

## File Version

Version 1.2.3-a

## Short Project Description

Basic UART0 byte reception and reply transmission using polling.

## Full Mini-Project Description

This mini-project initializes UART0 for two-way communication.

The microcontroller waits until one byte is received through UART0. It then reads the received byte, increments its value by `1`, waits until the transmit buffer can accept another byte, and sends the result back through UART0.

The project uses polling-based UART reception and transmission. The main loop is blocked while waiting for a received byte and can also wait until the transmitter is ready.

UART format:

```text
115200 baud, 8 data bits, no parity, 1 stop bit
```

Common notation:

```text
115200 8N1
```

The transmitted and received data can be observed in the UART section of **uartdebug.com**.

## Hardware Requirements and Setup

The intended setup uses two USB-UART adapters:

- one adapter for UPDI programming;
- a second adapter for two-way UART0 communication with the running program.

The second adapter connections:

```text
Microcontroller PB2 / TxD  ->  USB-UART RxD
Microcontroller PB3 / RxD  <-  USB-UART TxD
Microcontroller GND        ->  USB-UART GND
```

The microcontroller and the second USB-UART adapter should use the same logic voltage level.

For tinyAVR 2-series devices in SOIC-14 packages:

```text
PB2 / UART0 TxD  ->  pin 7
PB3 / UART0 RxD  ->  pin 6
```

Both `TxD` and `RxD` are required in this mini-project because data is transferred in both directions.

## Quick Start

### Hardware Connection

Connect the first USB-UART adapter to the microcontroller for programming through the UPDI interface.

Connect the second USB-UART adapter to the microcontroller for UART0 communication:

```text
PB2 / TxD  ->  USB-UART RxD
PB3 / RxD  <-  USB-UART TxD
GND        ->  USB-UART GND
```

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

#### UART Communication Adapter Port Selection

In another browser tab, open the UART section of **uartdebug.com** for communicating with the running program.

The figure shows that no port is selected initially.

![668](Pasted%20image%2020260726152507.png)

After clicking the `Disconnected` button, the port selection window appears.

![355](Pasted%20image%2020260726152540.png)

Select the port of the second adapter connected to UART0, and click the `Connection` button.

Note that this must be a different port number. In this example, the UPDI adapter uses `COM15`, while the second adapter used for UART communication uses `COM24`.

If everything works correctly, you will see approximately the following:

![501](Pasted%20image%2020260726152615.png)

The most important indication is `Connected` on the button. This means that the connection was successful.

The text `WCH CH343 ...` may be different on your computer. It depends on the USB-UART adapter manufacturer.

The default UART settings have the correct values for this project: `115200 8N1`.

Program the microcontroller with this project.

### Sending Test Data

In the UART section of **uartdebug.com**, transmit one byte.

The microcontroller receives the byte, increments its value by `1`, and sends the result back.

For example:

```text
Transmit: 100
Receive:  101
```

You can also use HEX mode. For example:

```text
Transmit: 64
Receive:  65
```

### Verification

If each transmitted byte is returned with its value increased by `1`, UART0 reception and transmission are working correctly.

This verifies:

- UART0 reception;
- UART0 transmission;
- `TxD` and `RxD` hardware connections;
- two-way UART communication.

## What This Mini-Project Is For

This mini-project demonstrates:

- UART0 initialization for both reception and transmission;
- polling the receive-complete flag;
- reading one byte from `USART0.RXDATAL`;
- polling the transmit-buffer-ready flag;
- writing one byte to `USART0.TXDATAL`;
- the simplest blocking two-way UART communication.

It is the natural next step after Project 05, which demonstrates UART transmission only.

## Usage Options

You can:

- send different byte values and observe the returned result;
- use HEX mode to observe raw byte values;
- change `received_byte + 1` to another simple operation, such as `received_byte + 2`;
- select another supported standard baud rate; when changing the baud rate, also change the UART setting in **uartdebug.com**;
- use UART1 instead of UART0; this requires code changes and connection of the second adapter to the UART1 pins;
- change the CPU frequency as demonstrated in Project 02; update `F_CPU` in this project to match the new frequency.

## Common Mistakes

- Connecting microcontroller `TxD` to adapter `TxD` instead of adapter `RxD`.
- Connecting microcontroller `RxD` to adapter `RxD` instead of adapter `TxD`.
- Forgetting common `GND`.
- Using different logic voltage levels.
- Selecting the wrong COM port.
- Selecting the same COM port for both adapters.
- Selecting the wrong baud rate.

## Code Description

### Main Compiler Header

`#include <xc.h>` provides device-specific register and bit definitions for XC8.

### CPU Clock Definition

```c
#define F_CPU 3333333UL
```

`F_CPU` is used in the UART baud-rate calculation.

With the factory clock settings, the CPU frequency is approximately 3.333 MHz.

This definition does not configure the hardware clock.

### Delay Library

```c
#include <util/delay.h>
```

This header provides `_delay_ms()` and `_delay_us()`.

The current program does not call these delay functions, but the header is retained in the supplied project structure.

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
#define USART_BAUD_RATE \
    ((uint16_t)(((float)CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5))
```

This expression calculates the value written to `USART0.BAUD`.

The floating-point expression and `+ 0.5` round the result to the nearest integer.

### USART0 Initialization

`USART_Init()` configures UART0 before reception and transmission.

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

UART0 `RxD` is `PB3`, pin 6 in the same package. It is used as the receive input.

#### USART Transmitter and Receiver Enable

```c
USART0.CTRLB = USART_TXEN_bm | USART_RXEN_bm;
```

This enables both the USART0 transmitter and receiver.

### UART1 Initialization Note

To convert the example to UART1:

1. Replace `USART0.` with `USART1.`.
2. Replace `PORTB.DIRSET = PIN2_bm;` with `PORTA.DIRSET = PIN1_bm;`.

For the intended SOIC-14 tinyAVR 2-series devices:

```text
PA1 / UART1 TxD  ->  pin 11
PA2 / UART1 RxD  ->  pin 12
```

### The Entry Point

`int main(void)` is the program entry point.

### Received Byte Variable

```c
uint8_t received_byte;
```

This variable stores the byte read from the USART0 receive data register.

### USART0 Initialization Call

```c
USART_Init();
```

UART0 is configured before the main loop starts.

### Main Infinite Loop

The `while (1)` loop repeats the receive-and-reply operation continuously.

### Receive Complete Check

```c
while (!(USART0.STATUS & USART_RXCIF_bm))
{
    ;
}
```

This polling loop waits until USART0 has received a byte.

Because the loop is blocking, the CPU remains here until a byte is available.

### Received Byte Read

```c
received_byte = USART0.RXDATAL;
```

This reads the received byte from the USART0 receive data register.

### Data Register Empty Check

```c
while (!(USART0.STATUS & USART_DREIF_bm))
{
    ;
}
```

This polling loop waits until the transmit buffer can accept another byte.

### Incremented Byte Transmission

```c
USART0.TXDATAL = received_byte + 1;
```

This increments the received byte value by `1` and writes the result to the USART0 transmit data register.

### Application Scope

This mini-project is intended for tinyAVR 2-series devices with compatible USART and pin-routing registers.

### Tested Hardware

- `ATtiny1624`, SOIC-14
