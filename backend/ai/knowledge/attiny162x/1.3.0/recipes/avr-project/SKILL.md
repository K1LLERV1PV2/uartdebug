---
name: avr-project
description: Compose supported XC8 firmware, one resource specification and a synchronized educational guide using the local coding methodology.
---

Use the selected device/package and current project as the composition boundary. The supplied core coding methodology defines source construction and startup conventions; do not reload it. Use the detailed maintained documents through `read_avr_documentation` when their topic applies:

- `methodology-project-workflow`: reconcile requirements, allocate resources, compose examples with shared owners and update C/spec/guide together.
- `methodology-documentation`: explain the final code, wiring, nominal timing, startup behavior and verification in the visitor's language.
- `methodology-gpio` and `methodology-interrupts`: pin control, event interpretation, shared vectors, atomic handoff, bounded service and compiler-managed handlers.
- `methodology-rtc`, `methodology-tca`, `methodology-tcb`, `methodology-usart`: detailed peripheral reasoning and reference examples. Their reference-only sections do not enable unsupported generation modes.

For `catalog` or `read`, pass the documentId and page=0. Follow nextSectionId when the response has more content. Use the current server schema for the one structured resource allocation; original colleague YAML is reference material, not a second schema. Preserve source/guide filenames and existing user behavior on updates.

One compatible owner must control each pin, route, peripheral, interrupt vector and output stream. A library of examples is not a set of independent initialization blocks to concatenate. Apply the appropriate recipe's clock, ownership and startup preconditions when combining them. Use the server's calculated constants and exact device-package facts.

Source pack DFP 3.4.278 and compiler pack 3.3.272 are distinct. Use the listed public `_gc`/`_bm`/`_gm` symbols and vectors; newer `_gv` aliases are unavailable in the installed pack. DS80000902F silicon errata takes precedence over the older DS40002234B text; document revision F is different from silicon Rev. E.

GPIO/PIT with an unchanged CPU clock does not require a CPU-frequency question. For a CPU-clock change or a requirement depending on electrical conditions, resolve the relevant fuse, voltage and temperature assumptions. A reviewed source interpretation, resource validation, exact-source compilation and hardware testing are separate evidence. The server supplies the current verification result.

Lineage: the original Minimum tutorial, the maintained methodology and their source/review manifests. Official facts retain PDF revision/page and DFP provenance. Original colleague instructions are available in the `colleague-sources` catalog with corrections linked; follow the maintained guidance and current server contract.
