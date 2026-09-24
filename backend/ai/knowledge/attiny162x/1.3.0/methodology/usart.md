# ATtiny1624/1626/1627 USART methodology

Curated from the colleague's USART reference, model, English and Russian WR-USART-01 through WR-USART-15, source guide and four SVG diagrams. Hardware sources: DS40002234B chapter 24, pages 290–323, and DS80000902F sections 2.8.1–3, pages 5–6. The Russian working rules are a translation, not an additional rule set. Source hashes, line ranges and adoption decisions are in `provenance/adoption-peripherals.json`.

## Scope and communication contract

Approved generation remains the existing normal asynchronous 8N1 recipes: polling TX/RX, stdio redirection and bounded interrupt TX. The selected CPU/peripheral clock, USART instance, route, baud and pins must pass their existing validators. CLK2X, 9-bit frames, synchronous operation, Host SPI, One-Wire, RS-485, IRCOM, auto-baud, MPCM, Start-of-Frame wake and sleep changes below are reference only. These materials do not enable those modes.

Establish the exact target/package, TX/RX directions, peer-compatible baud and frame, actual CLK_PER, electrical interface, and required buffering/error behavior. Infer harmless defaults only where the canvas and approved recipe permit them; clarify a missing wire, route or incompatible frame rather than silently guessing it. Do not mechanically ask for every optional mode or buffer feature.

The USART has separate transmit and receive paths, two-level buffers and shift registers. Their hardware buffering is finite, and software service must meet the incoming/outgoing frame rate. XCK is a synchronous clock signal, XDIR controls an external driver, TXD transmits and can feed loopback, and RXD receives. These names are functional signals, not physical package numbers.

## Approved generation: route, GPIO and initialization

Resolve the whole selected route against canonical device/package facts. USART0 DEFAULT uses PB2 TX/PB3 RX; ALT1 uses PA1 TX/PA2 RX. USART1 DEFAULT uses PA1 TX/PA2 RX; ALT1 uses PC2 TX/PC1 RX and is not present on ATtiny1624. Confirm physical package availability and all pin owners. A valid symbol in another device's header does not grant that route on the selected MCU.

When changing PORTMUX.USARTROUTEA, preserve the other USART's field unless this module intentionally owns the complete register value. A verified reset route may be retained only under an explicit one-time startup contract. A reusable initializer must establish its required route rather than inherit it.

For ordinary non-inverted asynchronous TX, preload the high idle state before enabling the output driver; configure RX as input and keep its digital input path available. Use pull-ups only for a specified disconnected/high-impedance condition. Do not use GPIO input-disable as an unexamined optimization on RXD. Any output inversion, reused pin or external transceiver changes the board-level interpretation.

```c
/* Example GPIO preparation for USART0 DEFAULT, after ownership checks. */
PORTB.OUTSET = PIN2_bm;
PORTB.DIRSET = PIN2_bm;
PORTB.DIRCLR = PIN3_bm;
```

Under exclusive disabled ownership, select route, set checked BAUD, choose normal asynchronous 8N1, prepare pins, establish software state and intended interrupt enables, then enable requested TX/RX directions. The approved recipe explicitly keeps ODME, SFDEN, MPCM and advanced receiver modes off; do not inherit previously selected features. Global interrupt delivery starts only after the application's sources and shared data are ready. Reinitialization during traffic is a separate operation.

Include xc.h once and the needed standard/interrupt headers. Actual device symbols come from the pinned/installed pack. The compiler's 16-bit BAUD write behavior and hardware timing are distinct from JSON resource validation.

## Approved generation: baud arithmetic and timing limits

For asynchronous operation, `BAUD = round(64 * CLK_PER_Hz / (S * requestedBaud))`; S=16 for the approved Normal-Speed mode. The 16-bit fixed-point value must be 64 through 65535. The actual nominal baud for that value is `64 * CLK_PER_Hz / (S * BAUD)`. Integer bits are 15:6 and fractional bits are 5:0; this is not the classic AVR UBRR formula.

Use the actual post-prescaler peripheral clock. F_CPU does not configure the oscillator, prove its fuse selection or account for physical frequency error. The existing backend calculator supplies checked integer constants and deterministic error values. In C, widen before multiplication or use supplied checked constants; validate range before uint16_t conversion.

For an established CLK_PER=20 MHz and requested 115200 baud, Normal-Speed BAUD is 694. This example does not choose 20 MHz for an unknown board. Changes to BAUD take effect immediately and corrupt active TX/RX, so write it only with the needed directions quiescent.

Budget quantization, local oscillator error, peer error, frame length and sampling margin together. The validator's rounding-error policy does not prove total link tolerance. DS40002234B tables on pages 299–300 give these recommended receiver-error magnitudes by data-plus-parity bits D:

