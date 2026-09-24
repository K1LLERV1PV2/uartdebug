# Local AVR knowledge

The active bundle is `attiny162x/1.2.0`, for **ATtiny1624, ATtiny1626 and ATtiny1627**. It is prepared during maintenance and loaded locally by the server. A request never downloads or reprocesses the full documentation. Prepared context and retrieved excerpts still consume API input tokens.

## Sources and evidence

- `reference/raw/` retains the complete official **DS40002234B** datasheet (575 pages), **DS80000902F** errata (16 pages) and **ATtiny DFP 3.4.278** archive. `reference/sources.json` pins URLs, versions, byte counts and SHA-256. Original copyright notices and component licenses remain in the originals; they are separate from the application license. The backend deployment includes these files.
- `reference/corpus.json` contains every PDF page, the bookmark hierarchy and page references. Table grids, formula candidates, constraints and figure captions are machine extracted. Their presence does **not** certify their meaning: merged cells, fractions, superscripts and diagrams require visual review of the original page. Page numbers are one-based physical PDF pages. Sections can share a boundary page.
- `reference/dfp-registers.json` preserves all ATDF register, bitfield and value-group attributes for the three pilot MCUs. It includes archive/member hashes. DFP reset values and fields do not override silicon errata. The full pack also retains the original XC8 headers.
- `reference/reviewed-facts.json` separately records reviewed errata and recipe-critical tables, formulas, constraints and diagrams, with exact source pages and applicability. These entries are used in recipes and returned alongside matching local pages.
- `devices.json` is the smaller deterministic generation subset: physical package maps, memory, UART routing and selected C symbols. Internal DFP names `DIP14/DIP20/QFP20/QFP24` are preserved alongside marketed package names.
- Eight `recipes/*/SKILL.md` files adapt the original ten tutorials and the reviewed colleague update. `reference/colleague-review.json` records adoption decisions and hashes; the original `Project_One.c` remains reference data. Unreviewed helper code and conflicting pin metadata are not promoted into generation instructions.

Approved generation includes OSC20M/prescaler, GPIO, TCA0 SINGLE normal overflow, boot-only INT32K RTC/PIT, UART normal 8N1 polling, stdio redirection and bounded DRE TX. Complete reference access does not approve RTC counter modes, ADC/SPI/TWI/PWM, sleep, fuse changes or advanced USART generation. Other AVR families require additional bundles and validation.

`compiler-evidence.json` records a real XC8 service build of the exact composed fixture for all three MCUs. It exercises the seven recipes together, but does not certify arbitrary generated firmware or hardware behavior. Each generated project still goes through its own compile. Legacy hardware claims remain scoped to the original ATtiny1624/SOIC-14 demonstrations. Board supply, temperature, wiring and oscillator/fuse configuration must be established before claiming electrical correctness.

`compiler-evidence-rtc-pit.json` records the separate 125 ms PIT fixture on all three targets. It preserves the CPU clock, initializes an active-low PB1 LED off, and uses explicit INT32K selection, PIT synchronization and W1C flag handling. Its first interval is phase-dependent; nominal timing and successful compilation are not hardware timing evidence. The reviewed PDF facts record these limits.

## Runtime

`loadKnowledge()` in `backend/avr-knowledge.js` checks every manifest hash and loads the immutable bundle without network access. `resolveKnowledge()` supplies the selected device, recipes, reviewed errata and compact catalogs. Large reference text is retrieved on demand.

The single `read_avr_documentation` tool supports:

- `catalog`: browse local documents and section children.
- `search`: find bounded candidate excerpts across local pages.
- `read`: read a section/page with continuation and source provenance.
- `registers`: inspect local DFP register/field definitions for the selected MCU.
- `external`: request an allowlisted official HTML page only after an unrestricted search across all local documents for the same query and an explicit remaining knowledge gap. Reading an arbitrary page or searching one document is insufficient. At most two external requests are allowed; a 30-day cache is checked first. `AI_EXTERNAL_DOCUMENTATION_ENABLED=0` disables network retrieval while keeping the local operations available.

There are at most ten documentation steps per generation attempt. Search hits are candidates, not a completeness claim. Source text cannot override the server's instructions or expand supported modes. CDN failure leaves a visible knowledge gap instead of fabricated facts.

`validateProjectSpec()` checks package/pin availability, UPDI reservation, ownership, supported modes, UART routing/baud and timer representability. `calculateTimerPeriod()` and `calculateUsartBaud()` use exact BigInt intermediate arithmetic. The UART 2% rounding limit is application policy, not a total oscillator/link error guarantee. These checks do not replace compilation or board testing.

## Reproduction and updates

Run from the repository root; ordinary verification is offline:

```powershell
python scripts/avr-knowledge/snapshot.py --verify
node scripts/avr-knowledge/build-manifest.js --verify
node --test tests/avr-knowledge.test.js tests/avr-documentation-lookup.test.js
```

To reproduce all extracted PDF/DFP references, install the maintenance-only dependencies once, then run:

```powershell
python -m pip install -r scripts/avr-knowledge/requirements.txt
python scripts/avr-knowledge/extract-reference.py --verify
```

Without `--verify`, these extractors rewrite generated files from the pinned originals. They refuse source hash changes. To update an upstream revision, download it deliberately, retain it in a new bundle, review its changes and errata, update source locks and review records, then regenerate. Never promote machine extraction automatically to reviewed facts. `snapshot.py --download` is an explicit optional download of the pinned pack; normal operation uses the local copy.

Run the compiler regression explicitly against the private XC8 service:

```powershell
node scripts/avr-knowledge/compile-fixtures.js
node scripts/avr-knowledge/compile-fixtures.js scripts/avr-knowledge/fixtures http://127.0.0.1:8082/api/avr/compile rtc-pit-blink.c
```

Review target identity, diagnostics and source hash before replacing compiler evidence. The production compiler is **XC8 3.10 with DFP 3.3.272**, while reference sources use **DFP 3.4.278**. The selected shared symbols were compared and match (115 on ATtiny1624, 116 on 1626/1627); newer `_gv` aliases are excluded from generation context. This is not full-header or ABI equivalence. Repeat `compare-installed.py` after any compiler/pack change, using copied installed headers and the pinned source archive.

The manifest builder pins originals, generated data, reviewed facts, recipes and tutorial lineage; it also checks that compiler evidence still matches the exact fixture. CI checks integrity and reproduces the selected DFP subset. Full PDF regeneration is a separate maintenance check and requires no website access.
