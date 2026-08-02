# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 3.x     | ✅         |
| < 3.0   | ❌         |

Dispatch is under active development on the 3.x line. Security fixes are applied to the latest
3.x release.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Public disclosure
before a fix is available puts every deployment at risk.

Instead, report privately via **GitHub's [private security advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)**
for this repository (Security → Advisories → *Report a vulnerability*). This keeps the report
confidential between you and the maintainers until a fix ships.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a proof-of-concept if possible).
- Affected version/commit and configuration.

## Response expectations

- **Acknowledgement:** within 5 business days of your report.
- **Assessment & fix plan:** we will confirm the issue, determine severity, and share a
  remediation timeline.
- **Disclosure:** we coordinate a disclosure date with you and credit you (if you wish) once a
  fix is released.

## Scope & hardening notes

- Secrets (SMTP/provider keys, OAuth tokens, webhook secrets) are encrypted at rest and never
  returned to the browser. Data access is tenant-scoped and server-derived.
- Outbound webhook delivery is guarded against SSRF (private/reserved/metadata ranges are blocked,
  the resolved public IP is pinned for `http`, and redirects are not followed). For defense in
  depth, firewall the API/worker container egress — see the "Network egress hardening" section of
  [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).
- CI runs automated security checks: **gitleaks** (secret scanning, required), **CodeQL** (static
  analysis), and a dependency **CVE audit** (`bun audit`). These complement, but do not replace,
  responsible disclosure.
