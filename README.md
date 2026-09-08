# sense-bridge

The native messaging companion for the [SenseBridge](https://sense-bridge.com) browser
extension.

A browser extension cannot start a program on your computer — that boundary is the entire
reason this exists. Chrome talks to this over native messaging; it runs the Claude Code CLI
already installed and signed in on your machine, and sends the answer back.

## Install

Not published to npm yet. Until it is, install from this repository:

```bash
git clone https://github.com/realkasparov/sense-bridge.git
cd sense-bridge
npm install && npm run build
./install/install.sh
```

Once published, that becomes:

```bash
npx sense-bridge install
```

Either way, then quit Chrome completely (⌘Q) and reopen it: host manifests are read only at
startup. This is the single most common reason a fresh install appears not to work.

## Commands

```
sense-bridge install [extension-id]   register the host with Chrome
sense-bridge uninstall                remove it again
sense-bridge doctor                   report what is and is not in place
sense-bridge --version
```

`doctor` answers the questions worth asking when it does not work: whether the connector and
its manifest are in place, whether the CLI is installed, whether macOS has quarantined it, and
whether Chrome is still running from before the install.

## Requirements

macOS, Node 24 or newer, and the Claude Code CLI installed and signed in.

## What it does

Reads length-prefixed JSON on stdin, runs one CLI process per request against a small pool
kept warm, and writes the answer back the same way. Requests are stateless: a process serves
one request and is discarded, which is what keeps the cost of a long page linear rather than
growing with every batch.

It never reads or stores credentials. The CLI authenticates on its own.

## Development

```bash
npm install
npm test        # builds first; no network, no tokens spent
./install/install.sh    # register this build with Chrome
```

The suite runs against a fake CLI, so it is free and offline. `npm run test:smoke` makes one
real request and costs tokens.

Contributions are welcome under a CLA — see [CONTRIBUTING.md](CONTRIBUTING.md).

## The other half

The browser extension is a separate program under its own terms, and is not open source.
Its repository is private and has no public issue tracker, so until there is somewhere
better, report problems with the extension **here** as well — they will be passed on. Say
which half you mean and the triage costs nobody anything.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
