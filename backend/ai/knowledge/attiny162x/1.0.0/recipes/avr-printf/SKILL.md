---
name: avr-printf
description: Redirect XC8 AVR stdio to a chosen blocking USART without losing stdout ownership.
---

Transfer the mechanism together: int putchar_callback(char, FILE *), a persistent FILE initialized by FDEV_SETUP_STREAM(callback, NULL, _FDEV_SETUP_WRITE), and stdout = &stream after USART initialization. The callback waits for DRE, writes one character and returns 0 on success. The FILE object must outlive all printf calls.

Only one owner assigns stdout. Distinguish USART0/PB2 from USART1/PA1 and alternate routes. Keep printf out of ISR paths. It blocks and costs flash/stack; floating-point formatting depends on the actual linked library and must not be promised without a compile/link result. Match format specifiers to the target ABI and argument types. Use explicit CRLF if required by the receiver.

Lineage: mini-projects 07/08 plus their AI descriptions. FDEV_SETUP_STREAM is a toolchain/libc interface, not a hardware register fact from the DFP. This bundle does not claim a new compiler run for it. For buffered snprintf + interrupt TX use avr-uart-tx-interrupt as well.
