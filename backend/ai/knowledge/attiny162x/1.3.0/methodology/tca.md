# ATtiny1624/1626/1627 TCA methodology

Curated from the colleague's TCA reference, YAML model and source guide. Hardware sources: DS40002234B chapter 21, pages 194–242, and DS80000902F section 2.6.1, page 4. Source hashes, line ranges and adoption decisions are in `provenance/adoption-peripherals.json`. Register offsets and complete bitfield tables remain in the canonical local DFP/PDF reference; this document explains how to use them.

## Scope, ownership and terminology

Approved generation remains `avr-timer`: TCA0 SINGLE, WGMODE NORMAL, upward counting, periodic overflow, disabled startup, checked period, no live retuning. Frequency outputs, PWM, Split mode, events, restart commands and sleep operation below are reference only. Understanding them does not add validator support.

Distinguish the 16-bit SINGLE register view from WGMODE NORMAL. SINGLE also contains FRQ and PWM modes; “normal-mode registers” in the source sometimes means the SINGLE view rather than WGMODE=0. SPLITM changes the register interpretation to two 8-bit timers. Choose the view before interpreting CNT, PER, compare registers or flags.

In SINGLE, TCA owns one 16-bit counter, PER, three compare channels and their buffers. The same peripheral cannot simultaneously provide an unrelated independently configured timer. In SPLIT, the low/high counters have separate periods but still share clock selection, enable, standby and debug controls. A TCB using the TCA clock or synchronization adds a dependency on this configuration.

BOTTOM is zero, MAX is all ones, TOP is the mode's final count value, and UPDATE is the mode-specific point where valid buffers transfer. The counter condition and its observable interrupt/event/waveform action are separated by the next CLK_TCA cycle. Do not equate a CPU register write with an immediate edge at a physical pin.

## Approved generation: clock and overflow calculation

The allowed TCA clock divisors are 1, 2, 4, 8, 16, 64, 256 and 1024. There is no DIV32 or DIV128 selection. The input is actual post-prescaler CLK_PER; F_CPU is only a declaration and does not configure it.

For upward NORMAL counting through zero to PER inclusive:

```text
ticks = round(CLK_PER_Hz * requestedPeriodUs / (divisor * 1000000))
PER = ticks - 1
nominalPeriodUs = (PER + 1) * divisor * 1000000 / CLK_PER_Hz
```

Check 1 <= ticks <= 65536 before narrowing. Select a divisor that fits and report quantization against the requirement; normally prefer the smallest fitting divisor if the finer resolution matters. The backend `calculateTimerPeriod` uses exact integer intermediates and supplies the checked register value, matching clock symbol and timing result. C calculations must widen before multiplication and check intermediate range; casting only the final quotient is too late.

For an already established 20 MHz CLK_PER, 500000 microseconds and DIV1024, rounded ticks are 9766, PER=9765 and the nominal configuration interval is 500019.2 microseconds. This is a calculation example, not a default clock or an electrical suitability claim. At 20 MHz the legacy expression `(F_CPU/divisor)*periodUs` can exceed 32-bit range before division. A CPU clock, source fuse and operating conditions still need the existing clock recipe when the project selects them.

## Approved generation: disabled startup and bounded overflow service

Reserve TCA0 and TCA0_OVF_vect. Establish the intended SINGLE/NORMAL/up-counting state while disabled; do not inherit a previous mode. Configure required GPIO independently, set CNT to the intended start value, write the checked PER, clear stale overflow by direct W1C assignment, enable only OVF, then enable the selected divisor. Initialize all shared software state before global interrupt delivery.

The following is a configuration fragment; `TCA_PER_VALUE` must come from the validated project's timing calculation, and DIV1024 is appropriate only for that calculation:

```c
/* TCA0 is owned, disabled and already in SINGLE/NORMAL/up-counting state. */
TCA0.SINGLE.CNT = 0u;
TCA0.SINGLE.PER = TCA_PER_VALUE;
TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;
TCA0.SINGLE.INTCTRL = TCA_SINGLE_OVF_bm;
TCA0.SINGLE.CTRLA = TCA_SINGLE_CLKSEL_DIV1024_gc | TCA_SINGLE_ENABLE_bm;

/* Exactly one definition in the complete application. */
ISR(TCA0_OVF_vect)
{
    TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;
    /* Short bounded action; defer lengthy work to main. */
}
```

Vector entry does not clear OVF. Writing `INTFLAGS |= mask` can clear other captured flags unintentionally. The shared interrupt methodology controls atomic consumption, prior interrupt-state restoration and Boolean/counter overflow policies. Counting ISR entries does not prove every physical overflow was serviced: the hardware flag can coalesce occurrences during masking or excessive latency.

