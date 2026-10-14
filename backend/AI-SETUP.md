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

## Model and project stages

The default is gpt-6.1-sol, medium reasoning, Responses API, and AI_PRICE_CATALOG_VERSION=2026-10-14. Historical Terra catalogs and ledger entries remain unchanged.

POST /api/avr/ai/canvas accepts analyze, generate or describe. Empty review input is allowed. Generation verifies C using the compiler and bounded repairs. Review/description do not depend on compiler availability. Generated prose must not invent compilation or hardware results.

nginx allows 16 simultaneous transport requests per IP for the AI routes so status, examples, sign-in and account synchronization can run together. Paid model requests are bounded separately by AI_MAX_CONCURRENT in the Node service (default 2).

## Canonical materials

AI_MATERIALS_ROOT=/var/lib/uartdebug-ai/materials/current/repository points to the complete immutable private UartDebug2 snapshot. The manifest and indexes remain outside the mirror. The backend verifies its exact file set and SHA-256 digests, then pins one release per request.

The website no longer ships duplicate ai/knowledge, recipes or mini-project source trees. Update UartDebug2; its GitHub Action updates materials independently of website releases. See [materials deployment](../docs/AI_MATERIALS_DEPLOYMENT.md) and [project contract](../docs/AVR_CANVAS.md).

For local development, export a Git archive and prepare it with backend/deploy/install-materials.py --no-activate. Set AI_MATERIALS_ROOT to the returned root. Supply separate development credentials through OPENAI_API_KEY_FILE and start npm run start:ai --prefix backend. AI_EXTERNAL_DOCUMENTATION_ENABLED=0 disables network reference retrieval; when enabled, official HTML is a bounded fallback after local search.

## Deployment

Deploy verifies materials and the base unit, restarts services, compares running rules/materials digests and the configured model, then runs an unpaid HTTP smoke test. Persistent credentials and data are not replaced.

The materials receiver runs on loopback port 8084 as uartmaterials:uartai. It can write only the materials directory and cannot read account data or AI credentials. Uploaded repository content is never executed. Run a manual bootstrap as uartmaterials:uartai so restrictive permissions remain readable by the AI service.
