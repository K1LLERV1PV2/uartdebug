# ATtiny1624/1626/1627 TCB methodology

Curated from the colleague's TCB reference, YAML model, source guide and four explanatory SVGs. Hardware sources: DS40002234B chapter 22, pages 243–265, and DS80000902F section 2.7.1, pages 4–5. Source hashes, line ranges and adoption decisions are in `provenance/adoption-peripherals.json`.

## Reference only: scope and peripheral model

No TCB mode is approved by the current generation validator. This document preserves useful design methodology for review, lookup and future implementation; examples are explanatory fragments, not tested TCB drivers. A DFP symbol or readable reference does not authorize the model to replace an unsupported request with unvalidated TCB code.

Each TCB has a 16-bit CNT, a 16-bit CCMP capture/compare register, clock/event control, one waveform output and CAPT/OVF flags sharing one vector. The meaning of CCMP and CAPT depends on CNTMODE. Choose the instance, mode and clock before treating CCMP as TOP, a captured value or two logical PWM quantities. Check the selected device/pack for available instances and the package/PORTMUX for its WO pad.

Reserve all dependencies: the TCB itself, any TCA clock/synchronization source, COUNT/CAPT event routes, waveform pin and software result storage. Changing a TCA prescaler affects a TCB using CLK_TCA. Event routes and peripheral outputs do not eliminate pin or configuration ownership.

## Reference only: clock, event users and synchronization

CTRLA.CLKSEL chooses CLK_PER (DIV1), CLK_PER/2 (DIV2), the TCA0 timer clock, or positive edges on the COUNT event input (EVENT). Other documented selector encodings 3–6 are reserved. A generic numerical prescaler is not supported: do not invent DIV4, DIV8 or arbitrary clock constants.

CAPT and COUNT are different Event System users. COUNT edges supply the counter clock when CLKSEL=EVENT. CAPT, enabled by EVCTRL.CAPTEI, causes the action selected by CNTMODE and EDGE. Using a CAPT trigger does not imply that event edges must also be the count clock. Read both the clock and event sections rather than relying on a shortened initialization sentence.

SYNCUPD ties TCB restart to its associated TCA restart/overflow as described in CTRLA. Selecting CLK_TCA provides a common clock; enabling synchronization additionally affects phase. Establish which TCA mode and update events drive the relationship and ensure that another owner cannot retune or restart it unexpectedly.

FILTER accepts a new event level after four equal samples and adds four CLK_PER cycles of latency. It uses the peripheral clock, not the selected TCB prescaler. Synchronous CAPT inputs require at least one CLK_PER period; asynchronous Single-Shot detection can accept shorter edge events. A filter improves rejection of short disturbances but also changes accepted pulse widths and timestamps. Include its latency in a measurement specification instead of treating it as a free default.

## Reference only: all eight modes and their results

DS40002234B sections 22.3.3.1 and 22.5.5, pages 245–250 and 260:

| CNTMODE | CCMP role | Condition that sets CAPT | Key lifecycle |
|---|---|---|---|
| INT (0) | Period TOP | Count reaches TOP | Restart from zero |
| TIMEOUT (1) | Timeout TOP | TOP reached before stop edge | Selected edge starts, opposite edge freezes |
| CAPT (2) | Captured CNT | Capture event | Counter continues to MAX |
| FRQ (3) | Captured period count | Selected edge captures/restarts | Next edge defines next interval |
| PW (4) | Captured width count | Opposite edge captures width | Automatic start/capture edge alternation |
| FRQPW (5) | Captured width; CNT holds period | Second same-polarity edge stops | Read CNT before CCMP to preserve the pair |
| SINGLE (6) | Pulse TOP | Pulse counter reaches TOP | One pulse for an accepted event |
| PWM8 (7) | Low byte is period TOP, high byte duty count | Duty compare | Repeating 8-bit PWM; paired access required on Rev. E |

Do not change CNTMODE while enabled; the output can become unpredictable. Configure disabled state, clock/mode, values, events, safe output and flag policy before enabling. Configuration itself can set an interrupt flag, so clear the intended stale flags after configuration. A reset into INT does not justify assuming INT in a reusable initialization routine.

## Reference only: periodic timing and timeout

