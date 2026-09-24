# AVR AI service

The paid OpenAI request path is isolated from `uartdebug-backend.service`.
The compiler continues to run without external network access; nginx sends only
`/api/avr/ai/*` to `uartdebug-ai.service` on `127.0.0.1:8083`.

## API key

The key is a systemd credential, not an environment variable. The credential
source is:

```text
/etc/uartdebug/secrets/openai-api-key
```

The file must contain only the key followed by an optional newline. Keep it
owned by `root:root` with mode `0400`. Edit it interactively with:

```sh
sudoedit /etc/uartdebug/secrets/openai-api-key
sudo systemctl restart uartdebug-ai.service
```

Never put the key in browser code, Git, shell history, or an `Environment=`
line.

## Google sign-in and access storage

Google sign-in uses a server-side OAuth 2.0 / OpenID Connect flow. The production
unit reads all secret values through systemd `LoadCredential=` entries:

| Credential name | Root-owned source file | Bootstrap value |
| --- | --- | --- |
| `openai_api_key` | `/etc/uartdebug/secrets/openai-api-key` | empty |
| `google_oauth_client_id` | `/etc/uartdebug/secrets/google-oauth-client-id` | empty |
| `google_oauth_client_secret` | `/etc/uartdebug/secrets/google-oauth-client-secret` | empty |
| `ai_identity_secret` | `/etc/uartdebug/secrets/ai-identity-secret` | random, persistent |
| `ai_session_secret` | `/etc/uartdebug/secrets/ai-session-secret` | random, persistent |
| `ai_access_token` | `/etc/uartdebug/secrets/ai-access-token` | random, currently dormant |

The bootstrap script creates all six files as `root:root` mode `0400`. It never
replaces a non-empty persistent secret. The Google files intentionally start
empty; fill them interactively after creating the Web application OAuth client:

```sh
sudoedit /etc/uartdebug/secrets/google-oauth-client-id
sudoedit /etc/uartdebug/secrets/google-oauth-client-secret
```

The production Google redirect URI is exactly:

```text
https://uartdebug.com/api/avr/ai/auth/google/callback
```

Use only the `openid` and `email` scopes. Detailed Google Cloud setup,
the sign-in flow, device semantics, and free-access rules are documented in
[`../docs/AI_ACCESS_AND_CREDITS.md`](../docs/AI_ACCESS_AND_CREDITS.md).

The checked-in unit starts with both `AI_GOOGLE_AUTH_ENABLED=0` and
`AI_GOOGLE_AUTH_REQUIRED=0`, so deploying the code does not expose an unfinished
Google flow or lock existing users out. Test OAuth in a staged optional mode by
setting `AI_GOOGLE_AUTH_ENABLED=1` while leaving
`AI_GOOGLE_AUTH_REQUIRED=0`: signed-in requests use the account/device budget,
while unsigned requests retain prototype public access. Once the credentials,
callback, session restoration, failure states, and public privacy information
have been verified, require sign-in by enabling both switches:

```sh
sudo systemctl edit uartdebug-ai.service
```

Add:

```ini
[Service]
Environment=AI_GOOGLE_AUTH_ENABLED=1
Environment=AI_GOOGLE_AUTH_REQUIRED=1
```

Then run:

```sh
sudo systemctl daemon-reload
sudo systemctl restart uartdebug-ai.service
```

Access state, the append-only credit ledger, preserved legacy chat history, the
latest account-scoped AVR file-workspace snapshot, and the separate latest
canvas snapshot live in:

```text
/var/lib/uartdebug-ai/data/ai-access.sqlite
```

