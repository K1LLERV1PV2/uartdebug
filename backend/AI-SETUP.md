# AVR AI service

The AI service runs independently of the compiler. nginx routes /api/avr/ai/* to uartdebug-ai.service on loopback port 8083. The compiler remains on port 8082 and does not need external network access.

## Credentials and accounts

Secrets are systemd credentials read from root-owned files. Preserve existing credentials on update; never put them in Git or browser configuration.

| Credential | Root-owned source |
| --- | --- |
| OpenAI API key | /etc/uartdebug/secrets/openai-api-key |
| Google client ID | /etc/uartdebug/secrets/google-oauth-client-id |
| Google client secret | /etc/uartdebug/secrets/google-oauth-client-secret |
| Installation identity | /etc/uartdebug/secrets/ai-identity-secret |
| Session signing | /etc/uartdebug/secrets/ai-session-secret |
| Optional owner token | /etc/uartdebug/secrets/ai-access-token |

Use sudoedit and keep files root:root, mode 0400. Google uses openid/email/profile; its callback is https://uartdebug.com/api/avr/ai/auth/google/callback. Production enables AI_GOOGLE_AUTH_ENABLED=1 and AI_GOOGLE_AUTH_REQUIRED=1 through a unit drop-in. Updating the base unit must preserve OAuth settings, account allowlists and identity secrets.

Accounts, sessions, credit history and project snapshots are outside releases in /var/lib/uartdebug-ai/data/ai-access.sqlite. Deployment backs up SQLite before restart and guards incompatible schema rollback. Snapshot writes validate account keys and revisions. See [account and credit documentation](../docs/AI_ACCESS_AND_CREDITS.md).

## Model and project requests

The default is gpt-6.1-sol, medium reasoning, Responses API, and AI_PRICE_CATALOG_VERSION=2026-10-14. Historical Terra catalogs and ledger entries remain unchanged.

The desktop workspace uses `POST /api/avr/ai/chat` with a user message, bounded history and the selected project's current specification, target and artifacts. The service chooses a conversation reply, specification edit, code generation or code description through the shared model, documentation lookup, access and usage-accounting pipeline. A complete implementation request may author its specification and C/resource YAML together, including from an empty draft. Questions and progress appear in Chat rather than new inline question blocks or AI-progress toasts; operation errors also use the standard notification history. Compiler and UART notifications keep their existing toast behavior.

The Review specification shortcut sends `requestSource: "review"`; normal typed requests use `"message"`. Review permits only a conversation reply or specification review. Its prewritten English text is not a language preference: the service uses the project's language or natural conversation context. This distinction does not change the repository's canonical source files.

`POST /api/avr/ai/canvas` retains explicit `analyze`, `generate` and `describe` operations for existing integrations. Its empty review input is allowed, its review uses inline remarks, and its generation preserves the supplied specification exactly. Chat generation explicitly permits the specification changes authorized by the latest request; both transports preserve protected user C regions and validate project names, hardware resources and generated source. Generation verifies C using the compiler and bounded repairs. A repair must preserve the validated specification. Conversation replies, specification reviews and descriptions do not require compiler availability. Generated prose must not invent compilation or hardware results.

Stop cancels browser-side receipt and prevents late artifact application. It does not guarantee that an already started provider call is cancelled; that call may finish and its usage is still recorded. The UI must not claim that server processing or billing stopped.

Conversations are saved atomically with the schema-3 project workspace, in `miniProjects[instanceId].conversation` or `draftConversation` for an unfinished project. The current account identity/revision/conflict/recovery checks apply to them. Older snapshots may omit these fields. Historical chat rows remain recovery data and are not imported; the new chat endpoint does not reactivate their separate store. See [workspace contracts and limits](../docs/AVR_CANVAS.md#validation-and-storage).

nginx allows 16 simultaneous transport requests per IP for the AI routes so status, examples, sign-in and account synchronization can run together. Paid model requests are bounded separately by AI_MAX_CONCURRENT in the Node service (default 2).

## Canonical materials

AI_MATERIALS_ROOT=/var/lib/uartdebug-ai/materials/current/repository points to the complete immutable private UartDebug3 snapshot. The deployment manifest and prepared website catalog sit beside the mirror. The backend verifies the file set, SHA-256 digests and source index inputs, then pins one release per request.

Update UartDebug3 to change the canonical rules and references. Its materials sync workflow activates reviewed snapshots independently of website releases. See [materials deployment](../docs/AI_MATERIALS_DEPLOYMENT.md) and [project contract](../docs/AVR_CANVAS.md).

For local development, export a Git archive and prepare it with backend/deploy/install-materials.py --no-activate. Set AI_MATERIALS_ROOT to the returned root. Supply separate development credentials through OPENAI_API_KEY_FILE and start npm run start:ai --prefix backend. AI_EXTERNAL_DOCUMENTATION_ENABLED=0 disables network reference retrieval; when enabled, official HTML is a bounded fallback after local search.

## Deployment

Deploy verifies materials and the base unit, restarts services, compares running rules/materials digests and the configured model, then runs an unpaid HTTP smoke test. Persistent credentials and data are not replaced.

The chat and four-pane interface use the conversation contract alongside the existing project contracts. Production deployment requires configured Google authentication and verifies that anonymous account access is rejected.

The materials receiver runs on loopback port 8084 as uartmaterials:uartai. It can write only the materials directory and cannot read account data or AI credentials. Uploaded repository content is never executed. Run a manual bootstrap as uartmaterials:uartai so restrictive permissions remain readable by the AI service.

## Compiler isolation

The Linux compiler service requires Bubblewrap and `prlimit` (the `bubblewrap` and `util-linux` packages). Each compiler and objcopy invocation gets its own filesystem, process and network namespaces. Only its request workspace is writable; compiler installations and system libraries are read-only. Host account data, credentials, materials and network services are outside that namespace. The child environment is an explicit allowlist. Output files, output buffers and execution times are bounded.

The versioned `deploy/uartdebug-backend.service` permits only the namespaces needed by Bubblewrap and keeps the outer compiler service under its separate `uartcompile` user. Bubblewrap needs access to kernel UID mapping metadata and netlink for namespace setup. Three outer systemd options (`ProtectHostname`, `ProtectKernelLogs`, `ProtectKernelTunables`) must remain disabled because their locked host procfs submounts prevent an unprivileged child procfs mount. The worker instead gets its own PID-namespace procfs mounted read-only; it receives no host procfs, host credentials or capabilities. The outer service retains its separate non-root user, empty capability set, system/home filesystem protections, private temporary/device mounts and resource limits. The compiler health response includes `checks.sandbox`; unavailable isolation fails closed. Deployment checks the unit and dependencies before changing release links. Rollback refuses backend releases that predate this isolation boundary.
