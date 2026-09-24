# ATtiny1624/1626/1627 RTC and PIT methodology

Curated from the colleague's RTC reference, model and WR-RTC-01 through WR-RTC-12. Hardware source: DS40002234B chapter 23, pages 266–289, plus the pinned device pack. Silicon errata DS80000902F has no RTC-specific issue; that is not evidence of tested operation. Source hashes, line ranges and adoption decisions are in `provenance/adoption-peripherals.json`.

## Scope and choice of timing mechanism

Approved generation is limited to the existing `avr-rtc-pit` recipe: one-time startup after reset, internal nominal INT32K, fixed PIT periods, one RTC owner, no running RTC counter, correction, events, sleep entry or runtime reconfiguration. Other RTC material below is reference for understanding and future review; it does not extend the resource validator or approve generated code.

Choose a peripheral because its behavior meets the requested timing, not because it has more registers. PIT is a good first candidate for a simple periodic interrupt when one of its fixed periods is suitable. RTC counter operation is useful when arbitrary 16-bit periods, compare events, count reads or longer intervals are needed, but remains reference only. A software count of PIT occurrences changes the application design and must account for missed/coalesced interrupts; do not silently substitute it for an unsupported exact interval.

RTC and PIT share CLK_RTC, an internal prescaler counter, phase and correction. They have independent enables and flags. The RTC counter's `CTRLA.PRESCALER` selection is not an extra divisor in the PIT period equation. Stopping one function does not stop the common prescaler while the other is enabled. Shared clock or correction changes require ownership of both functions.

Establish the requested period/frequency, whether nominal timing is sufficient, acceptable first-edge behavior and any precision requirement. Ask only about a material missing requirement. A user requesting a nominal LED blink need not provide a clock tolerance, calibration measurement or CPU supply prerequisite merely to use the approved PIT configuration.

## Clock selection and CPU independence

DS40002234B sections 23.3/23.4.1.1 and 23.13.8, pages 267 and 281, distinguish four CLK_RTC sources:

| CLKSEL name | Nominal source | Availability in generation |
|---|---|---|
| INT32K | Internal 32768 Hz oscillator; reset selection | Approved PIT only |
| INT1K | Internal 1024 Hz source | Reference only |
| TOSC32K | External 32768 Hz crystal | Reference only; external circuit and CLKCTRL setup required |
| EXTCLK | External digital clock through TOSC1 | Reference only; input circuit and CLKCTRL setup required |

TOSC32K/EXTCLK need the corresponding CLKCTRL XOSC32K enable, source selection, standby policy and startup verification before selection. Check TOSC1/TOSC2 against the exact package and board. This RTC methodology is not a complete oscillator or crystal-design procedure.

RTC/PIT timing does not require F_CPU. For GPIO plus PIT with no CPU-dependent delay, use the existing `clock.hz: null` contract, leave CLKCTRL unchanged and omit F_CPU. Do not infer a reset CPU frequency of 3333333 Hz: division by six combines with the oscillator fuse's 16 MHz or 20 MHz selection. When another peripheral needs a CPU frequency, resolve that dependency through its own clock recipe.

The counter-read constraint is separate: CLK_PER must be at least four times CLK_RTC, regardless of the RTC counter prescaler. This is required when software reads RTC.CNT; it is not a reason to configure 20 MHz for a PIT-only blink. Clock configuration values establish nominal timing. Oscillator error, temperature, calibration and service latency are separate contributions to observed timing.

## Synchronization and 16-bit access

DS40002234B section 23.10 and register descriptions, pages 272–288, require checking the busy flag for each synchronized write. These are hardware clock-domain checks, not software delays:

| Write target | Status register | Busy mask |
|---|---|---|
| RTC.CTRLA | RTC.STATUS | RTC_CTRLABUSY_bm |
| RTC.CNT | RTC.STATUS | RTC_CNTBUSY_bm |
| RTC.PER | RTC.STATUS | RTC_PERBUSY_bm |
| RTC.CMP | RTC.STATUS | RTC_CMPBUSY_bm |
| RTC.PITCTRLA | RTC.PITSTATUS | RTC_CTRLBUSY_bm |

Wait immediately before the write. Wait afterward before relying on completion; a following check for the same register can supply this confirmation. Do not bypass a busy flag that remains asserted: investigate the selected source and its availability. CTRLA/CNT/PER descriptions specify two RTC clocks for update; do not invent the same fixed delay for CMP or PITCTRLA, whose individual descriptions do not quantify it.

For example, the approved PIT pattern uses its own status register:

```c
while ((RTC.PITSTATUS & RTC_CTRLBUSY_bm) != 0u) {}
RTC.PITCTRLA = RTC_PERIOD_CYC4096_gc | RTC_PITEN_bm;
while ((RTC.PITSTATUS & RTC_CTRLBUSY_bm) != 0u) {}
```

