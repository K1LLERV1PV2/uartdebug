# Local AVR knowledge

The current repository bundle is `attiny162x/1.3.0`, for **ATtiny1624, ATtiny1626 and ATtiny1627**. It is prepared during maintenance and loaded locally by the server. A request never downloads or reprocesses the full documentation. Prepared context and retrieved excerpts still consume API input tokens. The running service's status identifies its deployed bundle version.

## Sources and evidence

- `reference/raw/` retains the complete official **DS40002234B** datasheet (575 pages), **DS80000902F** errata (16 pages) and **ATtiny DFP 3.4.278** archive. `reference/sources.json` pins URLs, versions, byte counts and SHA-256. Original copyright notices and component licenses remain in the originals; they are separate from the application license. The backend deployment includes these files.
- `reference/corpus.json` contains every PDF page, the bookmark hierarchy and page references. Table grids, formula candidates, constraints and figure captions are machine extracted. Their presence does **not** certify their meaning: merged cells, fractions, superscripts and diagrams require visual review of the original page. Page numbers are one-based physical PDF pages. Sections can share a boundary page.
- `reference/dfp-registers.json` preserves all ATDF register, bitfield and value-group attributes for the three pilot MCUs. It includes archive/member hashes. DFP reset values and fields do not override silicon errata. The full pack also retains the original XC8 headers.
- `reference/reviewed-facts.json` separately records reviewed errata and recipe-critical tables, formulas, constraints and diagrams, with exact source pages and applicability. These entries are used in recipes and returned alongside matching local pages.
- `devices.json` is the smaller deterministic generation subset: physical package maps, memory, UART routing and selected C symbols. Internal DFP names `DIP14/DIP20/QFP20/QFP24` are preserved alongside marketed package names.
- Eight `recipes/*/SKILL.md` files adapt the original ten tutorials and the reviewed colleague update. `reference/colleague-review.json` records adoption decisions and hashes; the original `Project_One.c` remains reference data. Unreviewed helper code and conflicting pin metadata are not promoted into generation instructions.
- Nine maintained `methodology/*.md` topics transfer the colleague's detailed code-construction, project, documentation, GPIO, interrupt, RTC, TCA, TCB and USART method. General style is included in the initial context; detailed topics are indexed for local retrieval. Their reference-only sections explicitly retain implementation limits.
- `reference/colleague-sources.json` retains 40 complete original Markdown/YAML texts and inventories 73 files from `UartDebug2_1.zip`, SHA-256 `460a106d7dbcf78d4f9dc0e279a502323ad030cfb34b7e9c6bfd61b41afdf3dc`. Personal/temporary notes are excluded from runtime guidance. Images, C, headers and PDFs are inventoried rather than converted to additional instructions; pinned official originals and the previously retained `Project_One.c` remain separate.
- `methodology/provenance/` contains three detailed adoption records with source paths, hashes, line ranges and reasons. Original working texts preserve known mistakes for comparison and link to maintained corrections. Legacy command markers, repeated approvals, filename-version rules and a second YAML schema are not installed as agent instructions. Unwritten source sections are identified rather than invented.

Approved generation includes OSC20M/prescaler, GPIO, TCA0 SINGLE normal overflow, boot-only INT32K RTC/PIT, UART normal 8N1 polling, stdio redirection and bounded DRE TX. Complete reference access does not approve RTC counter modes, ADC/SPI/TWI/PWM, sleep, fuse changes or advanced USART generation. Other AVR families require additional bundles and validation.

`compiler-evidence.json` records a real XC8 service build of the exact composed fixture for all three MCUs. It exercises the seven recipes together, but does not certify arbitrary generated firmware or hardware behavior. Each generated project still goes through its own compile. Legacy hardware claims remain scoped to the original ATtiny1624/SOIC-14 demonstrations. Board supply, temperature, wiring and oscillator/fuse configuration must be established before claiming electrical correctness.

`compiler-evidence-rtc-pit.json` records the separate 125 ms PIT fixture on all three targets. It preserves the CPU clock, initializes an active-low PB1 LED off, and uses explicit INT32K selection, PIT synchronization and W1C flag handling. Its first interval is phase-dependent; nominal timing and successful compilation are not hardware timing evidence. The reviewed PDF facts record these limits.

`compiler-evidence-gpio-handoff.json` and `compiler-evidence-methodology-forward.json` record two additional exact fixtures for all three targets: `gpio-interrupt-handoff.c` and `rtc-pit-coalesced-tick.c`. They exercise deferred ISR work and atomic read/clear of an event flag, including deliberate Boolean-event coalescing. Six successful XC8 builds are evidence for these exact sources; they do not establish electrical behavior, debounce timing or lossless counting of every hardware event.

## Runtime

