# Third-party notices

Uart Debug vendors browser dependencies so the UART and AVR pages can load without a runtime package CDN.

| Component | Version | Vendored path | Upstream | License |
| --- | --- | --- | --- | --- |
| Chart.js | 4.4.0 | `public/vendor/chart.umd.js` | [chartjs/Chart.js](https://github.com/chartjs/Chart.js/tree/v4.4.0) | [MIT](LICENSES/Chart.js.txt) |
| CodeMirror | 5.65.16 | `public/vendor/codemirror/5.65.16/` | [codemirror/codemirror5](https://github.com/codemirror/codemirror5/tree/5.65.16) | [MIT](LICENSES/CodeMirror.txt) |

The license copies linked above continue to govern those third-party components. Uart Debug's `AGPL-3.0-only` project license does not replace or alter their terms.

The backend installs these direct runtime dependencies from npm; their own
licenses continue to apply to those packages and their transitive dependencies:

| Component | Version | Manifest | Upstream | License |
| --- | --- | --- | --- | --- |
| Express | 4.22.2 | `backend/package.json` | [expressjs/express](https://github.com/expressjs/express/tree/4.22.2) | MIT |
| Google Auth Library for Node.js | 11.0.2 | `backend/package.json` | [googleapis/google-auth-library-nodejs](https://github.com/googleapis/google-auth-library-nodejs/tree/v11.0.2) | Apache-2.0 |