Do not shrink active PER below a running upward CNT. The equality with the new TOP may already have passed, causing a long count through MAX before the next TOP. The approved recipe configures while disabled and does not offer live period updates.

## Reference only: mode matrix and waveform equations

DS40002234B sections 21.3.3.4 and 21.5.2, pages 199–202 and 210, define different equations and update points. Do not reuse the NORMAL overflow formula as a universal PWM equation.

| WGMODE | TOP | UPDATE in the documented sequence | OVF condition | Output behavior |
|---|---|---|---|---|
| NORMAL (0) | PER | TOP when counting up | TOP when counting up | No waveform generation |
| FRQ (1) | CMP0 | TOP when counting up | TOP when counting up | Toggle at compare |
| SINGLESLOPE (3) | PER | BOTTOM | BOTTOM | Set at BOTTOM, clear at up-compare |
| DSTOP (5) | PER | BOTTOM | TOP | Dual slope |
| DSBOTH (6) | PER | BOTTOM | TOP and BOTTOM | Dual slope |
| DSBOTTOM (7) | PER | BOTTOM | BOTTOM | Dual slope |

Encodings 2 and 4 are reserved. The three dual-slope modes have the same waveform shape but different interrupt cadence; DSBOTH can give two overflow conditions per waveform period.

With divisor N and established CLK_PER frequency f:

```text
FRQ output frequency:          f / (2 * N * (CMP0 + 1))
Single-slope PWM frequency:    f / (N * (PER + 1))
Dual-slope PWM frequency:      f / (2 * N * PER)
PWM resolution in bits:        log2(PER + 1)
```

The documented PWM resolution range is PER=3 through 65535, or 2 through 16 bits. Dual-slope uses PER, not PER+1, in the period denominator. As a pure arithmetic comparison at f=1 MHz and N=1, FRQ CMP0=499, single-slope PER=999 and dual-slope PER=500 all produce nominal 1 kHz. These are alternative mode calculations, not three interchangeable initializations or approved clock settings.

Single-slope counts upward only; CMP=0 gives static low and CMP>TOP gives static high. Dual-slope clears on the up-compare and sets on the down-compare; CMP=0 gives static low and CMP=TOP gives static high. Those endpoint rules differ. At maximum 16-bit TOP, a single-slope “greater than TOP” value cannot be represented; a future 100% duty design must address that explicitly instead of overflowing the compare value.

## Reference only: frequency output phase

FRQ uses CMP0 as TOP. WO0 toggles each match, so its full period includes two count cycles and its maximum frequency is CLK_PER/2. CMP1/CMP2 can create additional phase-offset outputs, but phase depends on direction and the counter state when enabled or changed.

For CMPn<CMP0, Table 21-2 on page 200 gives two offset magnitudes for waveform period T:

```text
A = (CMP0 - CMPn) / (CMP0 + 1) * T/2
B = (CMPn + 1) / (CMP0 + 1) * T/2
```

| Counter state when configured | Equation | WOn relative to WO0 |
|---|---|---|
| Up, CMPn >= CNT | A | Leading |
| Down, CMP0 <= CNT | A | Trailing |
| Down, CMP0 > CNT and CMPn > CNT | A | Trailing |
| Up, CMPn < CNT | B | Trailing |
| Down, CMPn <= CNT | B | Leading |

The source diagrams show missed or doubled matches when unbuffered compare values change at runtime. Do not promise phase from CMPn alone, apply the table outside CMPn<CMP0, or use runtime compare writes as a generic glitch-free phase-control API. Rev. E restart also changes direction, as described below.

## Reference only: buffering and coordinated updates

SINGLE has PERBUF and CMP0BUF–CMP2BUF. Writing a buffer sets its valid flag. At the appropriate UPDATE, valid buffers copy to active registers and their valid flags clear; a new compare is used from the following count. Direct active-register writes bypass that protection and can miss a TOP or compare.

LUPD blocks mode-generated updates. To coordinate several values, a future driver can set LUPD, stage the complete intended group, and release it before the chosen update boundary. It must define which context owns the group and what happens if a second update is requested before the first is consumed. Merely using buffer names does not make a multi-register update atomic at the application level.

ALUPD sets LUPD and releases it after all enabled compare-channel buffers are valid; after UPDATE it locks the next group again. The release condition is the enabled compare channels, not PERBV. Do not assume that writing PERBUF alone releases ALUPD, or that an unwritten enabled channel is irrelevant. Stage a period change deliberately with the compare group if they must take effect together.

