# 07_Printf_Redirect_USART0

## File Version

Version 1.2.3-a

## AI Summary

This mini-project redirects the standard C `stdout` stream to USART0 so that `printf()` can transmit formatted text through UART.

Transmission is blocking and polling-based. Each character produced by `printf()` is sent through `USART_PrintChar()`, which waits for `USART_DREIF_bm` and writes the character to `USART0.TXDATAL`.

The main loop prints an incrementing `uint16_t` counter every 500 ms.

## Used Hardware

- tinyAVR 2-series microcontroller with compatible USART and pin-routing registers.
- UART0 `TxD` on `PB2`.
- One USB-UART adapter for UPDI programming.
- A second USB-UART adapter for receiving the UART0 text output.

For tinyAVR 2-series devices in SOIC-14 packages, `PB2` is pin 7.

Connect microcontroller `TxD` to adapter `RxD` and connect common `GND`. The microcontroller and receiving adapter should use the same logic voltage level.

## Tested Hardware

- `ATtiny1624`, SOIC-14

## Used Peripherals

- USART instance: `USART0`
- Transmit pin: `PB2`
- UART mode: asynchronous
- Frame format: `115200 8N1`
- Transmission: polling with `USART_DREIF_bm`
- Standard stream: `stdout`
- No USART receive function
- No USART interrupts

## Important Code to Preserve

- `USART_PrintChar()`
- `FILE USART_stream = FDEV_SETUP_STREAM(...)`
- `stdout = &USART_stream;`
- `USART0.CTRLC` frame-format configuration
- `USART0.BAUD = USART_BAUD_RATE;`
- `PORTB.DIRSET = PIN2_bm;`
- `USART0.CTRLB = USART_TXEN_bm;`
- the `USART_DREIF_bm` polling loop
- `USART0.TXDATAL = c;`

The `USART_stream`, `USART_PrintChar()`, and `stdout` assignment form one functional unit and must be preserved together when reusing the `printf()` redirection mechanism.

## Initialization Requirements

1. Include `<xc.h>`.
2. Include `<stdio.h>`.
3. Define `F_CPU`.
4. Include `<util/delay.h>`.
5. Define `BAUD_RATE` and `CLK_PER`.
6. Calculate `USART_BAUD_RATE`.
7. Create `USART_stream` with `FDEV_SETUP_STREAM`.
8. Configure USART0.
9. Redirect `stdout` to `USART_stream`.
10. Call `USART_Init()` before the first use of `printf()`.

## Integration Rules

- Transfer `USART_PrintChar()`, `USART_stream`, and the `stdout` assignment together.
- Preserve the baud-rate calculation and USART initialization.
- Connect microcontroller `TxD` to adapter `RxD`.
- Connect common `GND`.
- Use the same logic voltage level.
- Match the receiver baud rate and `8N1` format.
- Update `F_CPU` after changing the CPU clock.
- When using two USB-UART adapters, select different COM ports for UPDI programming and UART observation.
- If another module already redirects `stdout`, integrate the output mechanism instead of assigning `stdout` independently.

## Conflicts and Limitations

- Conflicts with another independent USART0 configuration.
- Conflicts with another module that independently redirects `stdout`.
- PB2 cannot be independently used while it is UART0 `TxD`.
- Transmission is blocking and polling-based.
- `printf()` may increase program size compared with direct UART byte transmission.
- Long formatted messages keep the CPU busy while characters are transmitted.
- Floating-point `printf()` formatting may require additional library support and significantly more program memory, depending on the compiler configuration.
- UART reception is not implemented.
- Incorrect clock or baud settings cause communication errors.

## Possible Extensions

- Print several variables in one line.
- Print values in hexadecimal form.
- Add application status and diagnostic messages.
- Use UART1 instead of UART0.
- Select another supported baud rate.
- Replace blocking transmission with interrupt-driven UART transmission.
- Add compile-time control for enabling or disabling debug output.
