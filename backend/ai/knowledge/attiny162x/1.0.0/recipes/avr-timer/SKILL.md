---
name: avr-timer
description: Generate periodic TCA0 SINGLE normal-mode overflow work with checked timing constants.
---

Reserve TCA0 and TCA0_OVF_vect. Use one SHORT handler, moving lengthy processing to the main loop. Clear the overflow cause by TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm, not |=. Initialize output pins and timer before sei(). Initialize from a disabled timer, select SINGLE normal mode, reset CNT, program PER, clear stale overflow, enable its interrupt, then enable the selected clock divisor. Reconfiguration of an already active timer is a separate operation.

Use calculateTimerPeriod's checked constant: ticks = round(CLK_PER * period_us / (prescaler * 1000000)); PER = ticks - 1. It uses exact BigInt intermediates and checks 1 <= ticks <= 65536. If the calculation must be in C, cast to uint64_t BEFORE multiplying; check before narrowing. Never copy the legacy ((F_CPU / divider) * period_us) macro: it overflows 32-bit arithmetic at 20 MHz/500 ms. Numeric divisor and TCA_SINGLE_CLKSEL_DIV<n>_gc must agree. Report actualPeriodUs/errorPpm, not an invented exact interval.

ISR/main shared flags need volatile; multi-byte state needs a critical section or an ownership protocol. Volatile alone is not atomicity. Preserve the prior interrupt state when leaving a critical section.

Lineage: mini-project 04, whose original default configuration is narrower than this checked recipe. Scope excludes TCA split/PWM/restart commands and TCB; consult the pinned errata for additional modes. The new composed firmware still needs its own XC8 compile evidence.
