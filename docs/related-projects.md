# Related projects

## zero or NODD?

Use **zero** for features: work worth a spec, a plan, and a verdict. For small
daily work — a typo, a rename, a one-line fix — use
**[NODD](https://nodd.com.ar)** (`npm i @gonrocca/nodd`), a sibling pi
extension by the same author: it makes the agent declare a route before
writing and refuses to mark a task done until the tests were actually seen
running. They complement each other. When clarify sizes a `/forge` request as
`Size: small`, the run says so once and suggests NODD — it never blocks or
changes the route. The other way around, when NODD work outgrows it,
`/nodd-promote <slug>` hands it to zero and `/forge --continue <slug>` adopts
that handoff: no clarify, it starts at explore and keeps what NODD already did.

## Relationship to `zero`

zero-pi is the pi layer of the **zero** integrator. The `zero` CLI installs it
onto pi and writes the per-phase model config; you can also install zero-pi on
its own with the command in the README.

zero-pi is built in the same spirit as `gentle-pi`: pi stays untouched;
zero-pi is a package it loads.