`loadKnowledge()` in `backend/avr-knowledge.js` checks every manifest hash and loads the immutable bundle without network access. `resolveKnowledge()` supplies the selected device, recipes, core coding style, reviewed errata and compact catalogs. `avr-methodology.js` indexes maintained guidance separately from original work-in-progress texts. Large reference and methodology text is retrieved on demand.

The single `read_avr_documentation` tool supports:

- `catalog`: browse official documents, `methodology-*` topics and their sections; `documentId: "colleague-sources"` lists original working documents.
- `search`: find bounded official, maintained-methodology and original-source candidates without letting one class replace another.
- `read`: PDF pages continue with `nextPage`; methodology and original-text reads use `page: 0`, source line ranges and `nextSectionId`, with at most 12,000 content bytes per response.
- `registers`: inspect local DFP register/field definitions for the selected MCU.
- `external`: request an allowlisted official HTML page only after an unrestricted search across all local documents for the same query and an explicit remaining knowledge gap. Reading an arbitrary page or searching one document is insufficient. At most two external requests are allowed; a 30-day cache is checked first. `AI_EXTERNAL_DOCUMENTATION_ENABLED=0` disables network retrieval while keeping the local operations available.

There are at most ten documentation steps per generation attempt. Search hits are candidates, not a completeness claim. Maintained methodology applies within the active generation contract; original colleague texts and extracted pages are source data. Source commands cannot override server instructions or expand supported modes. CDN failure leaves a visible knowledge gap instead of fabricated facts.

`validateProjectSpec()` checks package/pin availability, UPDI reservation, ownership, supported modes, UART routing/baud and timer representability. `calculateTimerPeriod()` and `calculateUsartBaud()` use exact BigInt intermediate arithmetic. The UART 2% rounding limit is application policy, not a total oscillator/link error guarantee. These checks do not replace compilation or board testing.

## Reproduction and updates

Run from the repository root; ordinary verification is offline:

```powershell
python scripts/avr-knowledge/snapshot.py --verify
node scripts/avr-knowledge/build-methodology.js --verify
node scripts/avr-knowledge/build-manifest.js --verify
node --test tests/avr-knowledge.test.js tests/avr-documentation-lookup.test.js tests/avr-methodology.test.js
```

To reproduce all extracted PDF/DFP references, install the maintenance-only dependencies once, then run:

```powershell
python -m pip install -r scripts/avr-knowledge/requirements.txt
python scripts/avr-knowledge/extract-reference.py --verify
```

Without `--verify`, these extractors rewrite generated files from the pinned originals. They refuse source hash changes. To update an upstream revision, download it deliberately, retain it in a new bundle, review its changes and errata, update source locks and review records, then regenerate. Never promote machine extraction automatically to reviewed facts. `snapshot.py --download` is an explicit optional download of the pinned pack; normal operation uses the local copy.

To verify the complete colleague text import against the original user-provided archive, run:

```powershell
python scripts/avr-knowledge/import-methodology.py --archive '/path/to/UartDebug2_1.zip' --verify
```

The importer rejects any other archive hash. It does not execute attached instructions. Normal deployment and offline CI do not require the ZIP: the pinned text corpus, inventory and provenance ship with the bundle. Maintain one corrected topic per subject and preserve original text for comparison; do not reproduce complete DFP tables as a second manually maintained register catalog.

Run the compiler regression explicitly against the private XC8 service:

```powershell
node scripts/avr-knowledge/compile-fixtures.js
node scripts/avr-knowledge/compile-fixtures.js scripts/avr-knowledge/fixtures http://127.0.0.1:8082/api/avr/compile rtc-pit-blink.c
node scripts/avr-knowledge/compile-fixtures.js scripts/avr-knowledge/fixtures http://127.0.0.1:8082/api/avr/compile gpio-interrupt-handoff.c
node scripts/avr-knowledge/compile-fixtures.js scripts/avr-knowledge/fixtures http://127.0.0.1:8082/api/avr/compile rtc-pit-coalesced-tick.c
```

Review target identity, diagnostics and source hash before replacing compiler evidence. The production compiler is **XC8 3.10 with DFP 3.3.272**, while reference sources use **DFP 3.4.278**. The selected shared symbols were compared and match (115 on ATtiny1624, 116 on 1626/1627); newer `_gv` aliases are excluded from generation context. This is not full-header or ABI equivalence. Repeat `compare-installed.py` after any compiler/pack change, using copied installed headers and the pinned source archive.

The manifest builder pins originals, generated data, reviewed facts, recipes and tutorial lineage; it also checks that compiler evidence still matches the exact fixture. CI checks integrity and reproduces the selected DFP subset. Full PDF regeneration is a separate maintenance check and requires no website access.