The directory is owned by `uartai:uartai`, has mode `0700`, and is writable by the
hardened unit alongside the official-documentation cache. It is outside release directories so
deployments and rollbacks do not replace it. Treat the database and its backups
as sensitive personal, project-content, and financial-adjacent data. Account
workspace/chat records are structurally and size bounded and use optimistic
revision checks; a stale write must fail as a conflict instead of replacing a
newer snapshot. The current serialized ceilings are 1 MiB for chats, 4 MiB for
files, and 256 KiB for the account canvas snapshot; the more
granular collection and field limits are enforced alongside those byte ceilings
in `ai-access-service.js`. The AI request path validates the canvas again
and may use a stricter limit than account storage. The sync API exposes a second,
domain-separated HMAC value as `accountKey` for browser-local sync metadata; it
never exposes the stored account hash, Google subject, or email address. Every
workspace PUT must echo that value as `expectedAccountKey` beside
`baseRevision` and `data`. The server compares it with the freshly authenticated
session before persistence, so a stale tab cannot save one account's local state
after the shared browser cookie has switched to another account.

The checked-in unit provisionally grants a nominal 500 AI Credits per eligible
account and browser-installation pair, representing USD 0.50 of catalogued
provider cost. This is an adjustable launch hypothesis chosen to allow a
typical reference-loaded project request to clear the minimum reservation, not
a permanent quota promise. Recalibrate it from measured median and p95 costs
before advertising a fixed allowance.

For metered requests, the service first asks OpenAI's input-token endpoint for
the exact request size, transactionally reserves the input cost plus an output
allowance, and reduces `max_output_tokens` to the affordable amount. It settles
the reservation from the provider response's usage. A request whose provider
outcome is ambiguous keeps its reservation in `needs_reconciliation` instead of
silently returning the value to the user.

## Local development

The production unit uses a systemd credential, but local development can point
to a protected key file outside the repository. Set these variables in the
shell that starts the service:

```text
AI_ENABLED=1
OPENAI_API_KEY_FILE=/absolute/path/to/openai-api-key
ALLOWED_ORIGINS=http://localhost:8000
AI_PUBLIC_BASE_URL=http://localhost:8000
AI_ACCESS_DB_PATH=/absolute/path/outside/repository/ai-access.sqlite
AI_GOOGLE_AUTH_ENABLED=0
AI_GOOGLE_AUTH_REQUIRED=0
```

Then run:

```sh
npm run start:ai --prefix backend
```

The versioned local knowledge bundle and `backend/ai/canvas-rules.md` ship with
the backend release. A new canvas may omit its language; the model determines
it from the requirements, then C explanations, YAML descriptions and the guide
use that language. Stable schema keys and code identifiers are not translated.

Optional documentation lookup first reads the local bundle and a persistent
cache. Set `AI_DOCUMENTATION_CACHE_DIR` to a writable directory outside the
repository; the default for local development is an operating-system temporary
directory. Set `AI_EXTERNAL_DOCUMENTATION_ENABLED=0` to prohibit external
retrieval. A missing API key or `AI_ENABLED=0` leaves health/status endpoints
available while generation remains disabled.

## Compiler verification and repair

Project create/update responses are not persisted or returned until their C
source passes the trusted AVR compiler service. The AI service checks compiler
readiness before input-token accounting or any paid OpenAI request. The compiler
health endpoint fails closed unless `XC8_CC` and `AVR_OBJCOPY` resolve to regular
executable files and `XC8_DFP` is a readable, traversable directory. Health and
compile responses carry the shared `uartdebug-avr-compile/v1` contract and exact
server version; a missing, stale, or malformed contract is an error, never a
successful verification.

The public compiler endpoint has a separate in-memory abuse guard because each
accepted request starts external toolchain processes. Its defaults are 12 starts
per client and 120 starts globally per 60-second process window. Configure
`COMPILE_RATE_LIMIT_WINDOW_MS`, `COMPILE_RATE_LIMIT_MAX_PER_CLIENT`, and
`COMPILE_RATE_LIMIT_MAX_GLOBAL` when server capacity changes. At most two
compiles run simultaneously by default; tune that separate in-flight guard with
`COMPILE_MAX_CONCURRENT`. These guards do not spend or reduce AI credits.

These AI-service variables control the integration:

