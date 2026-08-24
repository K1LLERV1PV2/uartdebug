# 10_UART1_Interrupt_Transmission

## File Version

Version 1.2.3-a

## Short Project Description

Non-blocking UART1 buffer transmission using the Data Register Empty interrupt.

## Full Mini-Project Description

This mini-project demonstrates interrupt-driven UART1 transmission.

It is the UART1 counterpart of Project 09. The transmission engine works in the same way, but this project uses `USART1` and the UART1 transmit pin `PA1`.

The main program starts transmission by calling:

```c
USART_SendBuffer(uint8_t *buffer, uint8_t length)
```

The UART1 Data Register Empty interrupt then sends the bytes one by one.

The interrupt handler keeps:

- a pointer to the current byte;
- the number of bytes still to be transmitted.

After the last byte has been loaded into the UART transmitter, the DRE interrupt is disabled.

The example in `main()` uses `snprintf()` to build this text in `tx_buffer`:

```text
Register = 0x1234
```

The buffer transmission is then started with `USART_SendBuffer()`. The example repeats approximately every 200 ms.

The 200 ms `_delay_ms()` call still blocks the main loop during the delay. The UART transmission itself, however, is interrupt-driven and continues independently after it has been started.

UART format:

```text
115200 baud, 8 data bits, no parity, 1 stop bit
```

Common notation:

```text
115200 8N1
```

The project also contains reusable helper functions for transmitting 16-bit and 32-bit values in selected byte orders.

## Hardware Requirements and Setup

The intended setup uses two USB-UART adapters:

- one adapter for UPDI programming;
- a second adapter for receiving and displaying UART1 data.

The second adapter connections:

```text
Microcontroller PA1 / TxD  ->  USB-UART RxD
Microcontroller GND        ->  USB-UART GND
```

The microcontroller and the receiving USB-UART adapter should use the same logic voltage level.

For tinyAVR 2-series devices in SOIC-14 packages:

```text
PA1 / UART1 TxD  ->  pin 11
PA2 / UART1 RxD  ->  pin 12
```

UART1 reception is not used in this mini-project.

## Quick Start

### Hardware Connection

Connect the first USB-UART adapter to the microcontroller for programming through the UPDI interface.

Connect the second USB-UART adapter to the microcontroller for observing UART1 transmission.

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

Select the port of the second adapter connected to the microcontroller UART1 transmitter, and click the `Connection` button.

This must be a different port number from the UPDI adapter port. In this example, the UPDI adapter uses `COM15`, while the second adapter used for UART observation uses `COM24`.

If everything works correctly, you will see approximately the following:

![501](Pasted%20image%2020260726152615.png)

The most important indication is `Connected` on the button. This means that the connection was successful.

The text `WCH CH343 ...` may be different on your computer. It depends on the USB-UART adapter manufacturer.

The default UART settings have the correct values for this project: `115200 8N1`.

Program the microcontroller with this project.

### Viewing the Output

For the current `snprintf()` example, use Text mode in the UART section of **uartdebug.com**.

You should see repeated lines similar to:

```text
Register = 0x1234
Register = 0x1234
Register = 0x1234
```

A new transmission is started approximately every 200 ms.

For the binary helper functions, HEX or unsigned multi-byte viewing modes are more useful.

### Verification

If the text appears repeatedly while the data bytes are transmitted by the UART1 DRE interrupt, interrupt-driven transmission is working correctly.

This verifies:

- UART1 configuration;
- `PA1` as UART1 `TxD`;
- global interrupt enable;
- UART1 Data Register Empty interrupt operation;
- buffer transmission through `USART_SendBuffer()`;
- interrupt disable after the final byte;
- hardware connection to the receiving USB-UART adapter.

## What This Mini-Project Is For

This mini-project provides the UART1 version of the reusable interrupt-driven transmission engine introduced in Project 09.

The main purpose is to allow the same non-blocking transmission method to be used when UART0 is occupied or when a second serial channel is required.

The same transmission engine can be reused for:

- formatted diagnostic strings;
- periodic debug output;
- binary variable observation;
- sensor data;
- data packets;
- larger application-specific transmission functions.

## Usage Options

You can:

- build a text string in `tx_buffer` with `snprintf()` and transmit it with `USART_SendBuffer()`;
- send a `uint16_t` value in high-byte-first order with `send_uint16_High_Low()`;
- send a `uint32_t` value in high-byte-first order with `send_uint32_High_Low()`;
- send a `uint16_t` value in little-endian order with `send_uint16_Low_High()`;
- transmit another existing buffer by passing its address and length to `USART_SendBuffer()`;
- create additional helper functions for other variable types or packet formats;
- use UART0 and UART1 for different purposes in a larger project.

## Common Mistakes

- Forgetting to call `sei()`.
- Forgetting that `USART_SendBuffer()` starts transmission by enabling the DRE interrupt.
- Starting a new transmission before the previous one has completed.
- Changing `tx_buffer` while it is still being transmitted.
- Passing a buffer that does not remain valid for the complete transmission.
- Passing a zero length to the current `USART_SendBuffer()` implementation.
- Modifying the ISR without preserving the pointer, byte-count, and interrupt-disable sequence.
- Connecting the receiving adapter to `PB2` instead of `PA1`.
- Connecting microcontroller `TxD` to adapter `TxD` instead of adapter `RxD`.
- Forgetting common `GND`.
- Selecting the wrong baud rate or COM port.

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

The current example uses `_delay_ms(200)` between transmission requests.