INT counts from zero through CCMP and restarts. For a periodic design, compute ticks from the actual TCB clock and use CCMP=ticks-1 only after the chosen clock and mode's counting semantics are established; require a representable 16-bit result and check arithmetic before narrowing. There is no general buffering promise for a live CCMP write. Lowering TOP below running CNT misses the equality, so CNT may continue through MAX, set OVF, wrap and then reach the new TOP.

CAPT is the normal periodic interrupt condition. OVF denotes MAX-to-zero wrap, not a synonym for each INT period. A generic “overflow interrupt timer” written for TCA cannot be transplanted to TCB just by changing the instance name. EDGE/CAPTEI do not supply a periodic-mode capture action.

TIMEOUT measures whether a stop edge arrives before TOP. EDGE=0 starts on a positive edge and stops on a negative edge; EDGE=1 reverses them. A reached TOP sets CAPT. The frozen state is not restarted by reading CNT/CCMP, and STATUS.RUN is read-only; writing it is not an arm command. Define the timeout response, re-arm sequence, pending flag policy and missing/extra-edge behavior before implementing a driver.

## Reference only: capture, frequency and pulse-width acquisition

CAPT mode continuously counts zero to MAX. A selected edge copies CNT into CCMP while counting continues; EDGE=0 selects positive, EDGE=1 negative. On entering from another mode, the chapter recommends CNT=0. FRQ captures at a selected edge and restarts CNT, so repeated edges produce interval measurements. Both modes can wrap and set OVF. A captured low word plus a Boolean OVF flag is insufficient to count an unbounded number of wraps.

In PW, EDGE=0 starts on a rising edge and captures on the following falling edge; EDGE=1 measures the opposite polarity. Hardware switches edge selection for the sequence. The source requires at least two clock cycles between successive PW edges; a future design must apply this with the selected synchronization/filter path and timing domain, rather than infer unlimited edge rate from the timer frequency alone.

Reading the low byte CCMPL clears CAPT in capture modes. A normal 16-bit CCMP access therefore has a hardware side effect. Save status and results in the intended sequence; do not read CCMP speculatively for debugging or clear CAPT before deciding which result belongs to it. A later capture can overwrite the result even while CPU interrupts are disabled. Define a maximum capture rate, a handshake/gated source or a mode that stops for software acquisition.

For FRQPW with EDGE=0: first rise starts, fall captures width into CCMP, second rise stops with period in CNT and sets CAPT. EDGE=1 reverses the polarities. Read CNT first, then CCMP; the latter clears CAPT and arms the next sequence. The next start edge may reset CNT, so reversing this order can mix measurements.

```c
/* Reference fragment: CAPT reports a completed FRQPW sequence;
 * one owner reads these registers and the compiler access sequence is verified.
 */
uint16_t period_count = TCB0.CNT;
uint16_t pulse_count = TCB0.CCMP;
```

Keep the pair together in software. Convert to units using the actual count clock, validated edge/count convention and accumulated synchronization/filter uncertainty. Do not blindly apply the periodic TOP+1 formula to a capture count. Reject zero or overflowed intervals before division, and distinguish quantization from source-clock accuracy and asynchronous-edge uncertainty.

## Reference only: cascaded 32-bit capture

The two-TCB design is a hardware cascade, not two sequential live CNT reads. Configure the low TCB's chosen count clock and capture mode with CASCADE=0. Route low OVF to the high TCB's COUNT user. Give the high TCB CLKSEL=EVENT, the same capture mode and CASCADE=1. Route the same capture event to both CAPT users. CASCADE delays the high capture by one CLK_PER to compensate carry propagation.

The resulting 32-bit word is formed from the two captured CCMP values. The colleague's C-like expression appears in the MD, YAML and capture SVG and is unsafe on AVR: shifting an unpromoted 16-bit value left by 16 is not a valid 32-bit composition. Widen before the shift:

```c
/* captured_msb and captured_lsb are stable results of the SAME capture event. */
static uint32_t combine_capture(uint16_t captured_msb, uint16_t captured_lsb)
{
    return ((uint32_t)captured_msb << 16) | (uint32_t)captured_lsb;
}
```

The cast fixes arithmetic width only. Acquisition must wait for the delayed high capture, establish that both captures belong to the same event, prevent overwrite/re-arm races while reading the pair, and respect each TCB's shared TEMP access. CPU cli alone cannot stop new hardware captures. The original chapter gives hardware cascade relationships but not a complete lossless software collection protocol; do not invent one from this composition helper. Test captures at low-word carry boundaries, successive-event pressure and wraparound before approving an implementation.

