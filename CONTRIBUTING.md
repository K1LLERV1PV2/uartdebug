# Contributing to Uart Debug

Thank you for helping improve Uart Debug. Keep changes focused, explain the user-facing reason for them, and avoid mixing unrelated cleanup into a pull request.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues and pull requests.
- Open an issue before a large feature or architecture change so the scope can be agreed first.
- Never commit API keys, SSH keys, tokens, serial logs containing sensitive data, or production configuration values.
- Use a browser with Web Serial for hardware tests. Never run write/erase operations against hardware you do not own or have permission to modify.

## Development setup

Install Node.js 22.13 or newer, npm, Python 3, and Git. Then run:

```sh
npm ci --prefix backend
npm test --prefix backend
python -m http.server 8000 --directory public
```

Open `http://localhost:8000`. The static server covers browser-only behavior. Compiler work also requires Microchip XC8, the matching ATtiny DFP, and `avr-objcopy`. AI work requires a local server-side key and the setup described in [`backend/AI-SETUP.md`](backend/AI-SETUP.md).

## Code and UI changes

- Preserve the existing visual language unless the change explicitly redesigns a component.
- Keep Web Serial and hardware failures recoverable and understandable to the user.
- Do not expose backend credentials, AI rules, internal filesystem paths, or raw compiler paths in browser responses.
- Add or update tests for behavior changes.
- Check desktop layout, constrained widths, keyboard use, and the browser console for frontend changes.
- Update service-worker assets or its build identifier when a new public runtime file must be available offline.

## Adding an AVR mini-project

Generated projects use C, localized Markdown and YAML resource specifications. Built-in tutorials retain their existing source/guide catalogs and historical AI notes for traceability.

1. Add readable C and localized guides under `public/avr-mini-projects/<project-id>/`.
2. Keep every `//#` heading synchronized with its guide heading and keep versions aligned.
3. Put card copy under `## Short Project Description` in the default guide.
4. Add public assets to `public/avr-mini-projects/catalog.json` and `public/sw.js`.
5. Extract reusable mechanisms into the versioned backend knowledge recipes. Cite exact official HTML/DFP versions, resource constraints, and the tutorial source digest. Do not add a second private generated-project specification.
6. Add meaningful resource/calculation regressions and compile representative compositions with the supported XC8/DFP toolchain. Record compiler success separately from physical hardware testing.
7. Rebuild the knowledge manifest after intentional source changes and run the full test suite. See [AVR_CANVAS.md](docs/AVR_CANVAS.md).

Do not add secrets or user data. Images need suitable redistribution rights. Preserve legacy tutorial AI files when updating their corresponding tutorial; their catalog hashes are checked by tests.

## Tests and checks

Run before opening a pull request:

```sh
npm test --prefix backend
node --check backend/compile-server.js
node --check backend/ai-server.js
node --check backend/ai-access-service.js
node --check backend/avr-ai-service.js
node --check public/AVR-Programming.js
node --check public/uart.js
git diff --check
```

On a Unix-like shell, also validate deploy scripts with `bash -n backend/deploy/*.sh`.

## Pull requests

Include:

- what changed and why;
- how it was tested;
- screenshots for visible UI changes;
- hardware and browser details when the change affects Web Serial, UART, or UPDI;
- deployment or compatibility notes when backend behavior changes.

By submitting a contribution, you confirm that you have the right to submit it and agree that it will be licensed under the repository's [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).