### Interrupt Library

```c
#include <avr/interrupt.h>
```

This header provides the interrupt macros used by the project, including `ISR(...)` and `sei()`.

### Standard I/O Library

```c
#include <stdio.h>
```

This header provides `snprintf()`.

### User-Defined UART Parameters

```c
#define BAUD_RATE 115200UL
#define CLK_PER   F_CPU
```

`BAUD_RATE` selects the UART baud rate.

`CLK_PER` is the peripheral clock used in the baud calculation. Here it equals `F_CPU`.

### USART Baud Register Calculation

```c
#define USART_BAUD_RATE \
    ((uint16_t)(((float)CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5))
```

This expression calculates the value written to `USART1.BAUD`.

### USART1 Initialization

`USART_Init()` configures UART1 for interrupt-driven transmission.

#### UART Frame Format

The `USART1.CTRLC` assignment selects asynchronous mode, no parity, 8 data bits, and 1 stop bit: `8N1`.

#### USART Baud Rate Register

```c
USART1.BAUD = USART_BAUD_RATE;
```

This register configures the USART baud-rate generator. With the current clock and `BAUD_RATE` settings, it provides approximately 115200 baud.

#### UART1 TxD Pin Configuration

```c
PORTA.DIRSET = PIN1_bm;
```

PA1 is configured as the UART1 transmit output.

For tinyAVR 2-series devices in SOIC-14 packages, `PA1` is pin 11.

UART1 `RxD` is `PA2`, pin 12 in the same package, but it is not used in this project.

#### USART Transmitter Enable

```c
USART1.CTRLB = USART_TXEN_bm;
```

This enables the USART1 transmitter.

The DRE interrupt itself is enabled by `USART_SendBuffer()` only when a transmission is started.

### Transmission State Variables

```c
static volatile uint8_t current_tx_byte_count;
static volatile uint8_t *current_tx_ptr;
```

These variables describe the transmission currently handled by the ISR.

`current_tx_byte_count` contains the number of bytes still to be loaded into the transmitter.

`current_tx_ptr` identifies the current byte in the active buffer.

### Transmission Buffer

```c
uint8_t tx_buffer[100];
```

This global buffer is used by the example `snprintf()` call and by the supplied helper functions.

Because it is global, it remains valid while interrupt-driven transmission is active.

### UART1 Data Register Empty ISR

```c
ISR(USART1_DRE_vect)
```

This interrupt handler performs the byte-by-byte transmission.

The DRE interrupt occurs when the UART1 transmit data register can accept the next byte.

### Byte Transmission

```c
USART1.TXDATAL = *current_tx_ptr;
```

This loads the current byte into the USART1 transmit data register.

### Transmission Pointer Advance

```c
current_tx_ptr++;
```

After sending a byte, the pointer advances to the next byte in the active buffer.

### Remaining Byte Count

```c
current_tx_byte_count--;
```

The remaining-byte counter is decremented after each transmitted byte.

### DRE Interrupt Disable

```c
USART1.CTRLA &= ~USART_DREIE_bm;
```

When the remaining-byte counter reaches zero, the DRE interrupt is disabled.

### Buffer Transmission Start

```c
void USART_SendBuffer(uint8_t *buffer, uint8_t length)
```

This function starts transmission of a buffer.

It stores the byte count and buffer address, then enables the UART1 DRE interrupt:

```c
USART1.CTRLA |= USART_DREIE_bm;
```

The current implementation does not check whether a previous transmission is still active.

A nonzero `length` must be supplied.

### High-Byte-First uint16 Transmission

```c
send_uint16_High_Low()
```

This helper places a 16-bit value into `tx_buffer` in high-byte-first order.

Example:

```text
0x1234 -> 12 34
```

### High-Byte-First uint32 Transmission

```c
send_uint32_High_Low()
```

This helper places a 32-bit value into `tx_buffer` in high-byte-first order.

Example:

```text
0x12345678 -> 12 34 56 78
```

### Little-Endian uint16 Transmission

```c
send_uint16_Low_High()
```

This helper places a 16-bit value into `tx_buffer` in low-byte-first order.

Example:

```text
0x1234 -> 34 12
```

### The Entry Point

`int main(void)` is the program entry point.

### USART1 Initialization Call

```c
USART_Init();
```

UART1 is configured before interrupt-driven transmission is used.

### Global Interrupt Enable

```c
sei();
```

Global interrupts must be enabled before the UART1 DRE interrupt can execute.

### Main Infinite Loop

The `while (1)` loop repeatedly prepares and starts the example transmission.

### snprintf Message Construction

```c
tx_byte_count = snprintf((char *)tx_buffer,
                         (size_t)sizeof(tx_buffer),
                         "Register = 0x%X\r\n",
                         0x1234);
```

`snprintf()` converts the formatted text into bytes stored in `tx_buffer` and returns the text length.

In the current fixed example, the resulting text fits easily inside the 100-byte buffer.

### Buffer Transmission Request

```c
USART_SendBuffer(tx_buffer, tx_byte_count);
```

This starts interrupt-driven transmission of the prepared text.

### Transmission Interval

```c
_delay_ms(200);
```

The example waits approximately 200 ms before preparing the next transmission.

This delay blocks the main loop, but it does not perform the UART byte transmission.

### Application Scope

This mini-project is intended for tinyAVR 2-series devices with compatible USART1, interrupt, and pin-routing registers.

### Tested Hardware

- `ATtiny1624`, SOIC-14