| Variable | Production value | Meaning |
| --- | --- | --- |
| `AI_COMPILE_VERIFY_ENABLED` | `1` | Require compiler verification for project create/update requests. |
| `AI_COMPILE_URL` | `http://127.0.0.1:8082/api/avr/compile` | Private compiler endpoint. |
| `AI_COMPILE_HEALTH_URL` | `http://127.0.0.1:8082/health` | Readiness and contract endpoint checked before OpenAI. |
| `AI_COMPILE_HEALTH_TIMEOUT_MS` | `5000` | Readiness-request deadline. |
| `AI_COMPILE_TIMEOUT_MS` | `65000` | Deadline for each generated-project compile attempt. |
| `AI_COMPILE_MAX_REPAIR_ATTEMPTS` | `2` | Maximum compiler-guided AI repair calls after the initial generation. |

Repair calls receive the original untrusted user context, the complete candidate
project, and sanitized compiler diagnostics. Each repaired candidate is compiled
again. Generation, compilation, and repair expose `in_progress`, `completed`,
and `failed` progress events over optional NDJSON streaming; ordinary JSON
clients remain supported. If provider usage becomes ambiguous during repair,
the expanded reservation is retained for reconciliation instead of being
partially settled or released.

Generation is public to visitors of the AVR page during the prototype stage.
The OpenAI key remains server-only; the browser never receives it. Same-origin
checks and technical request safeguards still apply. There is currently no
per-IP generation quota or daily usage quota.
The Google OAuth start endpoint has a separate technical abuse guard: by
default it permits 10 starts per source IP and 1,000 globally per 10-minute
process window. This protects SQLite from login-start bursts and does not limit
canvas processing. Account-workspace PUTs have a separate account-scoped
technical guard of 1,200 attempts per 10-minute process window by default. A 429
response includes `Retry-After`; this safeguard neither consumes AI Credits nor
sets a canvas-operation quota.

## Canvas, project contract and local knowledge

`POST /api/avr/ai/canvas` is the only active AI operation. The request contains
`canvas: {schemaVersion: 2, revision, markdown, locale, annotations, target}`, the
selected `mcu` and `packageName`, and optionally the current C/guide/YAML project.
The agent either returns clarification annotations or generates the complete
project. The response carries `baseRevision`; the browser refuses to overwrite
requirements edited while the request was running. Annotation IDs and user
answers survive every model edit.

Generated projects contain public `source`, `guide` and `specification` file
roles. The server serializes YAML from a checked JSON specification containing
the MCU, package, clock, allocated peripherals and pins. There is no new private
`_AI.md` artifact or browser-visible skill-block catalog. `/respond`, `/generate`
and `/skills` are retired and return 404. The legacy account chat storage routes
remain available so stored user history is not deleted by this migration.

The browser stores each mini-project's canvas locally and synchronizes it in
that project's metadata in the account `files` snapshot. The separate
`instruction` snapshot holds the draft for loose files. Canvas schema 2 replaces
obsolete `skillRefs` with locale, annotations and target. Schema-1 instructions
are still readable for migration; the former shared draft is retained for the
active legacy project. The separate instruction route rejects schema downgrades.
Both account documents use optimistic revisions and account-identity checks;
the browser also rejects AI responses after a project switch.

The pilot knowledge release is stored under:

```text
backend/ai/canvas-rules.md
backend/ai/knowledge/attiny162x/1.3.0/
```

The manifest records source provenance, versioned device facts, recipe paths and
SHA-256 digests. `loadKnowledge()` verifies each declared file before using the
bundle. The initial canvas receives eight compact recipes; a structured project
selects its resource recipes and dependencies, regardless of the user's language.
Core coding methodology is also included in the initial context. Nine maintained
topics are indexed under `methodology/catalog.json`: coding style, workflow,
documentation, GPIO, interrupts, RTC, TCA, TCB and USART. Detailed sections are
retrieved locally as needed. The complete tutorials and original methodology
texts are not attached to every request. The pilot covers ATtiny1624/1626/1627 with the
packages listed in status metadata; unsupported hardware yields a canvas issue.
Do not interpret the pilot as support for every AVR or every peripheral.

The bundle includes complete original PDFs (575 datasheet + 16 errata pages)
and the DFP archive, their extracted local corpus, full pilot register metadata
and separately reviewed facts. The deployment must preserve `reference/raw/`:
hash verification intentionally fails if originals are missing or modified.

