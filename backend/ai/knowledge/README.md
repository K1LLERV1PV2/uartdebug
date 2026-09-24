# Local AVR knowledge

The first pinned bundle is `attiny162x/1.0.0`, covering **only ATtiny1624, ATtiny1626 and ATtiny1627**. It combines small official-source digests, deterministic Device Family Pack facts and seven implementation recipes derived from the existing ten tutorials. The original tutorials remain canonical examples, not duplicated skill payloads.

## Evidence and limits

- `devices.json` was extracted from Microchip ATtiny DFP **3.4.278**, with SHA256 of the complete downloaded pack, each ATDF and each XC8 header. It contains physical package maps, flash/RAM/EEPROM, USART routes and selected exact C symbols. The DFP's internal `DIP14/DIP20/QFP20/QFP24` pinout names are preserved alongside marketed package names.
- `documents.json` contains **curated factual digests**, not raw HTML mirrors or full datasheet conversion. Its SHA256 identifies the local digest text. `rawSourceSha256: null` and `digestScope` make this distinction explicit. HTML was read from official versioned Microchip documentation; direct raw-page downloads encountered CDN errors. Do not present these digests as complete source snapshots.
- The errata entry pins **DS80000902F provenance only**. The full revision/peripheral issue matrix has not been incorporated. Silence in this bundle does not mean an operating mode is free of errata.
- `compiler-evidence.json` records a real XC8 service build of the exact composed regression fixture for all three MCUs. This exercises the seven recipes together (CCP clock, GPIO, TCA ISR, UART receive/polling, printf and bounded DRE TX). It does not certify arbitrary generated firmware, every route or behavior on hardware. Legacy ATtiny1624/SOIC-14 hardware claims remain scoped to the original demonstrations.
- Electrical limits, board wiring, oscillator accuracy, other AVR families, ADC/SPI/TWI/PWM, advanced USART modes, fuse changes and sleep are outside coverage. Unsupported work must produce a knowledge gap for review or bounded official-source lookup.

## Runtime contract

Application callers in `backend` use `require("./avr-knowledge")`.

- `loadKnowledge()` loads and integrity-checks the immutable bundle once. It exposes `devices`, `recipes` (with descriptions and text), `sources` and `localDocuments: [{url,title,text,sha256,links,...}]`. Runtime loading makes no network calls.
- `resolveKnowledge({mcu,packageName,requirements,recipeIds})` returns `{supported,context,manifest,missing,unsupported,validation}`. An object `requirements` is a structured project specification; free text only informs the model and is not semantically certified by the validator. All seven short recipes load by default for every user language. Explicit recipe selection adds dependencies.
- `validateProjectSpec(spec)` returns `{valid,errors,warnings,normalized}` and checks model/package, available pins, UPDI reservation, ownership conflicts, USART routing/baud and TCA period representability. Resource errors have stable `{code,path,message}` fields. A valid result is a logical allocation check, not compilation or hardware evidence.
- `calculateTimerPeriod({clockHz,periodUs,prescaler})` and `calculateUsartBaud({clockHz,baud,samples})` use exact BigInt intermediate arithmetic, checked ranges and reported rounding error. The UART validator's 2% rounding ceiling is project policy; it does not account for oscillator/peer tolerance.

Structured resources use the shared canvas schema: `kind` is `gpio`, `uart` or `timer`; unused nullable fields are ignored. `includes` uses **plain header names**, such as `xc.h` and `avr/interrupt.h`. Legacy delimiters are normalized for compatibility. Clock coverage is OSC20M and its documented prescalers; the supplied integer Hz describes the actual intended peripheral clock.

## Reproduction and maintenance

Run from the repository root:

```powershell
python scripts/avr-knowledge/snapshot.py --pack C:/path/Microchip.ATtiny_DFP.3.4.278.atpack --verify
# Or explicitly download that pinned official release:
python scripts/avr-knowledge/snapshot.py --download --verify
node scripts/avr-knowledge/build-manifest.js --verify
node --test tests/avr-knowledge.test.js
```

The first script refuses a pack whose bytes differ from the reviewed release. It retains only the selected subset and upstream license; never commit the large pack or redundant PDFs. Without `--verify` it rewrites the extracted subset. HTML digests require human/source review; their hashes do not turn a curated summary into original page bytes. Source URLs and digest semantics are recorded with every selected manifest.

The explicit compiler regression requires the private existing XC8 service:

```powershell
node scripts/avr-knowledge/compile-fixtures.js
```

It compiles sequentially for three targets and writes evidence JSON to stdout. Review diagnostics and target identity before replacing `compiler-evidence.json`; the ordinary unit tests do not invoke a compiler or network. The additional `environmentObservation` was collected separately with read-only compiler-version/package/header-hash commands; repeat that observation before carrying it into new evidence. The compiler uses **XC8 3.10 and DFP 3.3.272 (2025-04-30)**; installed headers exactly match its archived pack. Recorded XCLM privilege diagnostics did not prevent successful output and remain in the evidence.

Selected public symbols shared with the source DFP 3.4.278 have identical expressions or equal integer values: 95 on ATtiny1624, 96 on 1626/1627. The newer pack adds 38/39 unshifted `_gv` aliases absent from the installed pack. These remain in the source snapshot but are excluded from generation context; recipes use the compatible `_gc` constants. This is not a whole-header/ABI equivalence claim. Reproduce that read-only comparison after copying the installed headers to a temporary directory:

```powershell
python scripts/avr-knowledge/compare-installed.py --headers C:/path/copied-headers --pack C:/path/Microchip.ATtiny_DFP.3.4.278.atpack
```

The manifest builder verifies the fixture's content against that evidence before repinning. Run `build-manifest.js` only after reviewing factual, recipe, tutorial-lineage and evidence changes. New device/peripheral coverage deserves its own reviewed version and regression cases, not inferred compatibility.
