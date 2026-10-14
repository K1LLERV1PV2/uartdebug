# Private AI materials deployment

Sergey-Bulanov/UartDebug2 is the source of truth. Its main-branch action "Sync AI materials to UARTDebug" exports every tracked Git blob with unchanged paths and content. Export-ignore and substitution attributes are disabled for this export. The website repository contains adapters and tests, not a duplicate knowledge base.

## Server layout

/var/lib/uartdebug-ai/materials contains:

- releases/<git-sha>/repository: the unchanged tracked repository tree.
- releases/<git-sha>/manifest.json: identity and each file's SHA-256/byte count.
- current: an atomic symlink to the active release.
- activation.json: the latest accepted deployment run.
- install.lock: process coordination.
- uploads: temporary authenticated archives.

Tracked Notes and temporary artifacts are mirrored but excluded from automatic AI reading. Protected Problems.md and unrelated target projects are also excluded. Derived project catalogs and search indexes are outside the source mirror.

## Automatic updates

Push to UartDebug2 main or run its action manually. No SSH key or permanent GitHub token is required. The action obtains a short-lived GitHub OIDC identity for https://uartdebug.com/api/internal/materials/sync and posts its Git archive.

The receiver verifies GitHub's RSA signature, issuer, audience, immutable repository/owner IDs, private visibility, main branch, workflow reference and SHA, event, runner and expiry. It checks archive SHA-256 and authenticated commit, rejects unsafe paths, links, duplicates and incomplete rules, then invokes the backend materials validator. Repository scripts are never executed.

Installation is serialized across processes and changes current atomically. A watermark outside immutable manifests rejects late workflows, including after a previously installed commit is reactivated. Failed validation retains the active release. Existing AI calls keep their pinned root; later calls use the new release without restart.

## Initial setup

Run backend/deploy/install-materials-sync.sh as root. It installs the dedicated user/unit and nginx route, with a backup and rollback trap preserving previous configuration and service state on failure.

Bootstrap a reviewed archive as the receiver user:

    sudo -u uartmaterials -g uartai python3 /var/www/uartdebug/backend/deploy/install-materials.py --archive /tmp/materials.tar.gz --root /var/lib/uartdebug-ai/materials --commit <full-sha> --validator /var/www/uartdebug/backend/deploy/verify-materials.js

The AI service can read materials but cannot modify them. The receiver cannot read AI credentials or account storage. The private mirror is not a public website directory.

For a local development snapshot, export git archive --format=tar.gz and use --no-activate. This returns a root suitable for AI_MATERIALS_ROOT and avoids Linux release symlinks on Windows PCs.

## Maintenance

Keep previous immutable releases for recovery. Modify UartDebug2 instead of installed files. Website deployment never overwrites this tree or user projects, account balances, sessions or credentials. The active materials commit is available in AI status and the adjacent manifest.

References: [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
