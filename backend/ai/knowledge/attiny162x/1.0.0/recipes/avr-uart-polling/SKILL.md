---
name: avr-uart-polling
description: Configure routed 8N1 normal asynchronous USART0/1 and poll TX/RX on ATtiny162x.
---

Choose the instance, route and physical pins together from devices.json. Apply PORTMUX.USARTROUTEA by preserving the other USART field: (old & ~PORTMUX_USARTn_gm) | selected_route_gc. ATtiny1624 has no USART1 ALT1 route. Initialize with transmitter/receiver disabled; configure route, required TX output/RX input, CTRLC 8N1, BAUD and only requested TXEN/RXEN bits. Do not retune BAUD during traffic. Do not reset an unrelated configuration with an unreviewed whole-register write.

Use calculateUsartBaud: BAUD = round(64 * CLK_PER / (S * baud)), S=16 for NORMAL (8 for a separately selected CLK2X configuration). Check baud <= CLK_PER/S and 64 <= BAUD <= 65535. BigInt avoids overflow; a C equivalent needs a uint64_t intermediate before multiplication. The validator's 2% rounding threshold is an application policy, not a silicon guarantee; oscillator and peer error consume additional margin.

Wait/test USART_DREIF_bm before writing TXDATAL. DRE means a buffer slot is available, not that the final stop bit has left the pin. RX: wait/test RXCIF; for this 8-bit mode capture RXDATAH BEFORE RXDATAL, then inspect BUFOVF/FERR/PERR for that byte. Reading RXDATAL advances the buffer. Document whether invalid bytes are discarded or reported; do not silently ignore errors in a reliability requirement. 9-bit low-byte-first is outside this recipe.

Polling blocks unless implemented as try-read/try-write. No auto-baud, LIN, RS485, open-drain or interrupt RX is covered. Those need extra knowledge and errata review. Sources: documents.json usart-rx, usart-baud, usart-status; DFP route facts. Lineage: mini-projects 05/06; their bare byte demos omit receive-error handling.
