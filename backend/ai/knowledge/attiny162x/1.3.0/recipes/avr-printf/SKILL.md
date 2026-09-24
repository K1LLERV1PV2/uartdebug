---
name: avr-printf
description: Redirect XC8 AVR stdio to a chosen blocking USART without losing stdout ownership.
---

Transfer the mechanism together: int putchar_callback(char, FILE *), a persistent FILE initialized by FDEV_SETUP_STREAM(callback, NULL, _FDEV_SETUP_WRITE), and stdout = &stream after USART initialization. The callback waits for DRE, writes one character and returns 0 on success. The FILE object must outlive all printf calls.

Only one owner assigns stdout. Distinguish USART0/PB2 from USART1/PA1 and alternate routes. Keep printf out of ISR paths. It blocks and costs flash/stack; floating-point formatting depends on the actual linked library and must not be promised without a compile/link result. Match format specifiers to the target ABI and argument types. Use explicit CRLF if required by the receiver.

Compose the underlying USART initialization from avr-uart-polling, including explicit normal asynchronous 8N1, SFDEN=0 and ODME=0. Returning from the callback or printf only means characters were submitted; DRE is not final stop-bit completion. Use a separate, correctly armed TXC completion check only when the application requires the line to finish transmitting.

Sources for the hardware boundary: DS40002234B sections 24.5.5 and 24.5.7 (pages 311, 314); DS80000902F section 2.8.2 (page 5). Reviewed facts: usart-status, usart-active-8n1, errata-usart-active-sfden. Lineage: mini-projects 07/08 plus their AI descriptions. FDEV_SETUP_STREAM is a toolchain/libc interface, not a hardware register fact from the DFP. Use actual compile/link evidence for the selected XC8, libc and device pack. For buffered snprintf + interrupt TX use avr-uart-tx-interrupt as well.