Reference-only counter work must also handle the shared RTC.TEMP byte used by CNT/PER/CMP access. Use the selected device header's 16-bit members and verify emitted compiler access order. If an ISR accesses any register sharing TEMP, protect the complete CPU access, preserving the previous interrupt state. Disabling CPU interrupts does not stop an asynchronous peripheral or substitute for synchronization. One-time setup before interrupts are enabled does not need a redundant CPU critical section when there is no concurrent owner.

## Approved generation: fixed-period INT32K PIT

Use a `rtc-pit` resource with `instance: RTC`, `clockSource: INT32K`, and `periodCycles` selected from powers of two 4 through 32768. `periodUs` is null or the nominal interval rounded to the nearest microsecond. The backend calculator returns the exact nominal fractional value and matching `RTC_PERIOD_CYC<n>_gc` symbol. OFF and reserved PERIOD encodings are not operating intervals.

The formula is `nominalPeriodUs = periodCycles * 1000000 / 32768`. Examples: 4 cycles gives 122.0703125 microseconds; 4096 gives exactly 125000 microseconds mathematically; 32768 gives 1000000 microseconds. A rounded microsecond field does not turn a fractional interval into exact hardware timing. Report any substitution of a supported period and its difference from the requirement.

The boot-only ownership contract requires RTCEN and PITEN still zero, no earlier RTC owner and unchanged shared correction. Set the dependent GPIO's safe state first. Explicitly select `RTC_CLKSEL_INT32K_gc`, clear PI, enable its source, then use the synchronized control write. Enabling global interrupts belongs after the whole application's initialization.

```c
/* One-time setup after reset; RTC counter/PIT have not been started. */
static void pit_init_after_reset(void)
{
    RTC.CLKSEL = RTC_CLKSEL_INT32K_gc;
    RTC.PITINTFLAGS = RTC_PI_bm;
    RTC.PITINTCTRL = RTC_PI_bm;
    while ((RTC.PITSTATUS & RTC_CTRLBUSY_bm) != 0u) {}
    RTC.PITCTRLA = RTC_PERIOD_CYC4096_gc | RTC_PITEN_bm;
    while ((RTC.PITSTATUS & RTC_CTRLBUSY_bm) != 0u) {}
}

ISR(RTC_PIT_vect)
{
    RTC.PITINTFLAGS = RTC_PI_bm;
    /* A short bounded action, such as an already allocated GPIO toggle. */
}
```

The requirement to select CLKSEL while both functions are disabled is this recipe's software ownership precondition, not a claim that the register enforces a write restriction. Do not stop somebody else's running RTC to make the precondition true. Writing only PITEN would discard PERIOD and select OFF.

DS40002234B section 23.5.2.2 and Figure 23-2, pages 268–270: enable does not establish a fresh phase. The first condition can occur virtually immediately through one full selected period. A 4096-cycle blink may have an initial off interval shorter than 125 ms; later uninterrupted hardware conditions have the nominal period. GPIO transitions additionally include ISR latency. An exact delayed first edge is a separate requirement.

## Reference only: RTC counter arithmetic and compare values

The 16-bit counter counts zero through PER, inclusive. With source frequency `f`, divisor `N` and requested period `T`, compute `ticks = round(T*f/N)` and `PER = ticks-1`; require 1 through 65536 ticks before narrowing. The nominal resulting period is `N*(PER+1)/f`. Available RTC prescalers are powers of two from 1 through 32768. Prefer the smallest divisor that fits the range when finer resolution is useful; a larger PER does not improve an already exact result.

Keep units explicit. Correct the colleague's UL-only millisecond macro: on AVR, multiplying two 32-bit unsigned-long operands can overflow before division. At 32768 Hz, 180000 ms, DIV128, the rounded result must be 46080 ticks (PER 46079), not 12526 ticks.

This arithmetic illustration uses 64-bit operands before multiplication and range checks. It is not an enabled RTC-counter driver:

```c
#include <stdint.h>
#define RTC_SOURCE_HZ UINT64_C(32768)
#define RTC_DIVISOR   UINT64_C(128)
#define RTC_PERIOD_MS UINT64_C(180000)
#define RTC_DENOMINATOR (UINT64_C(1000) * RTC_DIVISOR)
#define RTC_TICKS ((RTC_SOURCE_HZ * RTC_PERIOD_MS + RTC_DENOMINATOR / 2u) / RTC_DENOMINATOR)
#if RTC_TICKS < 1 || RTC_TICKS > 65536
#error "RTC period does not fit the 16-bit counter"
#endif
#define RTC_PER_VALUE ((uint16_t)(RTC_TICKS - 1u))
```

