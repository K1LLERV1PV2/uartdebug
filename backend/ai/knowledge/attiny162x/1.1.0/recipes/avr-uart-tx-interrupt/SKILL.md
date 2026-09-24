---
name: avr-uart-tx-interrupt
description: Compose a bounded USART DRE transmitter with explicit buffer lifetime and ISR ownership.
---

Keep transmitter initialization, one DRE ISR, state and send API together. The ISR loads the next byte, advances state and disables DREIE once the last byte is loaded. DRE completion releases a source buffer; TXC is the separate physical-line completion condition needed before power-down or direction changes.

Use avr-uart-polling for routed normal asynchronous 8N1 initialization, including SFDEN=0 and ODME=0. If physical completion is required, start from a known idle transmitter with no pending bytes and serialize the operation: clear stale TXCIF with a direct STATUS = USART_TXCIF_bm write immediately before submitting its first byte, then test TXCIF after all bytes were queued. If transmission is already in progress, use a separately reviewed completion protocol rather than assuming a pre-send clear is race-free. Do not use |= on this W1C flag register. A DRE interrupt or source-buffer release alone cannot prove that the final stop bit has left the pin. This distinction does not add a sleep or RS485 recipe.

Reject null buffers and zero length. Bound length by actual capacity and counter type. A send operation must return busy or enqueue when active; it must not overwrite an active pointer/count. Initialize shared state and publish DREIE only under a correctly scoped interrupt guard/ownership protocol; restore the prior interrupt state. Use a volatile POINTER when it is shared, e.g. const uint8_t * volatile tx_ptr; volatile uint8_t * instead qualifies the pointed-to bytes. A multi-byte pointer/count and coordinated state updates are not atomic merely because they are volatile.

The caller-owned buffer must remain alive and unchanged until consumed. Stack buffers require waiting for completion or copying into owned storage. Filling a shared buffer for the next request while ISR transmits it is already a race, even before calling send. A 200 ms delay is not busy protection. Do not add printf/delays in the ISR. Keep critical sections brief; use a reviewed queue protocol if needed.

Store snprintf's result in int. A negative result is an error; a result >= capacity means truncation and is not the number of stored bytes. Reject or deliberately clamp to capacity-1, then range-check before converting to the driver's length type. For binary integers use explicit shifts/masks in the documented byte order instead of exposing host memory layout.

Sources for the hardware boundary: DS40002234B sections 24.5.5 and 24.5.7 (pages 311, 314); DS80000902F section 2.8.2 (page 5). Reviewed facts: usart-status, usart-active-8n1, errata-usart-active-sfden. Lineage: mini-projects 09/10. Their no-busy, zero-length and shared-state limitations are intentionally corrected as requirements here; the legacy source is not duplicated or silently relabeled production-ready. USART RX interrupts, multiple producers and lock-free queues require additional reviewed recipes.
