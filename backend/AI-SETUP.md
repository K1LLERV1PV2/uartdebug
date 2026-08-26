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

Access state, the append-only credit ledger, signed-in AI chat history, the
latest account-scoped AVR file-workspace snapshot, and the separate latest
Project-instruction snapshot live in:

```text
/var/lib/uartdebug-ai/data/ai-access.sqlite
```

The directory is owned by `uartai:uartai`, has mode `0700`, and is the only new
writable path granted to the hardened unit. It is outside release directories so
deployments and rollbacks do not replace it. Treat the database and its backups
as sensitive personal, project-content, and financial-adjacent data. Account
workspace/chat records are structurally and size bounded and use optimistic
revision checks; a stale write must fail as a conflict instead of replacing a
newer snapshot. The current serialized ceilings are 1 MiB for chats, 4 MiB for
files, and 256 KiB for the account Project-instruction snapshot; the more
granular collection and field limits are enforced alongside those byte ceilings
in `ai-access-service.js`. The AI request path validates the instruction again
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

The checked-in rule pack and AI-reference catalog are used by default, and
generated drafts go to the operating system's temporary directory. Set
`AI_RULE_PACK_ROOT` or `AI_DRAFTS_DIR` only when testing alternate locations.
Starting the process without `AI_ENABLED=1` and a readable key file keeps the
health and status endpoints available but disables assistant responses.

Generation is public to visitors of the AVR page during the prototype stage.
The OpenAI key remains server-only; the browser never receives it. Same-origin
checks and technical request safeguards still apply. There is currently no
per-IP generation quota, conversation-message quota, or daily usage quota.
The Google OAuth start endpoint has a separate technical abuse guard: by
default it permits 10 starts per source IP and 1,000 globally per 10-minute
process window. This protects SQLite from login-start bursts and does not limit
AI conversation messages. Account-workspace PUTs have a separate account-scoped
technical guard of 1,200 attempts per 10-minute process window by default. A 429
response includes `Retry-After`; this safeguard neither consumes AI Credits nor
sets a conversation-message limit.

## Instruction blocks and the reviewed project instruction

Reusable browser-visible instruction blocks are versioned separately from the
private mini-project AI references:

```text
backend/ai/skills/catalog.json
backend/ai/skills/*.md
```

The catalog may intentionally contain an empty `skills` array while the real
instruction-block library is being designed. The endpoint remains available so
future versioned blocks can be published without changing the browser contract.

`GET /api/avr/ai/skills` returns only the allowlisted `id`, `version`, `title`,
`summary`, and Markdown content. The loader rejects symlinks, escaping paths,
unexpected catalog fields, oversized content, duplicate identifiers, and files
whose SHA-256 does not match the catalog. Private `_AI.md` mini-project
references are never exposed by this endpoint.

To add or replace a block, create a new Markdown file, update its catalog entry
and version, calculate the SHA-256 over the exact UTF-8 file bytes, and run:

```sh
npm test --prefix backend
```

Do not edit a published block in place without also changing its version and
hash. The deployment installer validates and copies the complete catalog before
restarting the service; the smoke test verifies that the public endpoint exposes
only the allowlisted shape.

The AVR page stores the visitor's assembled Markdown instruction in
`localStorage` for unsigned and offline use. After Google sign-in it also syncs
that document as a third account-scoped snapshot, with a revision independent
from the chat and file snapshots. It is not attached to a chat, so switching
chats must not switch instructions. The instruction is sent as untrusted user
context with explicit AI requests. A request to revise that document uses the
dedicated `edit_avr_project_instruction` tool and returns the exact base
revision; the browser refuses to overwrite newer manual edits. Project
create/update actions receive the reviewed instruction as their primary project
requirements, but do not silently rewrite it while generating project files.

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
service once with `deploy/install-ai-service.sh`. Run it again whenever the
checked-in unit, credential list, writable paths, or one-time host setup changes:

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

This manual step matters: the normal GitHub deployment uploads versioned backend
files and restarts the already-installed `uartdebug-ai.service`, but it does not
copy a changed unit into `/etc/systemd/system`, create new credential files, or
create new persistent data directories. A code deploy alone therefore does not
activate systemd-foundation changes.

The deployment workflow invokes `backup-ai-access-database.sh` before switching
the backend release or restarting the AI service. The helper uses SQLite's
online backup command and verifies the copy's integrity and schema version. A
schema-changing deployment therefore fails closed if `sqlite3` is missing or the
backup cannot be verified. Rolling back from schema 2 to an older schema-1
backend also requires restoring its matching pre-migration database backup;
switching only the release symlink is insufficient. Before any rollback release
symlink changes, the workflow compares the live SQLite `user_version` with the
target backend's `AI_ACCESS_SCHEMA_VERSION` and refuses an incompatible rollback
with restore instructions. Verified workflow pre-migration backups use narrowly
validated names and contents under `/var/backups/uartdebug-ai`; the helper keeps
the newest 10 and deletes only older root-owned mode-0700 directories whose
database integrity and metadata schema version are verified. Manual installer
and unrelated operational backups are outside that retention set.

## Replacing the rule pack

Rule packs are immutable directories under:

```text
/var/lib/uartdebug-ai/rule-packs/packages/<package-id>/
```

Install and validate a new package beside the old one. Then atomically replace
`/var/lib/uartdebug-ai/rule-packs/active.json` with a pointer containing its
`packageId`. The service reads the pointer for every status/generation request,
so no restart is required. Keep the previous package for rollback.

Normal deployments run `deploy/install-ai-rule-pack.sh` before switching the
release and verify that the status endpoint reports the exact package declared
by that release. The same installer is run for rollbacks, so code and rules
return to a compatible pair.

`manifest.json` declares the runtime files, their order, and the SHA-256 of
every package file. The foundation rules and all versioned mini-project templates are
included in the runtime prompt. `codex/AGENTS.md` stays maintenance-only and is
never sent to the model.

## Runtime safeguards and retention

The production service unit allows one concurrent generation. The HTTP server
enforces a 1 MiB generation-request ceiling, bounded individual fields, a model
timeout, an output-token ceiling, and the Google-login start guard described
above. Authenticated account snapshots are limited independently to 1 MiB for
chats, 4 MiB for files, and 256 KiB for the Project instruction. The nginx AI
location allows 5 MiB so the largest revision envelope can reach the stricter
Node validator. nginx keeps a connection-concurrency safeguard, but AI
generation-rate and daily quotas are currently disabled. The account-scoped
workspace PUT guard described above only bounds repeated persistence writes; the
1 MiB aggregate chat snapshot and 128 KiB per-message field limit are technical
storage bounds, not a fixed chat-message count.

Without Google sign-in, chat and AVR file-workspace state remain browser-local,
and the Project instruction remains in `localStorage`. After sign-in, the
browser can restore and revision-sync the account's chat history, latest
complete AVR file-workspace snapshot, and separate Project-instruction snapshot
through the AI service. All three have independent revisions; the instruction
remains independent of chat selection.

Synchronization alone does not call Google or OpenAI. Each explicit AI request
includes the newest complete exchanges and project context that fit a 768 KiB
target. This is transport/context protection rather than a message or access
quota; users can continue the conversation without a fixed interaction count.

The OpenAI Responses request uses Structured Outputs with `store: false`.
Application logs contain request identifiers, status codes, error codes, and
durations, not user prompts or generated content.

For a create or update action, only the generated server-side `_AI.md` reference
and a small non-secret manifest are stored in `/var/lib/uartdebug-ai/drafts`.
With the checked-in service defaults, drafts expire after 30 days and the
directory is capped at 100 drafts.
