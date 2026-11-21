# Security Policy

[Back to README.md](README.md) • [Back to MAINTAINERS.md](MAINTAINERS.md)

## Supported versions

This project is pre-1.0 (`0.y.z`): only the latest published version of
each package (`raiminiscence-mcp`, `raiminiscence-hooks`, `raiminiscence-cli`,
`raiminiscence-argv`) is supported. There is no backport policy for older
0.y.z releases — upgrade to the latest version before reporting an issue.

## Reporting a vulnerability

Do not open a public GitHub issue for a security vulnerability.

Use GitHub's private vulnerability reporting instead: on this repository,
go to the **Security** tab → **Report a vulnerability**. This opens a
private advisory visible only to the maintainer and you, and lets us
coordinate a fix before any public disclosure.

If you cannot use that flow, open a regular issue asking the maintainer to
set up an alternative private contact — do not include vulnerability
details in that issue.

Include, where applicable:

- The affected package and version.
- Steps to reproduce, or a minimal repro case.
- The impact you'd expect (e.g. what data or behaviour is exposed).

## What to expect

This is a small, maintainer-run project — response times are best-effort,
not SLA-backed. A credible report will get an acknowledgment, an
assessment of severity, and a fix or mitigation released as a PATCH
version once confirmed. Coordinated disclosure is preferred: please hold
public details until a fix is out.

## Scope

In scope: the code in `packages/*` and the published npm packages built
from it.

Out of scope: vulnerabilities in third-party dependencies that don't
involve this project's own code — report those upstream instead, though
we're happy to hear about ones that affect us so we can bump the
dependency.
