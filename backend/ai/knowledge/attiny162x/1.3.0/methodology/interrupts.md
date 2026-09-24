# ATtiny162x interrupt programming methodology

## Interrupt scope and evidence selection

Use this methodology for ATtiny1624/1626/1627 with the project's MPLAB XC8 AVR build. It explains common interrupt engineering and CPUINT constraints; the active contract and approved peripheral recipes determine which generated modes are supported. Knowledge of CPUINT, sleep, vector relocation or another peripheral is not approval to configure it.

For an ordinary interrupt, first identify its peripheral, condition, source-enable control, flag or ready condition, acknowledgement method, and exact `_vect` symbol. Read the source peripheral's local recipe and relevant pages. CPUINT prioritizes requests; it does not define how PORT, RTC, TCA or USART acknowledges them. Verify symbols against the installed device pack, rather than assuming a supplied header has the same version.

Use the local CPUINT reference only when reasoning about global gating, pending requests, priority, latency, nesting, vector location, compact vectors or CCP. Leave reset-default CPUINT policy alone when it meets the application. Hardware claims come from the applicable datasheet and errata; compiler behavior comes from the selected XC8 headers and build. Derived models explain relationships without replacing either source.

## Interrupt initialization and compiler-managed handlers

Use `<xc.h>` and `<avr/interrupt.h>` and declare one `ISR(EXACT_SOURCE_vect)` per ordinary vector. Do not mix this with the XC8 Common C Interface declaration in the same ordinary project; CCI requires an explicitly configured build and is not the current generation convention.

Prepare all ISR-visible variables before interrupts can access them. Configure the peripheral's required clock, pin allocation and operation, handle stale state using its documented rules, enable the owned interrupt source, and start the source in its required order. The precise order is peripheral-specific: do not turn a generic numbered list into a universal enable/start/clear sequence. Clearing a newly valid event after starting can lose it.

In one-time startup, call `sei()` in `main()` after all source and shared-state initialization, immediately before the main loop. Keep it out of low-level `gpio_init()`, `button_init()` or timer helpers. An application explicitly requiring interrupts during initialization needs a designed partial-initialization boundary. Global enable alone does not enable any individual peripheral source.

```c
int main(void)
{
    application_state_init();
    gpio_init();
    periodic_source_init();

    sei();

    while (1)
    {
        application_step();
    }
}
```

The called functions above represent the application-specific initialization and loop work; they are not device-library APIs. Use verified reset defaults only for an explicitly boot-only setup. Reusable configuration must account for previously enabled sources and pending state.

Let XC8 generate ordinary ISR entry, context preservation, exit and return. Never call an `ISR()` function as a normal C function, insert `reti()` into an ordinary handler, or use `ISR_NAKED` to save bytes without a separate verified context/return design. `CPUINT.STATUS` is controller-maintained execution state, not an application flag register to clear manually.

## Interrupt acknowledgement and shared-vector dispatch

Before leaving a handler, acknowledge each serviced source by its own documented mechanism. A peripheral may use W1C, reading a data register, a defined register-access sequence, automatic acknowledgement for a particular source, or a ready condition that remains asserted until useful work is performed. Do not infer a universal `INTFLAGS = mask` operation from the CPUINT chapter.

For PORT, use direct W1C mask assignment. When several enabled sources share a vector, read a snapshot, identify every owned pending cause and dispatch each one; clear only the serviced flags. A single guaranteed source can be acknowledged directly without a redundant source test. Adding another source requires dispatch review. Never write back a complete observed snapshot unless every included cause was intentionally handled.

For ready-driven USART DRE delivery, follow the approved USART recipe: either supply data or disable DRE delivery when the software transmit queue becomes empty. An ISR that leaves its request permanently asserted can monopolize the CPU even if each individual call is short. For receive data, preserve the documented status/data read order. A W1C expression such as `INTFLAGS |= mask` can clear unrelated pending flags and is forbidden.

Example for PA6, with inversion off and both-edge sensing already configured: the ISR publishes a coalesced notification and leaves interpretation to main-line code. This fragment requires `<stdint.h>`, `<xc.h>` and `<avr/interrupt.h>`.

