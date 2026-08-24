# 10_UART1_Interrupt_Transmission

## File Version

Version 1.2.3-a

## AI Summary

This mini-project provides a reusable interrupt-driven UART1 transmission engine.

Application code starts a transmission with `USART_SendBuffer()`. The UART1 Data Register Empty ISR then transmits the active buffer byte by byte while application code can continue executing.

This is the UART1 counterpart of Project 09.

## Used Hardware

- tinyAVR 2-series microcontroller with compatible USART1 and interrupt registers.
- UART1 `TxD` on `PA1`.
- UART1 `RxD` on `PA2`, not used by this project.
- One USB-UART adapter for UPDI programming.
- A second USB-UART adapter for receiving UART1 data.

For tinyAVR 2-series devices in SOIC-14 packages:

- `PA1` / UART1 `TxD`: pin 11.
- `PA2` / UART1 `RxD`: pin 12.

Connect microcontroller `TxD` to adapter `RxD` and connect common `GND`. The microcontroller and receiving adapter should use the same logic voltage level.

## Tested Hardware

- `ATtiny1624`, SOIC-14

## Used Peripherals

- USART instance: `USART1`
- Transmit pin: `PA1`
- Interrupt vector: `USART1_DRE_vect`
- Interrupt source: USART1 Data Register Empty
- UART mode: asynchronous
- Frame format: `115200 8N1`
- Global interrupt enable: `sei()`
- No UART reception

## Important Code to Preserve

The following elements form the transmission engine and must be preserved together:

- `ISR(USART1_DRE_vect)`
- `USART_SendBuffer()`
- `current_tx_byte_count`
- `current_tx_ptr`
- `USART1.TXDATAL = *current_tx_ptr;`
- `current_tx_ptr++`
- `current_tx_byte_count--`
- `USART1.CTRLA &= ~USART_DREIE_bm`
- `USART1.CTRLA |= USART_DREIE_bm`

The DRE interrupt must be disabled after the final byte is loaded.

The buffer passed to `USART_SendBuffer()` must remain valid and unchanged until transmission is complete.

## Initialization Requirements

1. Define `F_CPU`.
2. Include `<avr/interrupt.h>`.
3. Define `BAUD_RATE` and calculate `USART_BAUD_RATE`.
4. Call `USART_Init()`.
5. Call `sei()`.
6. Start a transmission only after initialization and global interrupt enable are complete.

## Integration Rules

When reusing the interrupt-driven transmission engine, transfer together:

- `USART_Init()`;
- `USART_SendBuffer()`;
- `ISR(USART1_DRE_vect)`;
- `current_tx_byte_count`;
- `current_tx_ptr`;
- the baud-rate definitions;
- global interrupt enable.

When using the supplied helper functions, also transfer `tx_buffer`.

Do not start another transmission while the previous transmission is still active unless busy-state protection or a queue is added.

Keep `F_CPU` synchronized with the actual CPU clock and keep the receiver baud rate equal to `BAUD_RATE`.

## Conflicts and Limitations

- Conflicts with another module that independently configures USART1.
- Conflicts with another definition of `ISR(USART1_DRE_vect)`.
- `PA1` cannot be independently used while it is UART1 `TxD`.
- The current implementation has no busy flag and no transmit queue.
- A new call to `USART_SendBuffer()` can overwrite the state of an active transmission.
- The transmitted buffer must remain valid and unchanged until transmission completes.
- A zero `length` is not supported by the current implementation.
- `current_tx_byte_count` limits one requested transmission to a maximum of 255 bytes.
- `tx_buffer` is 100 bytes.
- The current application example uses a blocking `_delay_ms(200)` between transmission requests even though UART byte transmission itself is interrupt-driven.
- UART reception is not implemented.
- `PA2` / UART1 `RxD` is not used.
- The `snprintf()` example stores its return value in `uint8_t`; the current fixed message fits the buffer, but longer future formatted output must be kept within the buffer and length range.

## Possible Extensions

- Add `USART_IsBusy()`.
- Add a transmit queue.
- Add a ring buffer.
- Add interrupt-driven reception.
- Add helper functions for additional integer types or application packets.
- Use UART0 and UART1 simultaneously for different communication roles.
