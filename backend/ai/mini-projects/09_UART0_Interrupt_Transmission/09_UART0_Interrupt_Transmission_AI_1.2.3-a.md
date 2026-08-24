# 09_UART0_Interrupt_Transmission

## File Version

Version 1.2.3-a

## AI Summary

This mini-project provides a reusable interrupt-driven UART0 transmission engine. Application code starts a transmission with `USART_SendBuffer()`, and `ISR(USART0_DRE_vect)` then sends the active buffer byte by byte.

The project also provides helper functions for transmitting `uint16_t` and `uint32_t` values in selected byte orders and an example that builds formatted text with `snprintf()`.

## Used Hardware

- tinyAVR 2-series microcontroller with compatible USART0 and interrupt registers.
- UART0 `TxD` on `PB2`.
- One USB-UART adapter for UPDI programming.
- A second USB-UART adapter for receiving UART0 data.

For tinyAVR 2-series devices in SOIC-14 packages, `PB2` is pin 7.

## Tested Hardware

- `ATtiny1624`, SOIC-14

## Used Peripherals

- USART instance: `USART0`
- Transmit pin: `PB2`
- Interrupt vector: `USART0_DRE_vect`
- Interrupt source: USART0 Data Register Empty
- UART format: `115200 8N1`
- Global interrupts: enabled with `sei()`
- UART reception: not used

## Important Code to Preserve

Preserve the transmission engine as one coordinated unit:

- `ISR(USART0_DRE_vect)`
- `USART_SendBuffer()`
- `current_tx_byte_count`
- `current_tx_ptr`
- `USART0.TXDATAL = *current_tx_ptr;`
- `current_tx_ptr++`
- `current_tx_byte_count--`
- `USART0.CTRLA &= ~USART_DREIE_bm`
- `USART0.CTRLA |= USART_DREIE_bm`

The transmitted buffer must remain valid and unchanged until transmission is complete.

## Initialization Requirements

- Call `USART_Init()` before using `USART_SendBuffer()`.
- Call `sei()` before interrupt-driven transmission can operate.
- Keep `F_CPU` synchronized with the actual CPU clock.
- Keep the receiver baud rate equal to `BAUD_RATE`.

## Integration Rules

When reusing the engine, transfer `USART_Init()`, `USART_SendBuffer()`, `ISR(USART0_DRE_vect)`, the transmission state variables, and the baud-rate definitions together.

When using the supplied helper functions, also transfer `tx_buffer`.

Do not start another transmission while the previous one is active unless busy-state protection or a queue is added.

## Conflicts and Limitations

- Conflicts with another module that independently configures USART0.
- Conflicts with another definition of `ISR(USART0_DRE_vect)`.
- `PB2` cannot be independently used while it is UART0 `TxD`.
- No busy flag or transmit queue is provided.
- A new call to `USART_SendBuffer()` can overwrite the state of an active transmission.
- A zero `length` is not supported by the current implementation.
- `current_tx_byte_count` limits one requested transmission to 255 bytes.
- `tx_buffer` is 100 bytes.
- The main-loop example still uses blocking `_delay_ms(200)` between transmission requests.
- UART reception is not implemented.
- `out_data` remains from the supplied source but is not used by the current program.

## Possible Extensions

- Add `USART_IsBusy()`.
- Add a transmit queue or ring buffer.
- Add interrupt-driven reception.
- Add helper functions for additional data types.
- Convert the transmission engine to UART1.