| D | Normal-Speed | Double-Speed, reference only |
|---|---|---|
| 5 | 3.0% | 2.5% |
| 6 | 2.5% | 2.0% |
| 7 or 8 | 2.0% | 1.5% |
| 9 | 1.5% | 1.5% |
| 10 | 1.5% | 1.0% |

Use the table with its frame/sampling assumptions, not as a guarantee that any pair of devices within the rounding limit communicates. Normal-Speed samples 16 times per bit, uses center samples 8/9/10 and accepts a start when at least two are low; the data/parity/first-stop decision also uses majority voting. Double-Speed uses eight samples and centers 4/5/6, with reduced margins and a source discrepancy discussed below.

## Approved generation: buffer-ready and physical completion

DREIF means the transmit buffer can accept another frame. It does not mean the last stop bit has left TXD. Check live DREIF before each queued frame. TXCIF means the full shift register and buffered transmission are complete. Use physical completion for retuning, clock shutdown or a half-duplex handoff, not merely because a software pointer reached the end of a buffer.

```c
static void uart0_put_byte(uint8_t value)
{
    while ((USART0.STATUS & USART_DREIF_bm) == 0u) {}
    USART0.TXDATAL = value;
}
```

This polling primitive assumes initialized TX, a running USART clock, one TXDATA owner and an application permitted to wait. A timeout/disconnect/error policy is needed when the task cannot tolerate unbounded waiting; do not put this blocking primitive in an ISR or mix it with an interrupt driver that owns the same data register.

TXCIF is W1C. A direct `USART0.STATUS = USART_TXCIF_bm` is correct acknowledgement, but its placement depends on transfer ownership. Clearing before a new operation is safe when the transmitter is known physically idle and one serialized owner prevents an earlier frame from completing between the clear and the new write. Merely knowing DREIF=1 is insufficient.

For continuous or interrupt-buffered traffic, define which queued frame completion belongs to the operation. The existing reviewed TX recipe uses a controlled completion protocol; do not paste the colleague's unconditional preclear as a general solution. A design that clears after queuing must also prove the clear cannot occur after that new frame has completed, including preemption and highest supported baud. Clearing a completion flag late can lose the completion being awaited. Preserve mixed STATUS semantics: direct intended W1C masks, never |= over live unrelated flags or WFB.

Disabling TXEN is not an immediate abort: current and buffered frames finish, then TXD returns to PORT and is automatically configured as input. Define the idle line after that ownership change.

## Approved generation: RX data, status and loss handling

When live RXCIF reports unread data, ordinary 8N1 reception must save RXDATAH before RXDATAL. RXDATAL advances the oldest frame, so reading it first loses the association between data and its error bits.

```c
/* One RX owner; called only after RXCIF reports a pending frame. */
uint8_t status = USART0.RXDATAH;
uint8_t data = USART0.RXDATAL;
uint8_t errors = status & (USART_BUFOVF_bm | USART_FERR_bm | USART_PERR_bm);
```

Keep status and data together if enqueuing received frames. FERR means the first stop bit was low; PERR means parity failed when enabled; BUFOVF means data loss because hardware buffering could not accept the stream. An 8N1 application should still define framing/overrun policy; a Boolean “received” flag cannot preserve several bytes.

RXCIF reflects unread receive data and is not a software W1C flag. Drain in the configured order to flush without disabling. RXEN=0 disables immediately, flushes buffered data and discards a partial frame. Unlike TX disable, it does not wait for the line to finish. A flush under a continuously incoming stream needs a bounded policy, otherwise a “clear stale data” loop can run forever.

One context owns the data-register pair. Interrupt masking can prevent competing CPU reads but does not stop incoming frames. A two-byte register sequence is a logical operation; do not allow an ISR and main to each consume part of it. The physical hardware buffer, software queue and protocol framing are different layers, each with an explicit overflow/recovery policy.

## Approved generation: bounded interrupt transmission and queue policy

The approved DRE transmitter must define buffer lifetime, length and ownership. Publish the pointer/length/state safely before enabling DREIE; handle zero length without starting a transfer and reject or queue a request when another transfer still owns the buffer. Do not reuse a stack buffer or overwrite a message while the ISR reads it. Main and ISR updates to multi-byte pointers/counts require the shared interrupt methodology's atomic protocol.

A DRE ISR supplies bounded work, normally one frame, and disables DREIE when no next data are available. Leaving DREIE enabled with an empty software source repeatedly requests an interrupt. Empty software data means all bytes have been handed to hardware, not that transmission is physically complete. Use a separate TXC completion state when the application requires wire-idle semantics.

Do not enable TXC interrupts unless there is actual end-of-transmission work. Do not busy-wait for DRE/TXC, delay, call a general printf path or drain an unbounded producer queue inside a USART ISR. Formatting happens outside the ISR. When using snprintf, check a negative return before unsigned conversion and reject/truncate deliberately if its reported length is at least the buffer capacity.

