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

## Local development

The production unit uses a systemd credential, but local development can point
to a protected key file outside the repository. Set these variables in the
shell that starts the service:

```text
AI_ENABLED=1
OPENAI_API_KEY_FILE=/absolute/path/to/openai-api-key
ALLOWED_ORIGINS=http://localhost:8000
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
per-IP request quota, conversation-message quota, or daily usage quota.

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
service once with `deploy/install-ai-service.sh`. The workflow checks for the
unit before changing any release symlink and stops with instructions if the
bootstrap has not been completed.

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
every package file. The foundation rules and three mini-project templates are
included in the runtime prompt. `codex/AGENTS.md` stays maintenance-only and is
never sent to the model.

## Runtime safeguards and retention

The production service unit allows one concurrent generation. The HTTP server
also enforces a 384 KiB request-body ceiling, bounded individual fields, a model
timeout, and an output-token ceiling. nginx keeps a connection-concurrency
safeguard, but request-rate and daily quotas are currently disabled.

The OpenAI Responses request uses Structured Outputs with `store: false`.
Application logs contain request identifiers, status codes, error codes, and
durations, not user prompts or generated content.

For a create or update action, only the generated server-side `_AI.md` reference
and a small non-secret manifest are stored in `/var/lib/uartdebug-ai/drafts`.
With the checked-in service defaults, drafts expire after 30 days and the
directory is capped at 100 drafts.