`CMD=UPDATE` forces transfer even while LUPD is set. It can therefore defeat a deliberate lock and alter phase; do not issue it as a harmless “commit” without examining the waveform requirement. CTRLESET/CLR and CTRLFSET/CLR offer write-one set/clear views for their state bits. These semantics are not the same as W1C interrupt flags.

## Reference only: commands, register access and mode changes

CMD NONE does nothing, UPDATE forces buffers, RESTART forces a restart, and RESET performs a hard peripheral reset only when ENABLE=0. The command field reads as zero. Do not read-modify-write commands as if they were persistent state, and do not expect RESET to work on an enabled timer.

**Rev. E correction:** DS80000902F section 2.6.1 states that a RESTART command or restart event in NORMAL/FRQ resets direction to upward counting; there is no workaround specified. Do not promise to retain downward counting across restart or represent that behavior only as an abstract reset detail. A subsequent direction write is a separate operation with its own timing effects, not a documented workaround.

Changing SPLITM reinterprets existing stored register values; it does not clear them. Stop the peripheral, issue the appropriate hard RESET, choose SINGLE or SPLIT and configure that view completely before enabling. SPLIT commands require the documented CMDEN selection; RESET must target BOTH, and UPDATE is reserved. Do not apply SINGLE CMD encodings without considering the additional SPLIT target field.

CNT/PER/CMP/PERBUF/CMPBUF in SINGLE are 16-bit and share TCA.TEMP for CPU access. Use header members and check the target/compiler sequence. Any interrupt accessing another register sharing TEMP can interfere with a two-byte access. CPU atomicity does not prevent the timer from progressing; stable measurement and update design still need the relevant hardware mechanism. SPLIT active counter/period/compare fields are 8-bit, with different names and no buffers.

## Reference only: Split mode and waveform routing

SPLIT provides low LCNT/LPER/LCMP0–2 and high HCNT/HPER/HCMP0–2. Both count downward only and provide fixed single-slope PWM behavior. WO0–2 belong to the low half; WO3–5 to the high half. A waveform is cleared at BOTTOM and set on compare; maximum duty is TOP/(TOP+1), so the endpoint behavior differs from SINGLE PWM.

No event-controlled counting, buffer registers or valid flags exist in SPLIT. Low compare interrupts exist, but high compare interrupts/flags do not. Both halves have underflow interrupts/events. Treat the shared enable/clock/standby/debug configuration as owned state; two “independent timers” are not independently clocked peripherals. Direct period/compare updates require a deliberately designed glitch/phase policy.

A peripheral waveform reaches a pad only after the correct route, pin direction and output enable are established. SINGLE requires a waveform WGMODE and CMPnEN; SPLIT uses its low/high output enables. Resolve exact package pins through the canonical pin profile and PORTMUX data; these chapter-level output numbers are not physical pin numbers.

TCA overrides PORT.OUT while the channel owns the output. PORT PINnCTRL.INVEN also inverts that waveform. CTRLC exposes internal compare-output values while disabled; pad visibility still depends on the output enable, whereas a CCL path may bypass that enable. Establish the safe board state before enabling override and before releasing it. Do not infer that clearing PORT.OUT overrides a live peripheral waveform.

## Reference only: events, low power and verification

TCA event generators are one-CLK_PER pulses: OVF/LUNF, HUNF in SPLIT, and CMP0–2/LCMP0–2 according to the view. A peripheral interrupt enable is not required for an event generator.

SINGLE has CNTA and CNTB users. CNTA can count positive/any edges, count prescaled clocks while high, or use level for direction. CNTB can use level for direction or restart on a positive edge, any edge or high level. When both control direction, the signals are ORed and both must be low for upward counting. Level-controlled actions require event frequency below the timer frequency; a pin edge is not automatically a valid EVSYS route. SPLIT has no such event inputs. Refer to the full EVSYS and silicon errata before implementing routes or restart actions.

TCA stops in Standby by default, can operate there with RUNSTDBY, and stops in Power-Down. Its clock must also remain available. DBGRUN chooses whether it halts and ignores events when the CPU is stopped in the debugger. These are device behavior facts, not sleep-entry or power-consumption guarantees.

Future waveform/event support needs mode-specific tests: TOP/compare endpoints, update boundaries, ALUPD incomplete groups, simultaneous channel updates, direct-write hazards, mode transition/reset, restart direction, route ownership, pulse phase and latency. Existing overflow fixture compiler evidence does not verify PWM, split operation, events or physical pin waveforms.