For future receive queues, estimate required capacity from peak frame rate, maximum main-service delay and worst interrupt-masking interval, with a deliberate burst margin and overflow policy. At 8N1 there are ten line bits per frame; payload bytes per second are not the baud number. Hardware BUFOVF and software queue-full are distinct losses. A queue is warranted by the requirements, not added to every minimal transmitter.

## Reference only: frame formats, 9-bit access and shared vectors

The USART supports 5–9 data bits, optional even/odd parity and one or two transmitted stop bits. The receiver examines only the first stop bit; SBMODE does not make it validate a second. Host SPI is always eight raw data bits and uses a different CTRLC view.

| CHSIZE | TX first / second (queues frame) | RX first / second (advances buffer) |
|---|---|---|
| 9BITL | TXDATAL / TXDATAH | RXDATAL / RXDATAH |
| 9BITH | TXDATAH / TXDATAL | RXDATAH / RXDATAL |

Other ordinary RX formats use RXDATAH then RXDATAL. Treat each pair as one owned transaction and follow the selected format consistently. The queuing write requires DRE readiness, and the ninth received bit belongs to the same saved status/data frame. A generic 16-bit C read of adjacent USART registers is not a substitute for the documented ordering and side effects.

USARTn_RXC_vect can serve RXCIF/RXCIE, RXSIF/RXSIE and ISFIF/ABEIE. Inspect every enabled pending source when more than one is used. RXCIF clears by consumption; RXSIF/ISFIF use direct W1C, with the additional auto-baud recovery required below. USARTn_DRE_vect is buffer service; USARTn_TXC_vect is physical completion. Do not apply a universal “clear all flags at entry” template to the shared RXC vector.

## Reference only: synchronous USART and Host SPI

For synchronous Host, XCK is output; for Client it is input. With XCK INVEN=0, transmit/start occurs on rising edges and receive samples on falling edges. INVEN=1 reverses those edges. Resolve the full selected route and external clock relationship before code, not just a convenient XCK pin.

Synchronous Host uses the integer `BAUD[15:6]` with the low six bits zero and `f_bit = CLK_PER/(2 * integerDivider)`. Select a valid nonzero field and check rounding/range; do not write an asynchronous fractional result. For Client, external XCK must be below CLK_PER/4, and jitter/duty distortion require further reduction so each high/low interval is at least two CLK_PER clocks.

Host SPI maps TXD=MOSI, RXD=MISO and XCK=SCK. It has no SS signal, no standalone-SPI write-collision protection, no double speed and no Multi-Host support. Supply chip-select timing separately. Receiver error flags used by framed USART are not meaningful there.

| XCK INVEN | UCPHA | Leading edge | Trailing edge |
|---|---|---|---|
| 0 | 0 | Rising sample | Falling transmit |
| 0 | 1 | Rising transmit | Falling sample |
| 1 | 0 | Falling sample | Rising transmit |
| 1 | 1 | Falling transmit | Rising sample |

UDORD chooses MSb-first (0) or LSb-first (1). Set the SPI-specific CTRLC fields and clock polarity/phase intentionally while traffic is stopped; asynchronous parity/stop-bit configuration is not applicable to that register view.

## Reference only: One-Wire and RS-485 with Rev. E correction

LBME routes TXD internally to the receiver and disconnects RXD. ODME is intended to allow only low drive while a pull-up establishes high, permitting multiple devices to share a line. Self-reception can help detect overlapping transmissions, but matching sent/received data is not a complete arbitration, timeout or retry protocol.

**DS80000902F section 2.8.1: on Rev. E, TXD configured as output can drive high despite ODME. Configure the TXD PORT direction as input for open-drain operation.** The colleague's default-output text and diagram omit this condition and cannot be copied as an electrical guarantee. A future driver must retain that direction when enabling ODME/TX/RX, select a suitable pull-up and validate bus current/rise time. Do not apply the ordinary asynchronous DIRSET initialization to One-Wire.

The original chapter's sequence—loopback, pull-up, ODME, baud, frame, enable—describes the feature but requires the silicon correction and a complete shared-line ownership design. A final CTRLB assignment must preserve intended mode bits, not accidentally erase ODME; conversely those bits must stay off in ordinary approved UART.

RS-485 uses an external differential transceiver. XDIR asserts one baud-clock period before shifting begins, remains asserted through the complete frame/stop bits, and deasserts when hardware transmission completes. It is a driver-enable signal, not the differential interface itself. Verify XDIR route, polarity, transceiver turnaround, termination, biasing and protection. A drawing of one frame does not establish inter-frame gaps, software completion ownership or a complete multidrop protocol.

## Reference only: auto-baud, MPCM and source ambiguities

