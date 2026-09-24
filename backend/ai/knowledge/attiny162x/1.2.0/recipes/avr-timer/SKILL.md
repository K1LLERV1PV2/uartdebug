---
name: avr-timer
description: Generate periodic TCA0 SINGLE normal-mode overflow work with checked timing constants.
---

Reserve TCA0 and TCA0_OVF_vect. Use one SHORT handler, moving lengthy processing to the main loop. Clear the overflow cause by TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm, not |=; entering the ISR does not clear this flag. Initialize output pins and timer before sei(). Initialize from a disabled timer, select SINGLE normal mode with upward counting, reset CNT, program PER, clear stale overflow, enable its interrupt, then enable the selected clock divisor. Reconfiguration of an already active timer is a separate operation.

Use calculateTimerPeriod's checked constant: ticks = round(CLK_PER * period_us / (prescaler * 1000000)); PER = ticks - 1. This derives from normal-mode counting through zero to PER inclusive; actualPeriodUs = (PER + 1) * prescaler * 1000000 / CLK_PER. It uses exact BigInt intermediates and checks 1 <= ticks <= 65536. If the calculation must be in C, cast to uint64_t BEFORE multiplying; check before narrowing. Never copy the legacy ((F_CPU / divider) * period_us) macro: it overflows 32-bit arithmetic at 20 MHz/500 ms. Valid TCA divisors are 1,2,4,8,16,64,256,1024; numeric divisor and TCA_SINGLE_CLKSEL_DIV<n>_gc must agree. Report actualPeriodUs/errorPpm, not an invented exact interval. FRQ and PWM modes have different TOP/update semantics and are not covered by this formula's recipe.

Do not apply a smaller PER directly to a running counter: if CNT already exceeds the new PER, the first cycle can run to MAX before matching the new TOP. Do not use RESTART to preserve a previous direction; on Rev. E it forces upward counting in NORMAL and FRQ modes. This recipe uses a disabled startup and does not enable live updates or restart commands.

ISR/main shared flags need volatile; multi-byte state needs a critical section or an ownership protocol. Volatile alone is not atomicity. Preserve the prior interrupt state when leaving a critical section.

A one-byte read and a subsequent clear are separate operations: protect the complete consume-and-clear exchange when an ISR can set the flag between them. A Boolean flag coalesces events; use an explicitly bounded counter or queue only when the application must preserve each occurrence. Do not enable global interrupts inside an isolated peripheral initialization helper before the whole program's ISR state is ready.

Sources: DS40002234B sections 21.3.3.1/3 and 21.5.1/2/11 (pages 197-198, 209-210, 219); DS80000902F section 2.6.1 (page 4). Reviewed facts: tca-normal-period, tca-clock-and-mode, tca-w1c, tca-live-period, errata-tca-restart-direction. Lineage: mini-project 04, whose original default configuration is narrower than this checked recipe. Scope excludes TCA split/PWM/restart commands and TCB; consult the pinned errata for additional modes. The new composed firmware still needs its own XC8 compile evidence.
