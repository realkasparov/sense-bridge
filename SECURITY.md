# Security

## Reporting

Report a vulnerability through [GitHub's private advisory
form](https://github.com/realkasparov/sense-bridge/security/advisories/new), not a public
issue.

## What this program is trusted with

It is spawned by Chrome, reads length-prefixed JSON on stdin, and runs a provider CLI. Two
properties matter and are worth reporting if they are ever untrue:

- **It never reads credentials.** Not `ANTHROPIC_API_KEY`, not a provider's config file,
  not to report login state. The CLI authenticates itself; this program never sees a token.
- **Page text is untrusted input.** It reaches the CLI as data and never as instructions,
  and the CLI is spawned with no tools at all. A page that carries text reading as a
  command must not be able to make anything happen.
