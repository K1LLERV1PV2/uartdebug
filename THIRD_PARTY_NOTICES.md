# Third-party notices

Uart Debug vendors browser dependencies so the UART and AVR pages can load without a runtime package CDN.

| Component | Version | Vendored path | Upstream | License |
| --- | --- | --- | --- | --- |
| Chart.js | 4.4.0 | `public/vendor/chart.umd.js` | [chartjs/Chart.js](https://github.com/chartjs/Chart.js/tree/v4.4.0) | [MIT](LICENSES/Chart.js.txt) |
| CodeMirror | 5.65.16 | `public/vendor/codemirror/5.65.16/` | [codemirror/codemirror5](https://github.com/codemirror/codemirror5/tree/5.65.16) | [MIT](LICENSES/CodeMirror.txt) |
| UartDebugMarkdown runtime | 1.0.0 | `public/vendor/uartdebug-markdown.js` | [`frontend/markdown-runtime/package.json`](frontend/markdown-runtime/package.json) | [Bundled MIT licenses](LICENSES/UartDebugMarkdownRuntime.txt) |

The license copies linked above continue to govern those third-party components. Uart Debug's `AGPL-3.0-only` project license does not replace or alter their terms.
The UartDebugMarkdown license aggregate is also deployed beside its bundle as
`public/vendor/uartdebug-markdown.LICENSE.txt`.

The vendored CodeMirror Markdown mode includes a local linear-time HTML-tag
lookahead hardening patch. CodeMirror remains governed by its upstream MIT
license.

The Google "Sign in with Google" SVG in
`public/icons/sign-in-with-google-light.svg` is an official Google branding
asset. Google trademarks and branding requirements apply to that asset; it is
not covered by Uart Debug's AGPL license. See Google's
[Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines).

The backend installs these direct runtime dependencies from npm; their own
licenses continue to apply to those packages and their transitive dependencies:

| Component | Version | Manifest | Upstream | License |
| --- | --- | --- | --- | --- |
| Express | 4.22.2 | `backend/package.json` | [expressjs/express](https://github.com/expressjs/express/tree/4.22.2) | MIT |
| Google Auth Library for Node.js | 11.0.2 | `backend/package.json` | [googleapis/google-auth-library-nodejs](https://github.com/googleapis/google-auth-library-nodejs/tree/v11.0.2) | Apache-2.0 |