Preserve `methodology/` and `reference/colleague-sources.json` as well. The latter
contains 40 complete original Markdown/YAML texts and an inventory of 73 archive
files. The source ZIP is locked by SHA-256. Original texts retain their working
status and link to maintained corrections; they are not extra system instructions.
The three methodology provenance records explain adoption, adaptation and
omission with original paths, hashes and line ranges. The catalog and individual
texts are covered by the bundle manifest. Do not replace the maintained topics
with raw colleague files or translate them into a second resource schema.

When a necessary fact is missing from the prompt, `read_avr_documentation`
supports local `catalog`, `search`, `read` and `registers` operations. The catalog
includes `methodology-*` document IDs and the `colleague-sources` collection.
Methodology and original-text reads use `page: 0` and `nextSectionId`; content
is bounded to 12,000 bytes per read and carries source line ranges. PDF reads
continue with `nextPage`. Search distinguishes official candidates, maintained
methodology and original work-in-progress sources. Only an
explicit `external` operation after an unrestricted search across all local
documents for the same query and
an explanation of the remaining gap can access the website. There are at most
ten documentation steps and two external HTML requests per generation. External
URLs are restricted to registered Microchip datasheet/errata roots; redirects,
timeouts and oversized responses are rejected. No general web search is offered.
Reference extraction and imported examples are not automatically promoted into
approved recipes. TCB, advanced RTC/TCA/USART modes and other unsupported
mechanisms remain reference-only even when their methodology is available.

Between provider responses, confirmed usage replaces the previous maximum
reservation before the next response is authorized. Unknown provider usage keeps
its hold for reconciliation. A request permits up to thirteen provider responses
(initial response, ten documentation continuations and two repairs), with one
final ledger record. Error responses return the settled quota when available and
diagnostic stage/cause codes without user requirements or source code.

Production reference cache:

```text
/var/lib/uartdebug-ai/documentation
```

The installer creates it as `uartai:uartai`, mode `0700`; cached files use mode
`0600`. Entries expire for reuse after 30 days. Cached public documentation is
separate from account data and may be rebuilt. Legacy drafts and rule-pack
folders are not used by the canvas service and are left on disk during migration.

The service also keeps a dormant random access credential in:

```text
/etc/uartdebug/secrets/ai-access-token
```

The credential is not used or sent to the browser while
`AI_REQUIRE_ACCESS_TOKEN=0`. To opt in to private access later, set
`AI_REQUIRE_ACCESS_TOKEN=1` in `uartdebug-ai.service`, restart the service, and
have the authorized client send the credential in the
`X-UartDebug-AI-Token` request header. Never use the OpenAI API key as that
access credential.

Before the first GitHub deployment that contains `ai-server.js`, bootstrap the
service once with `deploy/install-ai-service.sh`. Run it again when the
credential list, service account, writable paths, or another one-time host
foundation changes:

```sh
sudo /bin/bash /var/www/uartdebug/backend/deploy/install-ai-service.sh \
  /var/www/uartdebug/backend
```

The installer can use the active backend directory as its stage, preserves all
existing credential values, checks for Node.js 22.13 or newer before changing
the host, installs locked production dependencies and the current unit, verifies
it, and restarts the service. If an access database already exists, `sqlite3` is
required and the installer takes a consistent online backup before changing the
service.

The normal GitHub deployment validates and installs the checked-in
`uartdebug-ai.service` unit, runs `systemctl daemon-reload`, and then restarts the
already-bootstrapped service. It deliberately does not create the service
account, credential files, or persistent data directories. A unit-only change
therefore ships with the normal workflow, while a host-foundation change still
requires the installer above.