GENAUTO measures a sync field after a break and can use WFB for arbitrary break length; LINAUTO requires its constrained break and 0x55 sync character. The source on page 301 describes a measured range 0x0064–0xFFFF and specific sample/clock break wording. Preserve those as source details rather than replace them with the ordinary asynchronous lower bound or infer complete LIN protocol compliance from the chapter alone. CTRLD.ABW selects windows WDW0=32±6, WDW1=32±5, WDW2=32±7 or WDW3=32±8 samples. BDF reports the recognized break/sync and clears on subsequent data or W1C.

**DS80000902F section 2.8.3: when ISFIF is set in GENAUTO/LINAUTO on Rev. E, clearing the flag does not restore the receiver. Disable RXEN, then enable it again.** Preserve the intended other CTRLB bits and account for flushing/loss. This is an explicit recovery state transition, not permission for a blind |= sequence racing another owner. A future protocol must handle malformed sync and recovery while incoming traffic continues.

MPCM filters unaddressed frames. In 5–8-bit formats, the first stop bit marks address=1/data=0 and the transmitter needs two stop bits; in 9-bit formats the ninth bit is the marker. Clients initially listen for an address, the addressed client disables filtering for its data and re-enables it at the defined end. Framing, address validation and resynchronization remain protocol responsibilities. The LIN protected identifier uses P0=ID0 XOR ID1 XOR ID2 XOR ID4 and P1=NOT(ID1 XOR ID3 XOR ID4 XOR ID5), not ordinary frame parity.

Two source discrepancies remain: STATUS's header reset value 0x00 conflicts with the DREIF reset row implying 0x20 (page 311); RXMODE's restriction on page 314 conflicts with asynchronous CLK2X described on page 300. Poll live DREIF after configuration, not a presumed power-on value. Keep CLK2X reference-only under the current policy; its presence in the header does not resolve the text conflict. Do not silently delete these uncertainties because one interpretation seems likely.

## Reference only: Start-of-Frame, IRCOM, events and debug

SFDEN is intended to wake from Standby on RXD's falling start edge. Oscillator startup must fit the baud/frame timing. RXSIE can wake on start, RXCIE on complete reception; using neither can leave only the oscillator running during reception and does not solve buffer overflow.

**DS80000902F section 2.8.2: keep SFDEN=0 in Active mode on Rev. E.** Reading RXDATA while new data arrives can otherwise restart reception on a later falling edge and corrupt data without a useful RXSIF interrupt. Re-enable SFDEN only before Standby under a protocol that prevents a new frame during that transition; a frame already arriving can be corrupted. Enabling SFDEN alone is not a safe sleep-entry implementation. Approved active UART deliberately disables it.

IRCOM supplies IrDA-style pulse encoding up to 115200 baud, with inverted pin/pulse interpretation. TXPL=0 means 3/16 of a bit; values 1–254 specify CLK_PER pulse cycles and 255 disables pulse coding. Configure TXPLCTRL before TXEN. RXPL=0 disables filtering; 1–127 require RXPL+1 samples. Configure RXPLCTRL before RXEN. Double-speed is not supported with IRCOM. An external optical/electrical interface remains necessary.

IREI can route a synchronous EVSYS pulse to the IRCOM receiver instead of RXD. USART XCK is an event generator in synchronous Host/Host SPI. EVSYS channel/user setup and available routes are separate facts; the USART chapter does not provide a complete event project.

DBGRUN chooses whether USART continues while the CPU is halted; without it, USART halts and ignores events. A peer can keep sending while debugging, so altered timing and lost frames are not ordinary throughput measurements. Sleep/clock policies must preserve the source until required traffic completes.

## Reference only: runtime reconfiguration and verification

A reusable driver first prevents new TX submissions and coordinates its queue/ISR owner. If anything is in flight, wait for completion of that transfer using a correctly owned TXC protocol; if already known idle with no transfer, do not wait forever for an event that will never occur. Decide whether unread RX data must be preserved or discarded and coordinate the peer so reception does not straddle a new baud/frame configuration.

Disable the affected source interrupts and TX/RX as required, respecting delayed TX release and immediate RX flush. Change routing, pins, mode and BAUD only after the corresponding paths are quiescent, clear/drain only intended stale state, restore software state and re-enable the selected directions/source interrupts. Do not hold unrelated interrupts disabled across an unbounded wait, and do not let another context access a data pair while its mode/access order changes.

Verification should cover ordinary and maximum traffic, malformed frames, disconnection, RX hardware overrun, software queue overflow, zero/oversize messages, ownership of buffer memory, first/last-byte TXC races, interleaved contexts and reinitialization. Advanced modes need their additional errata/edge/pin/transition tests. The exact existing fixture's compiler pass does not verify every snippet or hardware interface described here; preserve actual compilation and hardware evidence separately.
