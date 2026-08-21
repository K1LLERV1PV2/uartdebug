# 05_UART_Basic_Transmission

## File Version

Version 1.2.3-c

## AI Summary

This mini-project initializes USART0 for `115200 8N1` and transmits one incrementing byte approximately every 20 ms.

Transmission is polling-based. The main loop waits for `USART_DREIF_bm`, writes to `USART0.TXDATAL`, increments the byte, and then performs a blocking `_delay_ms(20)` delay.

The transmitted sequence repeats from `0` to `255` and produces a sawtooth waveform when viewed as unsigned one-byte data.

## Used Hardware

- tinyAVR 2-series microcontroller with compatible USART and pin-routing registers.
- UART0 `TxD` on `PB2`.
- One USB-UART adapter for UPDI programming.
- A second USB-UART adapter for observing UART0 transmission.

For tinyAVR 2-series devices in SOIC-14 packages, `PB2` is pin 7.

Connect the microcontroller’s `TxD` to the receiving adapter’s `RxD` and connect common `GND`. The microcontroller and receiving adapter should use the same logic voltage level. The microcontroller’s `RxD` pin is not used.

## Tested Hardware

- `ATtiny1624`, SOIC-14

## Used Peripherals

- USART instance: `USART0`
- Transmit pin: `PB2`
- UART mode: asynchronous
- Frame format: `115200 8N1`
- Delay function: `_delay_ms(20)`
- No USART receive function or interrupt

## Important Code to Preserve

- `USART0.CTRLC` frame-format configuration
- `USART0.BAUD = USART_BAUD_RATE;`
- `PORTB.DIRSET = PIN2_bm;`
- `USART0.CTRLB = USART_TXEN_bm;`
- `while (!(USART0.STATUS & USART_DREIF_bm))`
- `USART0.TXDATAL = out_data;`

Keep `F_CPU` synchronized with the actual CPU clock. Keep the receiving baud-rate setting equal to `BAUD_RATE`.

## Initialization Requirements

1. Define `F_CPU`.
2. Include `<util/delay.h>`.
3. Define `BAUD_RATE` and `CLK_PER`.
4. Calculate `USART_BAUD_RATE`.
5. Call `USART_Init()`.
6. Enter the main loop.

## Integration Rules

- Connect microcontroller `TxD` to adapter `RxD`.
- Connect common `GND`.
- Use the same logic voltage level.
- Match the receiver baud rate and `8N1` format.
- Transfer the baud calculation and USART initialization together.
- Update `F_CPU` after changing the CPU clock.
- When using two USB-UART adapters, select different COM ports for UPDI programming and UART observation.

## Conflicts and Limitations

- Conflicts with another independent USART0 configuration.
- PB2 cannot be used for another function while it is UART0 `TxD`.
- `_delay_ms(20)` blocks the main loop.
- Transmission is polling-based, not interrupt-driven.
- The example transmits raw bytes, not formatted text.
- UART reception is not implemented.
- Incorrect clock or baud settings cause communication errors.
- Different logic voltage levels can cause unreliable operation or hardware damage.
- The screenshots referenced in the help files are external image files and are not embedded in this Markdown-only mini-project set.

## Possible Extensions

- Generate another transmitted-data sequence.
- Select another supported baud rate.
- Transmit another variable.
- Use UART1 instead of UART0.
- Change the CPU frequency and update `F_CPU`.
- Replace the blocking delay with a timer.
- Replace polling with interrupt-driven transmission.
- Add UART reception.
