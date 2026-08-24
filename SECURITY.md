# Security Policy

## Supported version

Security fixes target the current `main` branch and the production version deployed from it. Older releases are not maintained as separate supported versions.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, pull request, or serial log.

Use GitHub's private vulnerability reporting feature when it is enabled for this repository. Otherwise email [uartdebug@gmail.com](mailto:uartdebug@gmail.com) with the subject `Uart Debug security report`.

Include, when possible:

- the affected page, endpoint, file, or commit;
- a minimal reproduction;
- the security impact;
- browser, operating-system, hardware, and network details that matter;
- any suggested mitigation.

Do not include live credentials or unnecessary personal data. If a credential may have been exposed, revoke or rotate it before sending the report.

The maintainer will acknowledge a usable report when possible, investigate it, and coordinate a fix and disclosure timeline based on severity. Please allow reasonable time for remediation before publishing details.

## Scope notes

Particularly sensitive areas include:

- Web Serial permission and device-selection flows;
- UPDI write, erase, and flash operations;
- compiler input validation and temporary files;
- same-origin API boundaries;
- AI prompt/context handling, generated drafts, and server credentials;
- GitHub Actions and production deployment credentials.

Reports that require destructive testing against third-party devices or infrastructure are out of scope. Test only systems and hardware you own or are explicitly authorized to assess.