The deployment workflow invokes `backup-ai-access-database.sh` before switching
the backend release or restarting the AI service. The helper uses SQLite's
online backup command and verifies the copy's integrity and schema version. A
schema-changing deployment therefore fails closed if `sqlite3` is missing or the
backup cannot be verified. The canvas release advances SQLite `user_version`
to 3 without rewriting existing rows: older schema-2 backends cannot read the
new canvas payloads. Rolling back to a pre-canvas backend therefore requires
restoring its matching pre-migration database backup;
switching only the release symlink is insufficient. Before any rollback release
symlink changes, the workflow compares the live SQLite `user_version` with the
target backend's `AI_ACCESS_SCHEMA_VERSION` and refuses an incompatible rollback
with restore instructions. Verified workflow pre-migration backups use narrowly
validated names and contents under `/var/backups/uartdebug-ai`; the helper keeps
the newest 10 and deletes only older root-owned mode-0700 directories whose
database integrity and metadata schema version are verified. Manual installer
and unrelated operational backups are outside that retention set.

## Updating the knowledge release

Update recipes, device facts and their source records together, then recalculate
manifest digests and run the contract, knowledge, service and compiler checks.
Changing only an authoritative source file without its digest fails loading.
A successful C compile alone does not demonstrate correct electrical behavior.
Keep hardware verification status explicit when adding or changing a recipe.

For methodology maintenance, reproduce the original-text corpus against the
user-provided archive when it is available:

```sh
python scripts/avr-knowledge/import-methodology.py --archive /path/to/UartDebug2_1.zip --verify
```

Normal offline CI uses the already pinned corpus: run
`node scripts/avr-knowledge/build-methodology.js --verify`
before `node scripts/avr-knowledge/build-manifest.js --verify`, then the
methodology and documentation-lookup tests. Update curated topics and provenance
together when a source rule is corrected; keep the original source text intact.

The additional exact fixtures `gpio-interrupt-handoff.c` and
`rtc-pit-coalesced-tick.c` were compiled with the XC8 service for ATtiny1624,
ATtiny1626 and ATtiny1627. Their source hashes and compiler responses are recorded
in `compiler-evidence-gpio-handoff.json` and
`compiler-evidence-methodology-forward.json`. These records demonstrate compiler
acceptance of those bytes, not general peripheral support or hardware behavior.

The complete `ai/knowledge` directory and `ai/canvas-rules.md` are shipped with
each backend release, alongside `avr-ai-runtime.js`, `avr-canvas-contract.js`,
`avr-documentation-lookup.js`, `avr-methodology.js` and `avr-knowledge.js`. Deploy and rollback use the
corresponding release's corpus. Status exposes the active rules digest and
knowledge version; old rule-pack pointers are not read by the canvas service.

Run the installer when migrating an existing host to provision the documentation
cache and writable-unit path. Database backups, secret preservation and schema
rollback guards remain required. The smoke test checks the canvas status,
retired routes and account session without spending OpenAI credits.

## Runtime safeguards and retention

The production service unit allows one concurrent generation. The HTTP server
enforces a 1 MiB generation-request ceiling, bounded individual fields, a model
timeout, an output-token ceiling, and the Google-login start guard described
above. Authenticated account snapshots are limited independently to 1 MiB for
chats, 4 MiB for files, and 256 KiB for the canvas. The nginx AI
location allows 5 MiB so the largest revision envelope can reach the stricter
Node validator. nginx keeps a connection-concurrency safeguard, but AI
generation-rate and daily quotas are currently disabled. The account-scoped
workspace PUT guard described above only bounds repeated persistence writes; the
1 MiB aggregate chat snapshot and 128 KiB per-message field limit are technical
storage bounds, not a fixed chat-message count.

Without Google sign-in, the canvas and AVR files remain browser-local. After
sign-in, the browser restores and revision-syncs the latest account file and
canvas snapshots. Existing legacy chat snapshots are retained but do not form
the active AI context.

Synchronization does not call OpenAI. Each explicit canvas request sends the
current requirements, structured annotations and optional current project. The
OpenAI Responses request uses Structured Outputs with `store: false`.
Application logs contain request identifiers, status codes, error codes and
durations, not requirements or generated content.

The canvas service does not create new private draft artifacts. Generated C,
YAML and documentation are returned to the browser and may be stored in the
account workspace. Removing obsolete server-side drafts is a separate data
retention operation, not part of deployment.
