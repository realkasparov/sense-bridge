# Contributing to the SenseBridge connector

This repository is Apache-2.0. The browser extension it serves lives elsewhere and is
proprietary and closed to contributions; issues about the extension belong there, not
here.

Issues and pull requests are welcome.

## Contributor License Agreement

Before a pull request can be merged, its author must sign the [CLA](CLA.md).

Why: the maintainer may later offer this under different terms, which is only possible
while holding the rights to the whole of it. The CLA does not take your copyright away —
you keep it, and grant a licence alongside it.

If that is not acceptable to you, open an issue describing the change instead. A described
bug or design flaw is genuinely useful and carries no paperwork.

## Ground rules

- The model is used for **wording translations only**. Language detection, DOM
  segmentation, validation, insertion, caching and glossary handling are code. If a
  behaviour can be guaranteed by a test, it must not be requested in a prompt.
- Page content is untrusted input at every layer. Never insert model output with
  `innerHTML`; never widen the CLI's tool surface.
- New provider support belongs in an adapter, not in the bridge.
- The connector never reads credentials. Not the environment, not a provider's config
  file, not to "check whether the user is signed in". The CLI authenticates on its own.
