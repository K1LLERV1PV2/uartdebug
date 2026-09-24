---
name: avr-gpio
description: Initialize and update available ATtiny162x GPIO without disturbing unrelated pins.
---

Resolve a symbolic pin through the selected package's pinout. PA0 remains reserved for UPDI in this pilot. For output, prepare PORTx.OUTCLR or OUTSET before PORTx.DIRSET. Change selected bits by direct mask writes to OUTSET/OUTCLR/OUTTGL and DIRSET/DIRCLR. Avoid read-modify-write on a whole port when these operations suffice.

For input use DIRCLR, then a deliberate PINnCTRL configuration. PORT_PULLUPEN_bm enables the internal pull-up; digital reads require ISC other than INPUT_DISABLE. Read PORTx.IN for the sampled input. Modifying a PINnCTRL field later must preserve its other settings. A peripheral route may override GPIO behavior.

W1C interrupt flags are cleared by direct writes of the selected mask, not |=. An output toggled every 500 ms has a complete on/off period of 1 s. Use blocking delays only when accepted by the project; choose TCA for independent periodic work.

Lineage: mini-projects 03/04 and their AI/help, checked against DFP register names. Detailed electrical limits, GPIO wake-up modes and interrupt sense edge cases are not covered by this short recipe.
