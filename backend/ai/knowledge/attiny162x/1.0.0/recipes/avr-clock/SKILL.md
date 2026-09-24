---
name: avr-clock
description: Configure OSC20M and a supported prescaler before timing-dependent ATtiny162x peripherals.
---

Configure CLKCTRL.MCLKCTRLA and MCLKCTRLB with the selected XC8 _PROTECTED_WRITE mechanism; ordinary assignments do not satisfy CCP timing. For OSC20M use CLKCTRL_CLKSEL_OSC20M_gc. Divide by one: protected MCLKCTRLB write of 0. Other supported divisors use CLKCTRL_PDIV_<n>X_gc | CLKCTRL_PEN_bm. Do not enable CLKOUT unless PB5 exists in the physical package and is reserved for that purpose.

Configure clock before timers/USART. Define F_CPU before <util/delay.h>; this macro describes the resulting clock, it does not configure hardware. Recompute all time-dependent constants after changes. The factory /6 result is approximately 3333333 Hz; selected user clock is authoritative, reset assumptions are not measured facts. Delay recipes require optimization and block the main loop.

This recipe assumes the device's internal 20 MHz source and covers divisors 1,2,4,6,8,10,12,16,24,32,48,64. Do not change fuses/calibration/OSCLOCK. Supply-dependent frequency limits are outside the resource validator and must be resolved before claiming electrical correctness.

Sources: documents.json entries clkctrl-a and clkctrl-b; DFP selected device symbols. Lineage: mini-projects 02 and 03. The legacy 02 AI file is older than its C/help; its compatibility assertions are not promoted to verified facts.
