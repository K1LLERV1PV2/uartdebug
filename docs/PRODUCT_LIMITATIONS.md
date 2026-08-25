# Product limitations and deferred decisions

This file records boundaries that code cannot honestly remove today. It should
be updated when a limitation is mitigated or a deferred decision is made.

## Device uniqueness

Uart Debug cannot reliably identify a physical device from a normal web page.
The planned identifier represents one browser installation and is best effort.
It can change when a visitor clears cookies/site data, uses private browsing,
changes browser or profile, restores a backup, blocks storage, or deliberately
modifies the client. Multiple people can also share one installation, while one
person can create several installations.

A client-computed “unique hardware hash” does not solve this: browsers do not
expose a stable hardware identifier, fingerprint inputs change, and collecting
more entropy increases privacy and regulatory risk. The system therefore cannot
guarantee one free grant per person or physical machine. It can only enforce one
grant per observed Google account and a shared pool rooted in the account's
first observed browser installation, then add proportionate abuse signals
later.

## Google identity

Google sign-in proves control of a Google account at that moment. It does not
prove a person's legal identity, that one person has only one account, account
age or trustworthiness, or that the account will remain available. Email must
not be used as the durable identity key; Google's verified `sub` claim is.

Required Google sign-in must remain disabled until production OAuth credentials,
the exact callback, consent-screen status, user-facing failure/recovery states,
and the public privacy information have been verified. Losing the persistent
session or identity secrets invalidates sessions or breaks installation matching,
so they must be backed up securely and rotated only with a migration plan.

## Quotas and provider cost

Token estimates made before a model response are not exact. The service can
reserve a conservative amount and reconcile against provider-reported usage,
but billing reports may arrive later or use categories that evolve. Network
failure can also leave an ambiguous request outcome. Reconciliation and an
auditable ledger are required; a displayed balance is not sufficient evidence.

The provisional free grant, price catalog, and 2:1:1 allocation are changeable
product policies, not permanent guarantees. Model availability and provider
pricing can change independently of a deployed release.

The current access foundation reserves catalogued input cost and an affordable
output allowance before calling the provider. That prevents ordinary concurrent
requests from overspending a balance. It still cannot prove the provider did
not bill an ambiguous network request: such reservations deliberately remain in
`needs_reconciliation` until an operator compares them with provider records.
Provider-side price or usage changes can also require a new catalog and manual
reconciliation; the local balance is not a substitute for the provider invoice.
The database preserves ambiguous reservations and a provider-correlatable
request ID, but a supported operator reconciliation/appeal tool is still
deferred. Required Google access must not be enabled for a broad audience until
that workflow exists and is tested.

## Paid access

Paid subscriptions and credit purchases are not ready to launch. Open questions
include the payment provider or merchant of record, supported countries and
currencies, VAT/sales-tax handling, invoices, refunds, chargebacks, fraud,
minor eligibility, credit expiry, service interruption, account deletion,
provider price changes, and the legal/accounting classification of prepaid
credits. These decisions require appropriate legal and tax review.

Until they are resolved, the repository may contain accounting primitives and
versioned pricing, but it must not expose a checkout, accept payment, promise a
cash value, or describe AI Credits as transferable or withdrawable.

## Privacy and retention

Account identifiers, installation HMACs, IP/risk signals, sessions, and usage
ledgers can be personal data even when they are pseudonymous. Before mandatory
sign-in or payments are enabled, Uart Debug needs a public privacy notice with
controller/contact details, purposes and legal bases, processors, retention
periods, user rights, international-transfer information where applicable, and
an account/data-deletion process. Retention must be implemented, not merely
described.

OAuth, OpenAI, hosting, logging, backups, and any future payment provider add
separate data flows. Their production configuration and contracts cannot be
derived or guaranteed by application code alone.

## Operational boundaries

- Browser cookies can be blocked, deleted, copied, or replayed; session and
  installation tokens reduce casual abuse but are not hardware attestation.
- SQLite is appropriate for the current single-host deployment, but multi-host
  writes require a database/coordination migration rather than shared-file use.
- The built-in `node:sqlite` API is still marked experimental in Node.js 22;
  pin the supported Node range and test database migrations on every runtime
  upgrade.
- Backups do not guarantee recovery until encrypted storage, retention, and
  restore procedures have been tested.
- The OAuth-start endpoint has a bounded in-memory per-IP/global burst guard.
  Distributed rate limits, CAPTCHA, and risk scoring remain deferred; none
  proves uniqueness.
- Automated account blocks need support and an auditable appeal/override path
  because shared devices and network addresses create false positives.
