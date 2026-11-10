# AGENTS.md — nelm-ts-chart-sdk

## Project Overview

TypeScript SDK for generating Kubernetes manifests with TypeScript instead of Helm templates.
Published as `@nelm/chart-ts-sdk`. Users import types (`RenderContext`, `RenderResult`, etc.)
and the `render` helper to build chart renderers that run under Node.js.
The `nelm-chart-ts dev` CLI renders a chart locally without Nelm.

**Runtime**: Node.js — uses `process.argv` and `node:fs/promises`. Nelm runs the bundle with Node.js 26.12.1 or newer under `--permission`.
**Module system**: ESM only (`"type": "module"`).
**4 source files total.** Small, focused SDK.

## Build & Development Commands

```bash
npm run build          # tsup (config in tsup.config.ts)
npm test               # build + node --test 'test/*.test.mjs'
npx tsc --noEmit       # Type-check only (no emit)

# No linter or formatter configured.
# No dev/watch scripts.
```

Build output: `dist/index.js` (ESM bundle) + `dist/index.d.ts` (declarations) + `dist/cli.js` (the `nelm-chart-ts` bin).
Built automatically on `prepublishOnly` and `prepack`.

## Project Structure

```
src/
├── index.ts              # Barrel re-exports from types/ and utils/
├── cli.ts                # nelm-chart-ts CLI (not exported from the barrel)
├── types/
│   └── index.ts          # All interfaces and type aliases
└── utils/
    └── index.ts          # render() — file I/O, YAML parse/serialize, handler invocation
test/                     # node --test suites against dist/
```

`dist/` and `node_modules/` are gitignored.

## TypeScript Configuration

- `target`: ESNext, `module`: ESNext, `moduleResolution`: Bundler
- `strict`: true (all strict checks enabled)
- `allowJs`: false, `skipLibCheck`: true, `resolveJsonModule`: true
- `esModuleInterop`: true
- `rootDir`: ./src, `outDir`: ./dist

## Code Style & Conventions

### Imports

- **Named imports only** — no default imports, no namespace imports.
- **Relative paths** for internal modules: `'../types'` (no path aliases).
- **`node:` prefix** for Node.js built-ins: `"node:util"`.
- Prefer single quotes. Prefer semicolons.

```typescript
// Correct
import {RenderHandler, RenderContext} from '../types';
import {parseArgs} from "node:util";
import {load, dump} from "js-yaml";

// Wrong
import * as types from '../types';
import RenderContext from '../types';
```

### Module Organization

- Barrel exports via `index.ts` in each directory.
- Root `src/index.ts` re-exports everything: `export * from './types/index'`.
- All public types/functions MUST flow through the barrel chain.
- New modules: create directory with `index.ts`, add `export *` in parent barrel.

### Interfaces & Types

- **PascalCase** for interface/type names: `RenderContext`, `ChartMetadata`.
- **No `I` prefix** — `Release`, not `IRelease`.
- **PascalCase properties** for Helm/K8s-compatible structures — mirrors Go's exported fields.
- **camelCase properties** for SDK-internal structures: `manifests` in `RenderResult`.
- **`export interface`** — always exported.
- **`export type`** for aliases: `export type RenderHandler = ...`.

```typescript
// Helm-compatible — PascalCase properties
export interface Release {
    Name: string;
    Namespace: string;
    IsInstall: boolean;
    IsUpgrade: boolean;
}

// SDK-internal — camelCase properties
export interface RenderResult {
    manifests: object[] | null;
}
```

### Functions

- `export const` + arrow for async functions: `export const runRender = async (...) => { }`.
- `export function` for synchronous helpers.
- `$` is the conventional parameter name for `RenderContext`.
- Explicit return types on exported functions.

### Null Handling

- `| null` in types (not `| undefined`): `manifests: object[] | null`.
- Nullish coalescing `??` for defaults: `$.Values.replicaCount ?? 1`.
- Optional chaining `?.` for nested access: `$.Values.image?.repository`.

### Error Handling

- No custom error classes. Errors thrown directly via `new Error(...)`.
- No try/catch in SDK — errors propagate to the Node.js runtime.
- `runRender` validates handler output: throws if `manifests` is not an array.

### Naming Conventions

| Element              | Convention  | Example                              |
|----------------------|-------------|--------------------------------------|
| Interfaces/Types     | PascalCase  | `RenderContext`, `RenderResult`      |
| Helm-compat fields   | PascalCase  | `Release.Name`, `Chart.Version`      |
| SDK-internal fields  | camelCase   | `manifests`                          |
| Functions            | camelCase   | `runRender`, `fullname`              |
| Variables/params     | camelCase   | `handler`, `ctx`                     |
| RenderContext param  | `$`         | `function labels($: RenderContext)`  |
| Directories          | lowercase   | `types/`, `utils/`                   |

### Async Patterns

- async/await preferred over raw Promises.
- `RenderHandler` supports both sync and async return.

## Runtime Behavior

`runRender` reads YAML input from a file and writes YAML output to a file:

1. Parses `--input-file` and `--output-file` from `process.argv`
2. Reads input file → deserializes YAML → `RenderContext`
3. Calls handler, validates that `manifests` is an array
4. Serializes manifests to multi-document YAML (joined by `---\n`)
5. Writes to output file, or prints to stdout without `--output-file`

```
node bundle.js --input-file context.yaml --output-file manifests.yaml
```

Do NOT change the file-based I/O contract — it is the IPC mechanism with the Nelm runtime.
The esbuild options and the `node --permission` invocation in `src/cli.ts` must match Nelm's.

## Dependencies

- **Runtime**: `js-yaml` 5 — YAML parse/serialize; `esbuild` (exact version, matches Nelm's Go esbuild) — CLI bundling
- **Dev**: `typescript`, `tsup`, `@types/node`

Keep runtime dependencies minimal. Do not add new ones without explicit approval.

## Adding New Code

1. Create types in `src/types/index.ts` (or a new file re-exported from it).
2. Create utilities in `src/utils/index.ts` (or a new file re-exported from it).
3. Ensure new exports flow through the barrel chain to `src/index.ts`.
4. Run `npx tsc --noEmit` to type-check.
5. Run `npm run build` to verify the bundle.

## Key Gotchas

- **Sandboxed runtime**: The bundle runs under `node --permission` with an empty environment: only the input file is readable, only the output file is writable, no network.
- **`node:` specifiers**: Keep them in `dist/` (`removeNodeProtocol: false`) — they are the only external imports allowed in a chart bundle.
- **No linter/formatter**: Follow conventions in this doc.
- **PascalCase properties**: Helm-compatible interfaces use Go-style naming. Do not "fix" to camelCase.