## Reference only: Single-Shot output and initial-pulse hazard

An accepted event starts a high pulse while the counter runs from BOTTOM to TOP. At completion, the output becomes low, counting stops and CAPT is set. A new event during the mandatory low interval of at least one CLK_TCB cycle is ignored. EDGE=0 permits positive-edge triggers; EDGE=1 permits either edge. This meaning of EDGE differs from the polarity selection in capture modes.

With ASYNC=0, the output follows synchronized counting. With ASYNC=1, the event sets the output immediately, but counting starts later. The output description on page 250 specifies two to three CLK_TCB cycles before counting starts; page 249's prose also describes a two-cycle delay. Preserve the phase-dependent conservative delay rather than claiming a pulse length based only on CCMP. The asynchronous output latency and the synchronous timer's interval are separate.

Enabling the peripheral or modifying EDGE while enabled can start counting without an external event. The documented prevention is to write TOP to CNT before enabling/changing EDGE; that is a mode-specific operation, not a universal reset pattern. Resolve initial output level, pending flags and safe pin ownership before enable. STATUS.RUN reports operation but does not itself control it.

CCMPEN enables the WO override only on the correctly routed output pin whose direction is configured as output. In SINGLE/PWM8, CCMPINIT does not select the waveform's initial behavior. Other modes may use CCMPINIT as the initial output level; do not copy that setup to single-shot without examining the mode.

## Reference only: PWM8 and mandatory Rev. E paired access

Logically, CCMPL is TOP and CCMPH is the high-time count. PWM period is CCMPL+1 timer clocks. The waveform is set at BOTTOM and cleared at the high-time compare; CAPT is set at that duty compare rather than at the period boundary. At a high-time value greater than TOP the waveform is high throughout the period; at zero it is low. Respect representable endpoint values instead of wrapping an 8-bit threshold to zero.

**DS80000902F section 2.7.1 overrides the preliminary model's independent-byte access implication. On Rev. E, CCMP and CNT still act as 16-bit registers in PWM8; their bytes cannot be read or written independently. Use 16-bit register access.** This applies even though the low and high bytes have separate logical meanings.

For a disabled, exclusively owned PWM8 configuration, a packed value can be constructed before one 16-bit CCMP assignment:

```c
/* Reference-only arithmetic; validate top and high_count before uint8_t conversion. */
uint16_t packed = ((uint16_t)high_count << 8) | (uint16_t)top;
TCB0.CCMP = packed;
```

Here `top` and `high_count` are uint8_t values already checked against the waveform requirement. Do not use independent CCMPL/CCMPH writes as a workaround, and do not assume a read/modify/write of CCMP is safe while the timer or another owner can change state. Review a complete disabled update policy before runtime changes.

Table 22-6 prints CCML/CCMH, while register descriptions and headers use CCMPL/CCMPH. Record this source terminology discrepancy; do not invent those misspelled members. Pinned DFP members settle spelling, while the erratum settles access width. Neither establishes a tested PWM8 driver.

## Reference only: flags, CPU access, low power and verification

CAPT and OVF share each TCB vector, with separate enables. Both support W1C; capture-value reads also clear CAPT in the documented modes. Determine which enabled source is pending and how its acknowledgement interacts with result acquisition. An unconditional W1C of both flags can discard unprocessed overflow information; an unconditional CCMP read can clear or re-arm capture. Use direct intended masks, not |=.

CNT and CCMP use the shared TEMP byte for CPU access. Use the actual device header's 16-bit members and inspect compiler code when byte order or interleaving matters. An ISR accessing another register of the same TCB may interfere with TEMP; keep the complete protected CPU operation together and restore the previous interrupt state. Hardware updates require an additional snapshot/capture strategy.

TCB halts in Standby unless RUNSTDBY is set, and halts in Power-Down. Its selected source must remain available, especially when it depends on TCA. DBGRUN chooses whether the peripheral continues during debugger halt; otherwise it halts and ignores events. Do not infer application power or timing under debugging from ordinary operation.

A future TCB approval requires actual instance/route and source verification, register-width and symbol checks, a coherent capture protocol, clock/quantization limits, flag dispatch, maximum event rate and latency, mode transition behavior and exact compiled firmware. Single-shot needs initial/guard/async-edge tests; cascades need carry-boundary tests; PWM8 needs Rev. E paired access and endpoint tests. This reference does not claim those checks or hardware measurements have occurred.
