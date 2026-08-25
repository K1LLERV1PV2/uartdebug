# AI access and credits

This document is the design contract for Google sign-in, best-effort device
identity, free AI access, and a possible future paid-credit system. It separates
what can be enforced by the service from assumptions that still need product,
legal, and payment-provider decisions.

## Identity model

AI access has two independent identities:

- **Google account:** the server validates Google's OpenID Connect issuer and
  identifies the account by the verified `sub` claim. Email is masked display
  metadata, not a stable key.
- **Browser installation:** the backend creates a random internal device record
  when Google sign-in begins and binds it to a signed `Secure`, `HttpOnly`,
  `SameSite=Lax` cookie. Frontend JavaScript never receives or persists a device
  bearer secret. The database stores only the internal device ID, and cookie
  signatures use the server's persistent `AI_IDENTITY_SECRET`.

In this project, “device” always means this best-effort browser installation.
It does not mean a physical computer, phone, serial adapter, CPU ID, advertising
ID, or hardware fingerprint. Different browsers and browser profiles on one
computer are different installations. Clearing site data, private browsing,
restoring an old profile, or reinstalling the browser can change the identity.

This deliberately avoids invasive fingerprinting. Browser fingerprinting still
cannot prove hardware uniqueness and creates privacy, consent, false-positive,
and long-term compatibility problems.

For signed-in metered requests, OpenAI receives a random pseudonymous internal
installation identifier in `safety_identifier`. It does not receive the device
cookie, Google account identifier, or email address through this field.

## Google sign-in flow

The backend owns the OAuth 2.0 / OpenID Connect authorization-code flow:

1. The browser asks `/api/avr/ai/auth/google/start` to begin sign-in.
2. The backend creates short-lived `state`, nonce, and PKCE values, then redirects
   to Google.
3. Google redirects only to
   `https://uartdebug.com/api/avr/ai/auth/google/callback`.
4. The backend validates the state, nonce, initiating-device cookie, issuer,
   audience, signature, and token lifetime, then upserts the account by Google's
   `sub` claim.
5. The backend creates its own opaque session. Google access and ID
   tokens are never put in `localStorage` or exposed to frontend JavaScript.
6. The browser reads current access state through
   `/api/avr/ai/auth/session` and signs out through
   `/api/avr/ai/auth/logout`.

Only the `openid` and `email` scopes are needed. The browser must not
send a Google ID token directly as a substitute for the server callback flow.

### Google Cloud configuration

Before enabling required sign-in in production:

1. Create or select a Google Cloud project.
2. Configure the OAuth consent screen/Google Auth Platform branding, audience,
   contact information, and the minimum scopes listed above.
3. Create an OAuth client with application type **Web application**.
4. Add exactly this authorized redirect URI:
   `https://uartdebug.com/api/avr/ai/auth/google/callback`.
5. Configure the authorized domain and publish the production consent screen
   when testing mode is no longer appropriate. Google may also require verified
   homepage, privacy-policy, and terms links.
6. Put the client ID and client secret into the protected server credential
   files described in [`backend/AI-SETUP.md`](../backend/AI-SETUP.md). Do not add
   them to GitHub Actions, source files, browser code, or an `Environment=` line.
7. Test sign-in and sign-out with optional Google mode. Require sign-in only
   after the callback, session restoration, failure states, and privacy notice
   have been verified in production.

Google's console labels can change; the security properties above are the
configuration requirements, regardless of where Google places them in its UI.

## Free-access rule

The provisional nominal grant is 500 AI Credits, representing USD 0.50 of
catalogued provider cost. This is a starting hypothesis selected so a typical
reference-loaded project request can clear the minimum reservation, not a user
promise. Revisit it using measured median and p95 request costs before
advertising a fixed quota.

Grant and spend counters are tracked independently for the Google account and
browser installation. An account's first installation becomes its immutable
free-grant source, and a newly observed account receives no more than that
source installation's remaining free value at first link. Available free value
is always the lowest of the account, current installation, and source
installation remainders. Every reservation and successful charge applies to all
three, counting the installation only once when current and source are the same.
Consequently, several accounts linked before the first request still share one
source pool after they move to other installations; pre-linking accounts cannot
clone the grant. Signing into a new Google account in an exhausted browser
installation gives that account a permanent zero grant. Using an exhausted
account in a new browser installation does not create another account grant
either. Accounts that genuinely share one browser profile also share this
restriction; support needs a manual, auditable adjustment path for false
positives.

