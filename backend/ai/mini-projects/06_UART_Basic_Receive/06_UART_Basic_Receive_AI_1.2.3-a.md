# 06_UART_Basic_Receive

## File Version

Version 1.2.3-a

## AI Summary

This mini-project initializes USART0 for `115200 8N1` two-way communication.

Reception and transmission are polling-based. The main loop waits for `USART_RXCIF_bm`, reads one byte from `USART0.RXDATAL`, waits for `USART_DREIF_bm`, increments the received value by `1`, and writes the result to `USART0.TXDATAL`.

The module is a simple blocking receive-and-reply example and is the natural extension of Project 05, which demonstrates transmission only.

## Used Hardware

- tinyAVR 2-series microcontroller with compatible USART and pin-routing registers.
- UART0 `TxD` on `PB2`.
- UART0 `RxD` on `PB3`.
- One USB-UART adapter for UPDI programming.
- A second USB-UART adapter for two-way UART0 communication.

For tinyAVR 2-series devices in SOIC-14 packages:

- `PB2` / UART0 `TxD`: pin 7.
- `PB3` / UART0 `RxD`: pin 6.

Connect microcontroller `TxD` to adapter `RxD`, microcontroller `RxD` to adapter `TxD`, and connect common `GND`. The microcontroller and adapter should use the same logic voltage level.

## Tested Hardware

- `ATtiny1624`, SOIC-14

## Used Peripherals

- USART instance: `USART0`
- Transmit pin: `PB2`
- Receive pin: `PB3`
- UART mode: asynchronous
- Frame format: `115200 8N1`
- Reception: polling with `USART_RXCIF_bm`
- Transmission: polling with `USART_DREIF_bm`
- No USART interrupts

## Important Code to Preserve

- `USART0.CTRLC` frame-format configuration
- `USART0.BAUD = USART_BAUD_RATE;`
- `PORTB.DIRSET = PIN2_bm;`
- `USART0.CTRLB = USART_TXEN_bm | USART_RXEN_bm;`
- `while (!(USART0.STATUS & USART_RXCIF_bm))`
- `received_byte = USART0.RXDATAL;`
- `while (!(USART0.STATUS & USART_DREIF_bm))`
- `USART0.TXDATAL = received_byte + 1;`

Keep `F_CPU` synchronized with the actual CPU clock. Keep the UART settings in **uartdebug.com** equal to `BAUD_RATE` and `8N1`.

## Initialization Requirements

1. Define `F_CPU`.
2. Include the required compiler headers.
3. Define `BAUD_RATE` and `CLK_PER`.
4. Calculate `USART_BAUD_RATE`.
5. Configure the UART frame format.
6. Configure PB2 as the UART0 transmit output.
7. Enable both the USART0 transmitter and receiver.
8. Call `USART_Init()` before entering the main loop.

## Integration Rules

- Connect microcontroller `TxD` to adapter `RxD`.
- Connect microcontroller `RxD` to adapter `TxD`.
- Connect common `GND`.
- Use the same logic voltage level.
- Match the UART baud rate and `8N1` format.
- Transfer the baud calculation and USART initialization together.
- Preserve both transmitter and receiver enable bits.
- Update `F_CPU` after changing the CPU clock.
- When using two USB-UART adapters, select different COM ports for UPDI programming and UART communication.

## Conflicts and Limitations

- Conflicts with another independent USART0 configuration.
- PB2 cannot be independently used while it is UART0 `TxD`.
- PB3 is required as UART0 `RxD`.
- Reception is blocking: the CPU waits in the receive polling loop until a byte arrives.
- Transmission readiness is also checked with a blocking polling loop.
- Communication is byte-oriented.
- No receive or transmit interrupts are used.
- Incorrect clock or baud settings cause communication errors.
- Incorrect crossing of `TxD` and `RxD`, missing common `GND`, or different logic voltage levels can prevent communication.

## Possible Extensions

- Change the reply operation from `+1` to another transformation.
- Add processing of multiple bytes.
- Use UART1 instead of UART0.
- Select another supported baud rate.
- Replace polling with interrupt-driven reception and transmission.
- Add a receive buffer or transmit buffer.
