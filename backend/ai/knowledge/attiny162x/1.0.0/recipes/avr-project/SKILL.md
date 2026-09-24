---
name: avr-project
description: Compose XC8 C, resource YAML and user-language documentation for the supported ATtiny162x pilot.
---

Use the selected device and physical package, not a generic AVR assumption. Compose one main() and one handler per vector. One module owns each pin, USART instance, TCA configuration and stdout; merge compatible uses deliberately. Preserve user-owned code and stable documentation anchors.

Keep source, structured resource allocation and explanatory documentation synchronized. Documentation follows the user's language; C symbols and YAML keys do not change with locale. Include <xc.h>; add <avr/interrupt.h>, <stdio.h> or <util/delay.h> only when needed. Do not substitute an AVR-GCC build for the configured XC8 build.

In the structured specification, includes contains plain header names such as ["xc.h", "stdint.h", "avr/interrupt.h"], without #include directives or delimiters. C source retains normal #include <...> syntax.

Use DFP symbols from devices.json and the compiler's actual selected device pack. A symbol found in DFP 3.4.278 is not evidence that an older installed pack accepts it. A successful compile does not prove resource allocation or hardware operation. Report those verification states separately.

Recorded production compilation used XC8 3.10 and DFP 3.3.272. Selected shared public symbols have matching values across 3.3.272 and the source snapshot 3.4.278. Generate the listed _gc/_bm/_gm symbols and vector names; do not use the newer unshifted _gv helper aliases, which are absent from the recorded compiler pack.

Lineage: existing public/avr-mini-projects/01_Minimum and backend/ai/mini-projects/01_Minimum. They remain the canonical tutorial source; do not copy entire demos into this knowledge bundle. Coverage excludes other AVR families, fuse programming, electrical design, advanced sleep, ADC, SPI, TWI, PWM and bootloaders.