All grant, reservation, and charge decisions are transactional in SQLite. The
service obtains the request's input size from OpenAI's input-token endpoint,
reserves its exact catalogued input cost plus an affordable output allowance,
and sends that allowance as `max_output_tokens`. It then reconciles against the
provider-reported usage. Failures known to occur before the provider call and
explicit provider 4xx rejections release the reservation; a timeout, transport
failure, or ambiguous server result after provider dispatch retains it in
`needs_reconciliation` for an operator instead of risking free spend. The same
opaque internal request ID is stored with the reservation and sent as OpenAI
request metadata so an operator can correlate the two sides without sending an
account, email address, device cookie, or prompt in that metadata. The
append-only usage ledger is the audit trail, and account and installation
counters are updated in the same transaction.

This control raises the cost of casual abuse but cannot guarantee one grant per
human or physical device. Stronger signals such as coarse IP velocity, CAPTCHA,
account age/risk, and manual review may be added later, subject to a documented
privacy and retention decision.

## AI Credits and provider-cost accounting

An **AI Credit** is a provider-cost unit, not one model token:

```text
1 AI Credit = USD 0.001 of catalogued provider cost
1 USD       = 1,000,000,000 nanoUSD
1 AI Credit = 1,000,000 nanoUSD
```

Balances, reservations, charges, and price calculations use integers in nanoUSD;
floating-point currency arithmetic is not allowed. The UI may display the
nanoUSD balance as AI Credits, but the integer ledger remains authoritative.

The current provisional `gpt-5.6-terra` catalog is:

| Usage category | Standard, up to 272,000 input tokens | Long context, over 272,000 input tokens |
| --- | ---: | ---: |
| Input | 2,000 | 4,000 |
| Cached input | 200 | 400 |
| Cache write | 2,500 | 5,000 |
| Output | 12,000 | 18,000 |

At the standard tier, the catalogued cost is:

```text
input tokens       * 2,000
+ cached tokens    *   200
+ cache-write      * 2,500
+ output tokens    * 12,000
= provider-cost nanoUSD
```

The standard tier applies when `inputTokens` is at most 272,000. If it is
greater than 272,000, the long-context rates apply to the entire response. The
ledger records the selected tier as well as the catalog version.

Every ledger entry records the model and immutable price-catalog version used
for the calculation. `AI_PRICE_CATALOG_VERSION=2026-08-24` selects the current
catalog. A pricing change creates a new version; historical entries are never
recalculated. Provider invoices remain the final reconciliation source because
API usage fields and prices can change.

## Proposed 2:1:1 token fund

If paid access is introduced, split **net receipts** into four equal shares:

- two shares (50%) fund the buyer's paid AI balance;
- one share (25%) funds free-access usage;
- one share (25%) is Uart Debug's gross contribution for operation and development.

For example, USD 10.00 of net receipts creates up to 5,000 paid AI Credits,
allocates USD 2.50 to the free-access reserve, and allocates USD 2.50 to Uart
Debug. “Net receipts” means money actually settled after indirect tax,
payment-platform fees, refunds, disputes, and chargebacks. It is not the checkout
headline price.

This ratio should be stored as a versioned commercial policy, not embedded in
usage code. Purchased credits and promotional/free credits need separate ledger
buckets so refunds, expiry rules, and financial reporting do not silently mix
them. The service should spend promotional value first only if the published
terms explicitly say so.

Paid purchases are intentionally deferred. Do not accept money or promise a
cash-equivalent balance until the payment provider, merchant of record, tax and
currency handling, refund/chargeback policy, credit expiry, regional eligibility,
consumer terms, privacy notice, and accounting treatment have been decided and
reviewed. AI Credits must not be transferable, withdrawable, or represented as
cryptocurrency.

## Stored data and operational controls

The access database belongs at
`/var/lib/uartdebug-ai/data/ai-access.sqlite`, outside versioned releases. It may
contain HMAC-derived Google account IDs, masked account display metadata,
installation HMACs, sessions, grants, reservations, and ledger rows.
It must not contain the Google client secret, Google tokens that are no longer
needed, raw installation tokens, or the OpenAI API key.

The systemd service grants write access only to the draft and data directories.
OAuth credentials and the identity/session secrets are root-owned systemd
credentials. Database backups are sensitive and need the same access controls,
retention rules, encryption, and restore tests as the live database.

See [`PRODUCT_LIMITATIONS.md`](PRODUCT_LIMITATIONS.md) for guarantees this design
cannot provide and decisions that still block paid access.

## Primary references

- [Google OAuth 2.0 for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google ID-token verification](https://developers.google.com/identity/sign-in/web/backend-auth)
- [OpenAI Responses input-token counting](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens)
- [OpenAI GPT-5.6 Terra model and pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