```c
static volatile uint8_t button_edge_pending;

ISR(PORTA_PORT_vect)
{
    uint8_t pending = PORTA.INTFLAGS;

    if ((pending & PIN6_bm) != 0u)
    {
        PORTA.INTFLAGS = PIN6_bm;
        button_edge_pending = 1u;
    }

    /* Dispatch every other enabled PORTA source here if present. */
}
```

This is a source-specific fragment, not a complete executable program or approval for every PORT interrupt mode. For a hardware event arriving between a snapshot and acknowledgement, a one-bit peripheral flag can still coalesce events. Software source dispatch alone is not evidence of lossless event counting.

## Interrupt masking and atomic shared-state exchange

Objects shared asynchronously between ISR and main-line code generally require `volatile` access. `volatile` preserves the accesses; it does not create mutual exclusion, make multi-byte accesses indivisible, or make a read-then-clear sequence atomic.

A single-byte load or store on an 8-bit AVR can be individually atomic, but this sequence is not: read pending flag; interrupt sets it; main clears it. The new event disappears. Protect the complete consume-and-clear operation, and process the copied result after leaving the critical section.

```c
#include <stdint.h>
#include <util/atomic.h>

static volatile uint8_t button_edge_pending;

static uint8_t take_button_event(void)
{
    uint8_t pending;

    ATOMIC_BLOCK(ATOMIC_RESTORESTATE)
    {
        pending = button_edge_pending;
        button_edge_pending = 0u;
    }

    return pending;
}
```

The ISR sets this same `volatile` flag; declare it only once when composing the program. Include `<xc.h>` in the complete XC8 source. `ATOMIC_RESTORESTATE` preserves the caller's global-interrupt state and supplies the compiler-aware critical-section boundaries. Where the project instead uses the documented `SREG` pattern, save `SREG`, call `cli()`, perform the short volatile exchange, and restore the saved state; never end a helper with unconditional `sei()` when the entry state is unknown. Keep unrelated calculations and blocking work outside the protected region.

`cli()` masks ordinary interrupts only. It does not stop peripherals, clear their pending flags, prevent new flags, or mask NMI. Pending requests can execute after interrupts are enabled again. Events represented by one pending bit can coalesce while delivery is masked. Protect multi-byte counters, timestamps, read/update sequences and shared buffer indices according to their access pattern; one-byte width alone does not prove the whole algorithm safe.

Choose the data handoff deliberately: a Boolean means "one or more events pending"; a counter can count ISR-observed events with a defined overflow policy; a buffer or queue preserves event payloads with explicit capacity and full-buffer handling. A software counter cannot recover physical events already coalesced in hardware. If every pulse matters, prove service-rate and latency limits or use a separately supported hardware counting mechanism.

The same rules apply across ISR priority levels that can preempt one another. NMI-shared state cannot be protected solely with `cli()` or a maskable-interrupt atomic block; it needs a suitable protocol or ownership design.

## Interrupt duration, called functions and overload

Keep each ISR bounded and small enough for the application's latency and event-rate requirements. Acknowledge the source and transfer the minimum required data or state. Perform debounce, formatting, protocol interpretation and application decisions in main-line code when practical. A fixed-cost GPIO toggle can belong in an ISR when that meets the timing design.

Avoid delay loops, peripheral-ready polling, formatted I/O, dynamic allocation and heavy calculations inside an ISR by default. In particular, waiting for a driver whose progress depends on an interrupt that cannot preempt the current handler can deadlock. Every loop in an ISR needs a finite, demonstrable completion bound. A short intentional software delay is an exception only when its worst duration, interrupt latency impact, event coalescing, queue capacity and watchdog implications have been checked and documented; do not transfer the exception as the default button-debounce design.

Before calling a helper or library routine from an ISR, check worst execution time, hidden polling, locks, static storage, shared buffers and dependencies on interrupt progress. A function used by main-line code and a preempting ISR must be reentrant or have all shared state protected. A short-looking call site is not evidence that a library or driver is safe inside an ISR.

Evaluate overload at the maximum input/event rate. Include time with global interrupts masked and time consumed by higher-priority work. Decide which events may coalesce, how queues or counters overflow, and what the application does when that happens. Round-robin scheduling does not fix an ISR that never finishes or an input rate exceeding processing capacity.

## Interrupt latency, priority and stack review

