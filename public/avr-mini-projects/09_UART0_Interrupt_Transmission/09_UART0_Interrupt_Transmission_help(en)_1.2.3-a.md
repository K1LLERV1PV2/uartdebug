# 09_UART0_Interrupt_Transmission

## File Version

Version 1.2.3-a

## Short Project Description

Non-blocking UART0 buffer transmission using the Data Register Empty interrupt.

## Full Mini-Project Description

This mini-project introduces interrupt-driven UART0 transmission.

Application code starts transmission by calling:

```c
USART_SendBuffer(uint8_t *buffer, uint8_t length)
```

After that, the UART0 Data Register Empty interrupt sends the buffer one byte at a time. The main program does not wait for each UART byte to be physically transmitted.

The interrupt handler keeps a pointer to the current byte and a count of the remaining bytes. After the last byte is loaded into the UART transmitter, the DRE interrupt is disabled.

The example in `main()` uses `snprintf()` to prepare this text in `tx_buffer`:

```text
Register = 0x1234
```

A new transmission is started approximately every 200 ms. The `_delay_ms(200)` call still blocks the main loop during the delay, but UART byte transmission itself is interrupt-driven.

UART format:

```text
115200 baud, 8 data bits, no parity, 1 stop bit
```

Common notation:

```text
115200 8N1
```

The project also contains reusable helper functions for sending 16-bit and 32-bit values in selected byte orders.

## Hardware Requirements and Setup

The intended setup uses two USB-UART adapters:

- one adapter for UPDI programming;
- a second adapter for receiving UART0 data.

The second adapter connections:

```text
Microcontroller PB2 / TxD  ->  USB-UART RxD
Microcontroller GND        ->  USB-UART GND
```

The microcontroller and the receiving USB-UART adapter should use the same logic voltage level.

For tinyAVR 2-series devices in SOIC-14 packages, `PB2` is pin 7.

UART0 reception is not used in this mini-project.

## Quick Start

### Hardware Connection

Connect the first USB-UART adapter to the microcontroller for programming through the UPDI interface.

Connect the second USB-UART adapter to the microcontroller for observing UART0 transmission.

### Port Selection

#### UPDI Programmer Adapter Port Selection

In one browser tab, open the AVR section of **uartdebug.com** for programming the microcontroller.

The figure shows that no port is selected initially.

![472](Pasted%20image%2020260726152153.png)

After clicking the `Disconnected` button, select the port of the first adapter connected to the UPDI programming interface.

![387](Pasted%20image%2020260726152302.png)

After a successful connection, the button displays `Connected` and the detected microcontroller is shown.

![466](Pasted%20image%2020260726152346.png)

#### UART Observation Adapter Port Selection

In another browser tab, open the UART section of **uartdebug.com**.

![668](Pasted%20image%2020260726152507.png)

After clicking the `Disconnected` button, select the port of the second adapter.

![355](Pasted%20image%2020260726152540.png)

This must be a different COM port from the UPDI adapter. After a successful connection, the button displays `Connected`.

![501](Pasted%20image%2020260726152615.png)

The default UART settings have the correct values for this project: `115200 8N1`.

Program the microcontroller with this project.

### Viewing the Output

For the current `snprintf()` example, use Text mode. You should see repeated lines similar to:

```text
Register = 0x1234
Register = 0x1234
Register = 0x1234
```

For the binary helper functions, HEX or unsigned multi-byte viewing modes are more useful.

### Verification

If the text appears repeatedly and the byte-by-byte transmission is performed by the UART0 DRE interrupt, interrupt-driven transmission is working correctly.

## What This Mini-Project Is For

This mini-project is the first reusable interrupt-driven UART transmission module in the sequence.

Its main purpose is to separate application code from the byte-by-byte UART transmission process. Application code starts a transmission; the UART hardware and interrupt handler then send the buffer in the background.

The same transmission engine can be reused for formatted diagnostic strings, binary variable observation, sensor data, and application-specific packets.

## Usage Options

You can:

- build text in `tx_buffer` with `snprintf()` and transmit it with `USART_SendBuffer()`;
- send `uint16_t` in high-byte-first order with `send_uint16_High_Low()`;
- send `uint32_t` in high-byte-first order with `send_uint32_High_Low()`;
- send `uint16_t` in little-endian order with `send_uint16_Low_High()`;
- transmit another buffer by passing its address and length to `USART_SendBuffer()`;
- create additional helper functions for other variable types or packet formats.

