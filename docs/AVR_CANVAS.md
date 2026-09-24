# Shared AVR specification canvas

The AVR page uses a single specification canvas. A visitor writes requirements
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
- Model JSON is validated against `avr-canvas-contract.js`. Its resource spec
  has a device/package, actual clock frequency, allocated GPIO/UART/timer
  resources, header names and descriptions. The server serializes YAML from
  this object; there is no independently generated private `_AI.md` copy.
- C, Markdown and YAML are ordinary project files. The canvas remains a separate
  account snapshot using the existing `instruction` storage route. Legacy chat
  snapshots and old private drafts are preserved for data compatibility and
  are not read by the new agent.

## Prepared local knowledge

`backend/ai/canvas-rules.md` describes the workflow and code quality contract.
`backend/ai/knowledge/attiny162x/1.0.0` is the first device bundle. It combines
exact DFP-derived register/pin facts, reviewed factual excerpts of official HTML,
and compact recipes derived from educational mini-projects 01–10. The runtime
verifies declared SHA-256 hashes and loads the bundle locally.

The pilot includes all seven short recipes in its context regardless of the
visitor's language: project structure, clock, GPIO, TCA overflow, UART polling,
stdio redirection and interrupt transmission. Larger future bundles can use
explicit recipe selection and declared dependencies. Preparing the bundle is an
offline maintenance operation; ordinary requests do not rebuild it or retrain a
model. Relevant prepared context still consumes API input tokens.

Coverage is ATtiny1624 (SOIC-14/TSSOP-14), ATtiny1626
(SOIC-20/SSOP-20/VQFN-20) and ATtiny1627 (VQFN-24), with the supported modes
listed in the manifest. Manual compilation supports more chips than this AI
bundle. ADC, SPI, TWI, PWM, fuse changes, sleep and full errata coverage are not
claimed by this release.

DFP facts, source reviews, compilation and hardware testing are separate evidence
levels. A matching header symbol does not prove correct peripheral behavior.
The curated HTML hashes identify the local excerpts, not a complete downloaded
datasheet. Errata provenance alone does not establish that all silicon issues
have been evaluated. The manifest and compiler evidence record these limits.

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

The model can call `read_avr_documentation` with a concrete missing fact and an
official section URL. The server accepts only the registered ATtiny162x
datasheet/errata roots, checks local excerpts and a 30-day cache, and permits at
most two external section requests. Redirects, other hosts, URL parameters,
oversized pages and non-HTML responses are rejected. Retrieval can be disabled
with `AI_EXTERNAL_DOCUMENTATION_ENABLED=0`.

Returned text is reference data. It cannot override the server instructions and
does not automatically become a reviewed recipe. Incomplete knowledge produces
a visible question or limitation. Missing details about the visitor's circuit
must be supplied by the visitor, not inferred through web access.

## Extending coverage

1. Pin a manufacturer HTML revision, errata revision and DFP version; retain
   source URLs, acquisition evidence and redistribution notices.
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
