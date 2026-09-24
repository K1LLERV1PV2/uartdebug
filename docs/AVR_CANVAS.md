# Shared AVR specification canvas

The AVR page displays the active project's specification canvas. A visitor writes requirements
in their language, selects the exact MCU/package and presses Process. The agent
either edits the requirements and adds anchored questions, or returns a complete
C/Markdown/YAML project. There is no active chat or selectable `skillRefs` catalog.

## Authoritative data and contracts

- The editable canvas stores schema version 2, revision, Markdown, language,
  selected target and annotations. Each annotation has a stable ID, quote/line
  anchor, message, open/resolved status and a user answer. Model responses cannot
  invent user answers or discard existing annotation IDs.
- `POST /api/avr/ai/canvas` accepts that snapshot and optionally the current
  project files. Responses are ordinary JSON or NDJSON progress followed by one
  result. The browser compares the submitted revision and project snapshot before
  applying it; a newer manual edit requires another run.
- A new canvas has an unspecified locale. The model infers it from the actual
  requirements and returns it explicitly. C comments, guide, descriptions and
  annotations use that language. A manual requirements edit clears the inferred
  language so the visitor can switch languages without an extra setting.
  Interface controls and status labels remain English regardless of that language.
- Model JSON is validated against `avr-canvas-contract.js`. Its resource spec
  has a device/package, CPU clock frequency or null for CPU-independent GPIO/PIT,
  allocated GPIO/UART/timer/RTC-PIT
  resources, header names and descriptions. The server serializes YAML from
  this object; there is no independently generated private `_AI.md` copy.
- C, Markdown and YAML are ordinary project files. Each mini-project owns its
  canvas in the existing local/cloud `files` snapshot. Loose files keep a separate
  draft using the `instruction` storage route. Add file offers an Empty project
  with minimal C and Markdown; empty and tutorial projects start with a blank
  canvas. Switching projects restores their saved requirements, annotations and
  target. Responses started before a project switch are rejected. The former
  shared canvas is retained for the active legacy project on first load. Legacy chat
  snapshots and old private drafts are preserved for data compatibility and
  are not read by the new agent.

## Prepared local knowledge

`backend/ai/canvas-rules.md` describes the workflow and code quality contract.
`backend/ai/knowledge/attiny162x/1.3.0` retains the complete datasheet PDF,
silicon errata PDF and DFP archive. It combines a searchable page/section corpus,
exact DFP register/pin facts, separately reviewed PDF facts and compact recipes
derived from educational mini-projects 01–10. The runtime verifies SHA-256 hashes
of all originals and generated files and loads the bundle locally.

The initial canvas includes eight short recipes regardless of the visitor's
language: project structure, clock, GPIO, TCA overflow, RTC/PIT, UART polling,
stdio redirection and interrupt transmission. A structured project selects only
its resource recipes and dependencies. Preparing the bundle is an
offline maintenance operation; ordinary requests do not rebuild it or retrain a
model. Relevant prepared context still consumes API input tokens.

The bundle also contains nine maintained methodology topics: C construction,
project workflow, documentation, GPIO, interrupts, RTC, TCA, TCB and USART.
Core coding style is included in the initial context. The remaining detailed
topics are available through the same local documentation tool, with their
catalog included in the prompt. They teach resource ownership, initialization,
source-specific flag handling, atomic handoff, timing limits and coherent
updates across all project artifacts. The eight executable-scope recipes remain
the authority for which mechanisms the validator supports.

`reference/colleague-sources.json` preserves 40 complete original Markdown/YAML
texts and inventories 73 files from the pinned colleague archive. These originals
are explicitly marked as work in progress and link to the corresponding maintained
methodology. Known mistakes remain visible in the original text; corrected
guidance is in the maintained topic. Three records under `methodology/provenance/`
identify adopted, adapted and omitted material using source paths, hashes and
line ranges. Legacy command markers, per-file approval dialogues and a duplicate
YAML format were not installed as a second agent contract. Empty source headings
were not filled with invented colleague rules.

RTC/PIT supports one-time initialization after reset with nominal INT32K and
power-of-two periods. A GPIO/PIT-only project can declare `clock.hz: null` and
leave the CPU clock and `F_CPU` unspecified. For example, 4096 RTC cycles give
125 ms nominal between interrupts; the first interval and oscillator accuracy
remain documented limitations. Other clock-dependent resources still require
an explicit supported CPU frequency.

