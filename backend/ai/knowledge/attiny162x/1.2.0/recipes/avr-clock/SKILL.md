---
name: avr-clock
description: Configure OSC20M and a supported prescaler before timing-dependent ATtiny162x peripherals.
---

Apply this recipe only when the project specifies a CPU/peripheral clock or needs CPU-dependent timing. For GPIO and RTC PIT with spec.clock.hz=null, leave CLKCTRL unchanged and omit F_CPU; do not add a 20 MHz configuration or its supply requirements to a clock-independent task.

Configure CLKCTRL.MCLKCTRLA and MCLKCTRLB with the selected XC8 _PROTECTED_WRITE mechanism; the IOREG key permits the protected write only within four CPU instructions. Ordinary assignments or disabling interrupts alone do not satisfy this protocol. For OSC20M use CLKCTRL_CLKSEL_OSC20M_gc. Divide by one: protected MCLKCTRLB write of 0. Other supported divisors use CLKCTRL_PDIV_<n>X_gc | CLKCTRL_PEN_bm. Do not enable CLKOUT unless PB5 exists in the physical package and is reserved for that purpose.

Configure clock before timers/USART. Define F_CPU before <util/delay.h>; this macro describes the resulting clock, it does not configure hardware. Recompute all time-dependent constants after changes. Reset enables division by six, but FUSE.OSCCFG.FREQSEL selects a 16 MHz or 20 MHz source: the name OSC20M alone does not prove 20 MHz. Approximately 3333333 Hz after reset applies only to the 20 MHz selection; record the selected source and fuse precondition instead of treating it as measured frequency. Delay recipes require optimization and block the main loop.

This recipe assumes the device's internal 20 MHz source and covers divisors 1,2,4,6,8,10,12,16,24,32,48,64. Do not change fuses or calibration. On silicon Rev. E, OSCLOCK=1 prevents loading calibration values, so never propose it as oscillator protection. The documented alternative MCLKLOCK.LOCKEN also locks main-clock and prescaler settings until hardware reset; do not add that lock by default.

Resolve supply and temperature before selecting CPU frequency. The data sheet permits 20 MHz only at VDD >= 4.5 V and TA <= 85 C; do not assume 20 MHz is valid at 3.3 V. The higher-temperature operating region permits at most 16 MHz. Electrical limits are outside the resource validator, so unresolved board conditions are a precondition to clarify, not a passed validation.

Sources: DS40002234B sections 6.5.6.1, 7.8.2.3, 11.5.2-3 and Figures 33-1/2 (pages 33, 47, 90, 93-94, 476); DS80000902F section 2.2.2 (page 3). Reviewed facts: clock-ccp, clock-source-frequency, clock-prescaler, clock-lock, clock-safe-frequency, errata-osclock-calibration. Use the selected DFP symbols. Lineage: mini-projects 02 and 03. The legacy 02 AI file is older than its C/help; its compatibility assertions are not promoted to verified facts.
