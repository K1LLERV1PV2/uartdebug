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

Generation is owner-only during the prototype stage. A separate random access
code is stored in:

```text
/etc/uartdebug/secrets/ai-access-token
```

Read it from an SSH session with
`sudo cat /etc/uartdebug/secrets/ai-access-token`, then enter it in the AI pane.
The browser keeps it only in `sessionStorage`; it is not the OpenAI API key.

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

## Runtime limits

The default service unit allows one concurrent generation, three attempts per
IP per 30 minutes, and ten attempts per UTC day. The daily counter survives
service restarts. The OpenAI Responses request uses Structured Outputs with
`store: false`. User prompts and generated content are not written to logs.
Only the private generated `_AI.md` file and a small non-secret manifest are
stored in `/var/lib/uartdebug-ai/drafts`; drafts expire after 30 days and the
default quota is 100 drafts.