Coverage is ATtiny1624 (SOIC-14/TSSOP-14), ATtiny1626
(SOIC-20/SSOP-20/VQFN-20) and ATtiny1627 (VQFN-24), with the supported modes
listed in the manifest. Manual compilation supports more chips than this AI
bundle. ADC, SPI, TWI, PWM, fuse changes and sleep are available as reference
topics but are not approved generation modes in this release.

DFP facts, source reviews, compilation and hardware testing are separate evidence
levels. A matching header symbol does not prove correct peripheral behavior.
Complete page coverage does not mean every table, formula and diagram has been
visually verified. Machine extraction and reviewed facts carry distinct labels.
The reviewed errata records include issue applicability and workarounds. Source
DFP 3.4.278 and installed compiler DFP 3.3.272 remain distinct; only selected
shared symbols have been compared. The manifest and compiler evidence record
these limits.

## Generation checks

The server checks package pins, reserved UPDI, conflicting pin/peripheral
allocations, supported routes/modes and ranges. Timer/baud calculations use
integer arithmetic that avoids intermediate overflow. Source checks include
matching `F_CPU`, explicit resource declarations, W1C writes and guide markers.
These are bounded checks, not a complete C semantic proof or circuit simulation.

Production then compiles the complete source with XC8 for the selected MCU.
The internal guide contract supplies localized verification sentence templates
and one placeholder. The server fills it with the actual result only after the
compile attempt, and omits the templates from public files. Actual timer/baud
calculations are returned with explicit unit keys; prose uses nominal settings.
Validation/compiler failures permit at most two full-project repair attempts;
YAML and documentation must remain synchronized. Compiler infrastructure or
contract failures stop the request. Physical tests are never inferred from a
successful compile. Input tokens are counted before reserving credits, and each
additional model call extends that reservation. Uncertain usage is retained for
reconciliation.

## Exceptional documentation access

The model calls `read_avr_documentation` to browse/search/read maintained
methodology, original colleague texts and the complete local PDF corpus, or to
inspect DFP registers. Methodology document IDs start with `methodology-`; use
`colleague-sources` to catalog original documents. Text reads use `page: 0`, source
line ranges and `nextSectionId` continuation, with at most 12,000 content bytes
per response. PDF reads use one-based pages and `nextPage`. Page results retain
document revision, source hash, sections and matching reviewed facts. An external operation requires
a prior unrestricted search across all local documents for the same query and a concrete remaining knowledge
gap. The server accepts only registered ATtiny162x datasheet/errata HTML roots,
checks a 30-day cache, and permits at most two external requests within ten total
documentation steps. Redirects, other hosts, URL parameters, oversized pages and
non-HTML responses are rejected. `AI_EXTERNAL_DOCUMENTATION_ENABLED=0` disables
only external access; local reference operations remain available.

Manufacturer CDN errors can prevent direct HTML retrieval even when the official
section exists. Normal generation uses the pinned local bundle, not a live website.
The bundle contains all 575 datasheet pages and all 16 errata pages, together
with original files. It is an offline PDF-derived reference, not a WebHelp ZIP
or a claim that the manufacturer's HTML service is currently available.

Maintained methodology is coding guidance within the active contract. Original
colleague texts and extracted official reference pages remain source data. Their
embedded commands cannot override server instructions, and reference-only modes
do not become approved recipes. Incomplete knowledge produces
a visible question or limitation. Missing details about the visitor's circuit
must be supplied by the visitor, not inferred through web access.

## Extending coverage

1. Pin manufacturer HTML or PDF, errata and DFP versions; retain complete
   original files, URLs, hashes and original license notices.
2. Extract/normalize device facts reproducibly with `scripts/avr-knowledge`.
   Review package tables and peripheral routing against the actual datasheet.
3. Adapt existing recipes to that family's register model and list precise
   preconditions. Add new mechanisms only with source evidence and examples.
4. Add conflict/range tests and compile representative recipe compositions for
   each declared target. Add hardware evidence only for the exact tested setup.
5. Publish a new versioned bundle/manifest, register its official retrieval roots,
   and update the status coverage. Do not silently extrapolate one AVR family to
   every other AVR.

For deployment and cache permissions see [AI-SETUP.md](../backend/AI-SETUP.md).
The methodology transfer is described in
[the Russian report](AVR_METHODOLOGY_REPORT_RU.md).