For runtime or arbitrary user-sized values, check multiplication/addition against UINT64_MAX before evaluating; a cast alone is not unlimited precision. Prefer the backend's checked constants where a supported calculator exists. Compare values must fit 16 bits, and a match intended within the cycle needs CMP <= PER. A known initial CNT must be established when the counter may have run. Preserve the distinction between comparator equality and the next count's output/flag action described in the chapter; do not promise cycle-perfect first behavior from PER alone.

## Reference only: counter initialization, dispatch and polling

With exclusive ownership and the counter disabled, configure its clock, synchronized PER/CMP and any required CNT, interrupt/event path, pending-state policy, then write complete CTRLA containing the selected prescaler, permitted options and RTCEN. Wait for synchronization before depending on startup. Do not overwrite prescaler/options by writing only RTCEN. Clock setup and interrupt enabling are independent of starting the counter.

OVF and CMP share `RTC_CNT_vect`; PI has `RTC_PIT_vect`. INTCTRL is the counter enable register, PITINTCTRL is the PIT enable register. Their flags are W1C. If both counter sources are enabled, acknowledge only the captured enabled sources and handle both:

```c
/* Reference-only counter dispatch fragment, not an approved counter driver. */
uint8_t pending = RTC.INTFLAGS & RTC.INTCTRL & (RTC_OVF_bm | RTC_CMP_bm);
RTC.INTFLAGS = pending;
if ((pending & RTC_OVF_bm) != 0u) { /* bounded overflow work */ }
if ((pending & RTC_CMP_bm) != 0u) { /* bounded compare work */ }
```

The order above gives overflow work precedence when both conditions were captured; choose a deliberate application policy. One known enabled source needs no unnecessary generic dispatcher. A flag is one bit, so occurrences may coalesce before acknowledgement; no ISR counter can recover hardware events already lost that way. If main needs deferred work, use the shared interrupt methodology's atomic consumption and saturation/overflow policy.

Polling leaves the corresponding interrupt enable clear, tests the live flag, acknowledges it by direct assignment and performs work in main. Polling or event-only use does not itself require sei. PIT polling is described for reference; the current PIT generation recipe covers periodic interrupts. Do not enable unused interrupt sources or use an unbounded ISR drain loop.

## Reference only: events, correction, sleep and debug

RTC OVF/CMP are one-CLK_RTC pulse event generators. PIT_DIV64 through PIT_DIV8192 (powers of two) are divided-clock level generators. These taps are separate from the PI interrupt interval selected by PITCTRLA.PERIOD. Interrupt enable is not required simply to generate an event, and EVSYS routing does not start RTC/PIT. Select a generator, channel and user with reviewed EVSYS material; no full route is established here.

CALIB holds an externally established correction magnitude 0–127 in one-PPM steps. CORREN applies correction to the shared prescaler, so both RTC and PIT are affected. SIGN=0 slows counting; SIGN=1 speeds it and requires at least DIV2. Configure the measured value before enabling correction; do not infer it from the oscillator name. An ongoing correction cycle completes after CORREN is cleared. See sections 23.6/23.13.7, pages 270/280. This is correction behavior, not a calibration measurement procedure or approval to change it.

RTC runs in Idle and runs in Standby when RUNSTDBY is set; PIT can run in every sleep mode. The selected clock must remain available. Sleep entry, wake races and SLPCTRL configuration require their own review; none are supplied by this document.

DBGCTRL and PITDBGCTRL separately choose debug operation. At reset DBGRUN=0, RTC halts with the CPU, and PIT output is forced low. Resuming with a high PIT phase can create an extra interrupt. Debugger stepping is not normal timing evidence. Enabling debug-run intentionally changes this behavior; it is outside the current boot-only recipe.

## Reference only: stopping and reconfiguration

Runtime reconfiguration is not the boot-only recipe. A future implementation must first decide whether to process or discard pending work, prevent an ISR from observing partial state, stop affected functions with complete intentional control values and observe pre/post busy checks. Coordinate both owners before changing CLK_RTC or correction. Write only the intended new CNT/PER/CMP/calibration/period state, clear only deliberately discarded flags, restore the selected source enables and restart before restoring previous CPU interrupt state.

Do not hold all interrupts disabled for a long asynchronous wait by default; choose a bounded concurrency protocol that protects the affected state and meets other latency requirements. The clock must continue long enough for synchronization. Preserving a value is different from assuming its reset value. Neither stop/restart nor sequential writes guarantee common zero phase or a complete first interval.

Verification for any future counter/alternate-clock design must include arithmetic boundaries, busy-flag behavior, shared TEMP access, simultaneous flags, source absence, overflow/coalescing, reconfiguration and required first-event timing. Compiler success, static pin ownership and measured hardware behavior remain separate evidence.
