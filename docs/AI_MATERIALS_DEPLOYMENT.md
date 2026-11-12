# Private AI materials deployment

Sergey-Bulanov/UartDebug3 supplies the project rules and AVR references. The materials sync workflow exports every tracked Git blob with unchanged paths and content. Export-ignore and substitution attributes are disabled for this export. The private mirror, its manifest, and its prepared catalog live outside the public website directory.

## Server layout

/var/lib/uartdebug-ai/materials contains:

- releases/<git-sha>/repository: the unchanged tracked repository tree.
- releases/<git-sha>/manifest.json: identity and each file's SHA-256/byte count.
- releases/<git-sha>/project-catalog.json: prepared uniform projects, bound to the exact source manifest and commit.
- current: an atomic symlink to the active release.
- activation.json: the latest accepted deployment run.
- install.lock: process coordination.
- uploads: temporary authenticated archives.

The mirror includes `Index/Knowledge.sqlite` as supplied by UartDebug3. The backend opens it read-only and verifies its indexed input hashes against the pinned manifest. AI lookup follows indexed references and reads the ordered project rules. Notes, problem ledgers, source scripts, and ordinary target projects are outside its lookup. The website catalog is empty for UartDebug3 revisions without reviewed website templates. App-note examples remain technical references.

## Automatic updates

Install `.github/workflows/sync-ai-materials.yml` on UartDebug3 main to enable automatic updates. A push to main or manual dispatch obtains a short-lived GitHub OIDC identity for https://uartdebug.com/api/internal/materials/sync and posts its Git archive. The receiver accepts the UartDebug3 repository identity.

The receiver verifies GitHub's RSA signature, issuer, audience, immutable repository/owner IDs, private visibility, main branch, workflow reference and SHA, event, runner and expiry. It checks archive SHA-256 and authenticated commit, rejects unsafe paths, links, duplicates and incomplete rules, then invokes the backend materials validator. Repository scripts are never executed.

Before activation, the installer runs `verify-materials.js <repository> --prepare-catalog` under the materials receiver identity. It validates the materials and writes the website catalog atomically beside the mirror, bound to the exact manifest and commit. An empty catalog is valid. The AI service reads the prepared artifact.

Installation is serialized across processes and changes current atomically. A watermark outside immutable manifests rejects late workflows, including after a previously installed commit is reactivated. Failed validation retains the active release. Existing AI calls keep their pinned root; later calls use the new release without restart.

## Initial setup

Run backend/deploy/install-materials-sync.sh as root. It installs the dedicated user/unit and nginx route, with a backup and rollback trap preserving previous configuration and service state on failure.

Bootstrap a reviewed archive as the receiver user:

    sudo -u uartmaterials -g uartai python3 /var/www/uartdebug/backend/deploy/install-materials.py --archive /tmp/materials.tar.gz --root /var/lib/uartdebug-ai/materials --commit <full-sha> --validator /var/www/uartdebug/backend/deploy/verify-materials.js

The AI service can read materials but cannot modify them. The receiver cannot read AI credentials or account storage. The private mirror is not a public website directory.

For a local development snapshot, export `git archive --format=tar.gz` and use `--no-activate`. This returns a root suitable for `AI_MATERIALS_ROOT` on Windows PCs. Use `--repository Sergey-Bulanov/UartDebug2` only to prepare a reviewed legacy archive.

## Maintenance

Keep previous immutable releases for recovery. Make materials updates in UartDebug3. Website preflight prepares the catalog as `uartmaterials -g uartai` and verifies read access as `uartai` before switching backend release pointers. The backend can read a pinned UartDebug2 release during the transition until the UartDebug3 archive has passed validation and activation. The active repository and commit are available in AI status and the adjacent manifest.

Before rolling back to a website release that only understands UartDebug2, reactivate the exact previous materials archive with `--repository Sergey-Bulanov/UartDebug2` and verify its commit in AI status. Coordinate the receiver and website rollback so a concurrent materials workflow cannot switch the pointer between those steps.

References: [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