## Common Mistakes

- Forgetting to call `sei()`.
- Starting a new transmission before the previous one has completed.
- Changing `tx_buffer` while it is still being transmitted.
- Passing a buffer that does not remain valid until transmission completes.
- Passing a zero length to the current `USART_SendBuffer()` implementation.
- Modifying the ISR without preserving the pointer, byte-count, and interrupt-disable sequence.
- Connecting microcontroller `TxD` to adapter `TxD` instead of adapter `RxD`.
- Forgetting common `GND`.
- Selecting the wrong baud rate or COM port.

## Code Description

### Main Compiler Header

`#include <xc.h>` provides device-specific register and bit definitions for XC8.

### CPU Clock Definition

`F_CPU` is set to approximately 3.333 MHz and is used by the delay library and UART baud calculation.

### Delay Library

`<util/delay.h>` provides `_delay_ms()`. The current example uses `_delay_ms(200)` between transmission requests.

### Interrupt Library

`<avr/interrupt.h>` provides `ISR(...)` and `sei()`.

### Standard I/O Library

`<stdio.h>` provides `snprintf()`.

### User-Defined UART Parameters

`BAUD_RATE` is `115200`; `CLK_PER` equals `F_CPU`.

### USART Baud Register Calculation

`USART_BAUD_RATE` calculates the value written to `USART0.BAUD`.

### USART0 Initialization

`USART_Init()` configures UART0 for asynchronous transmission.

#### UART Frame Format

The frame format is `115200 8N1`.

#### USART Baud Rate Register

`USART0.BAUD = USART_BAUD_RATE;` configures the baud-rate generator.

#### UART0 TxD Pin Configuration

`PORTB.DIRSET = PIN2_bm;` configures `PB2` as UART0 `TxD`.

#### USART Transmitter Enable

`USART0.CTRLB = USART_TXEN_bm;` enables the transmitter. The DRE interrupt is enabled only when a transmission is started.

### Transmission State Variables

`current_tx_byte_count` stores the remaining byte count and `current_tx_ptr` points to the current buffer byte.

### Transmission Buffer

`tx_buffer[100]` is a global buffer used by the examples and helper functions.

### UART0 Data Register Empty ISR

`ISR(USART0_DRE_vect)` performs the byte-by-byte transmission.

### Byte Transmission

`USART0.TXDATAL = *current_tx_ptr;` loads the current byte into the UART transmitter.

### Transmission Pointer Advance

`current_tx_ptr++;` advances to the next byte.

### Remaining Byte Count

`current_tx_byte_count--;` decrements the remaining byte count.

### DRE Interrupt Disable

When the count reaches zero, `USART0.CTRLA &= ~USART_DREIE_bm;` disables the DRE interrupt.

### Buffer Transmission Start

`USART_SendBuffer()` stores the buffer address and length, then enables the DRE interrupt.

### High-Byte-First uint16 Transmission

`send_uint16_High_Low()` sends `0x1234` as `12 34`.

### High-Byte-First uint32 Transmission

`send_uint32_High_Low()` sends `0x12345678` as `12 34 56 78`.

### Little-Endian uint16 Transmission

`send_uint16_Low_High()` sends `0x1234` as `34 12`.

### The Entry Point

`int main(void)` is the program entry point.

### USART0 Initialization Call

`USART_Init()` is called before interrupt-driven transmission is used.

### Global Interrupt Enable

`sei()` enables global interrupts.

### Main Infinite Loop

The main loop repeatedly prepares and starts the example transmission.

### snprintf Message Construction

`snprintf()` builds the formatted text in `tx_buffer` and returns its length.

### Buffer Transmission Request

`USART_SendBuffer(tx_buffer, tx_byte_count);` starts interrupt-driven transmission of the prepared text.

### Transmission Interval

`_delay_ms(200);` creates the example interval. It blocks the main loop but does not perform the UART byte transmission.

### Application Scope

This mini-project is intended for tinyAVR 2-series devices with compatible USART0, interrupt, and pin-routing registers.

### Tested Hardware

- `ATtiny1624`, SOIC-14
