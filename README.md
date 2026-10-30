# pi-jev

pi-jev exposes typed TypeSafe System One judgments to any Pi extension or plain
Node program. The primary surface is the importable `evaluate` function: one typed
request becomes one HTTPS POST and one validated typed response. The same package
registers an optional `jev_evaluate` Pi tool. It contains no domain logic: no
rubrics, thresholds, aggregation, scoring policy or retry policy.

## Index

- [What This Is](#what-this-is)
- [What This Is Not](#what-this-is-not)
- [Core Conventions](#core-conventions)
- [Wire Contract](#wire-contract)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Errors](#errors)
- [Pi Extension](#pi-extension)
- [Current Limits](#current-limits)
- [What Not to Infer](#what-not-to-infer)
- [Development Commands](#development-commands)
- [Further Reading](#further-reading)

## What This Is

pi-jev provides:

- one `evaluate(request, opts)` call returning a validated `JevResponse`;
- `choice`, `noul` (probability) and `score` question types;
- strict request and response validation before a result is returned;
- a fixed HTTPS endpoint with redirects rejected;
- a distinct transient error for HTTP 429/529, without automatic retry;
- an optional Pi tool for model-initiated calls;
- a small core with types separated from runtime.

## What This Is Not

pi-jev is not a decision policy, an approval gate, a retry controller, a model
runtime or a text generator. It does not calibrate judgments, aggregate multiple
answers, or decide whether a result is safe to act on. It does not wrap or import
`pi-fabric`; the HTTPS client is implemented here.

## Core Conventions

- `TYPESAFE_API_KEY` is read from the environment unless the caller passes
  `apiKey`. The key is never logged, returned, or included in an error.
- The endpoint is fixed; redirected responses are rejected.
- Requests are bounded to 1-128 questions and 256 KiB. Responses over 1 MiB are
  rejected.
- Every requested question id must have one matching answer of the same type.
  Missing, unexpected or malformed answers reject the whole response; no partial
  answer is returned.
- HTTP 429 and 529 throw `JevTransientError` with the status. Nothing retries
  automatically; the caller decides whether and when to try again.
- Other HTTP failures expose only the status code. Response bodies and headers
  are never surfaced.
- Types live in `src/types.ts`; the client and validation live in
  `src/client.ts`.

## Wire Contract

| Item           | Value                                                |
| -------------- | ---------------------------------------------------- |
| Endpoint       | `POST https://api.typesafe.ai/v1/systemone`          |
| Auth           | `Authorization: Bearer <TYPESAFE_API_KEY>`           |
| Default model  | `jev-latest`                                         |
| Request        | `{ model, state, questions }`                        |
| Response       | `{ model, answers, usage? }`                         |
| Question types | `choice`, `noul`, `score`                            |
| Bounds         | 1-128 questions; request <=256 KiB; response <=1 MiB |

Model precedence is `opts.model`, then `request.model`, then `jev-latest`.

```ts
type Question =
	| { type: 'choice'; instructions: string; criteria: Record<string, string> }
	| { type: 'noul'; instructions: string }
	| { type: 'score'; instructions: string; criteria: string[] } // 2-10 levels

type Answer =
	| { type: 'choice'; choice: string; confidence?: number }
	| { type: 'noul'; noul: number } // probability in [0, 1]
	| { type: 'score'; score: number; confidence?: number }
```

## Installation

Load as a Pi package with `pi install .` from this directory (or
`pi install ./pi-jev` from its parent, or `pi install npm:pi-jev` once
published). Pi reads the extension path from the `pi` key in `package.json`.

For plain Node, install the package from a registry, tarball or local path. The
package entry is `dist/src/index.js`, produced by `npm run build`. Node 18 or
newer with a global `fetch` is required. The core client has no npm dependencies;
the extension entry uses the host-provided Pi packages.

## Quick Start

```ts
import { evaluate, JevTransientError } from 'pi-jev'

const response = await evaluate({
	state: { summary: 'The change passes its tests.' },
	questions: {
		ship: { type: 'noul', instructions: 'Does this change ship safely?' },
		route: {
			type: 'choice',
			instructions: 'Which route?',
			criteria: { fast: 'Fast', safe: 'Safe' }
		},
		risk: {
			type: 'score',
			instructions: 'Rate review risk',
			criteria: ['low', 'medium', 'high']
		}
	}
})

console.log(response.answers.ship) // { type: "noul", noul: 0.88 }
```

Set `TYPESAFE_API_KEY` before the call, or pass `apiKey` explicitly. Pass
`signal` to bound the request and `fetcher` to inject a transport in tests.
`evaluate` never logs the key or the response body.

## Errors

| Condition                   | Behavior                                         |
| --------------------------- | ------------------------------------------------ |
| Missing API key             | Error naming `TYPESAFE_API_KEY`                  |
| Invalid request             | Error before the network call                    |
| HTTP 429 or 529             | `JevTransientError` with `status`; no retry      |
| Other non-2xx status        | Error with the status code only                  |
| Missing or malformed answer | Error; no partial result                         |
| Network or fetch failure    | Generic error; the fetcher cause is not surfaced |
| Aborted signal              | Error reporting the request was aborted          |

## Pi Extension

`src/extension.ts` is a default-exported Pi extension. It registers the optional
`jev_evaluate` tool: the arguments are one `JevRequest` and the result is the
validated `JevResponse` as JSON text plus structured `details`. The tool uses
the environment key; only programmatic callers can pass an explicit key to
`evaluate`.

## Current Limits

- There is no built-in timeout. Pass an `AbortSignal` to bound a call.
- There are no retries, backoff, caching, streaming or multi-endpoint routing.
- Validation is structural, not semantic. Types, ranges, confidence bounds and
  choice membership are checked; calibration is not.
- Error response bodies are intentionally unavailable.
- The Pi tool cannot accept a per-call key; only `evaluate` can.
- The core is about 198 lines. Tests and release tooling are separate.

## What Not to Infer

- Do not infer that a judgment is calibrated or suitable for an approval or
  security policy.
- Do not infer that HTTP 200 proves the answer is semantically correct; only its
  structure was validated.
- Do not infer that a transient error was not billed.
- Do not infer that `response.model` equals the alias you requested; it is
  reported by the server.
- Do not infer that this package is a model runtime or a text generator.

## Development Commands

```sh
npm ci             # install from package-lock.json
npm run check      # typecheck src, tests and release scripts
npm test           # build and run unit tests (no network)
npm run test:live  # opt-in live noul call; requires TYPESAFE_API_KEY

bun run release patch          # local release
bun run release 0.1.0 --initial
bun run release minor --push   # explicit push
```

The release command requires a clean tree, runs `npm run check` and `npm test`,
bumps `patch`, `minor` or `major`, writes `CHANGELOG.md`, creates a
`chore(release): vX.Y.Z` commit and an annotated tag locally. Nothing is pushed
unless `--push` is present, and nothing is published to a registry.

## Further Reading

- `src/types.ts` - public wire types and options.
- `src/client.ts` - HTTPS client, validation and error behavior.
- `src/extension.ts` - Pi tool registration.
- `scripts/release.ts` - local release flow.