Normal maskable sources are LVL0 by default. With default static scheduling, the lowest vector address among pending LVL0 requests wins. `LVL0PRI` can alter the static order; its selected vector becomes lowest and the following vector becomes highest, wrapping through eligible LVL0 sources. Round-robin updates `LVL0PRI` after acknowledgement to put the last serviced LVL0 vector last. RESET, NMI and an assigned LVL1 source are not demoted into LVL0 ordering.

One nonzero vector number in `CPUINT.LVL1VEC` can select LVL1; zero selects none. LVL1 can preempt LVL0, and an enabled device-defined NMI can preempt maskable handlers. NMI does not depend on the global I bit and cannot itself be preempted by another interrupt. Do not assume all AVR variants have classic single-level interrupt behavior, and do not enable extra nesting with `sei()` inside a handler as a generic fix.

Changing CPUINT scheduling or selecting LVL1 is outside current approved generation. The methodology is available to review why such a change would be needed: establish latency targets and a complete source inventory first, then validate compiler support, shared data, call reentrancy, stack and return behavior. The controller's active-level status remains set during higher-level preemption and is cleared by the appropriate interrupt return.

For these 16 KB devices, DS40002234B table 14-1 shows one cycle finishing a current single-cycle instruction, two cycles storing PC, and three cycles for the vector jump. The resulting six-cycle minimum does not include peripheral synchronization, an unfinished multi-cycle instruction, masked intervals, other handlers or the compiler prologue before the first C action. Sleep adds five cycles plus mode-specific startup time. Use this as a hardware lower-bound model, not an end-to-end C latency guarantee. Inspect generated assembly and test measured timing when it matters.

Estimate worst-case stack from main-line execution plus every simultaneously active interrupt context and all called functions. Include compiler-saved registers and library use. A short C ISR may still have a substantial prologue or call stack. Use compiler output or stack evidence for a constrained design, and never call compilation alone a stack-margin proof.

## Interrupt vector layout, compact vectors and CCP boundary

Vector relocation, boot configuration and Compact Vector Table support require a separately reviewed build and are outside current generation. Do not configure them just because the source guide lists them as optional initialization steps.

In the hardware model, `IVSEL=0` expects vectors directly after BOOT, `IVSEL=1` at BOOT start; the bit is ignored when all Flash is BOOT. Reset still starts PC at `0x0000`. In compact mode, NMI, LVL1 and all LVL0 sources use three class entries, so LVL0 needs correct software source dispatch rather than independent ordinary-vector assumptions. Exact layout, vector numbers and compiler/linker support must be verified together.

The `IVSEL` and `CVT` fields in `CPUINT.CTRLA` require the IOREG CCP unlock followed by the protected write within the documented four-instruction window. `LVL0RR` is explicitly not CCP-protected. Do not hand-write separate C key and register statements and assume the compiler preserves that instruction window. A future supported implementation must use the selected toolchain's verified protected-write mechanism and inspect the relevant build evidence.

## Interrupt verification and sleep integration boundary

Before generating supported interrupt code, verify the exact source/vector, allocation, source-specific flag semantics, init ordering, all ISR-visible state and maximum service work. For shared vectors, exercise simultaneous causes and ensure an unhandled flag is not silently cleared. For flag handoff, test an event arriving around consume/clear; for queues or counters, check overflow and atomic boundaries. Compile the complete composition for the exact MCU and XC8/DFP combination, then separately report hardware testing.

A sleep integration must handle the race between testing for work and entering sleep. A naive pending test followed by `sleep_mode()` can sleep after the event has already been reported. Use a compiler-documented atomic test/enable/sleep protocol with the actual wake source and sleep mode only after that mode gains reviewed support. No sleep implementation is approved by this document alone.

Debug halt changes the effective servicing rate while hardware can continue running; coalesced flags and overflow during a breakpoint are not normal timing evidence. Preserve source review, resource validation, compilation, latency/stack analysis and physical testing as separate claims.

Primary hardware evidence: DS40002234B pages 115-125 and each interrupt-source chapter; canonical DFP vector/register definitions. Software conventions and adaptations derive from the colleague's XC8 interrupt working rules and must be compiled against the installed headers. Grouped provenance and explicit adaptations are recorded in `provenance/adoption-gpio-interrupts.json`.
