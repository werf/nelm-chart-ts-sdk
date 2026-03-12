# AGENTS.md — nelm-ts-chart-sdk

## Project Overview

TypeScript SDK for generating Kubernetes manifests with TypeScript instead of Helm templates.
Published as `@nelm/chart-ts-sdk`. Users import types (`RenderContext`, `RenderResult`, etc.)
and the `runRender` helper to build chart renderers that run under Deno.

**Runtime**: Deno — uses `Deno.args`, `Deno.readTextFile`, `Deno.writeTextFile`.
**Module system**: ESM only (`"type": "module"`).
**3 source files total.** Small, focused SDK.

## Build & Development Commands

```bash
npm run build          # tsup src/index.ts --format esm --dts
npx tsc --noEmit       # Type-check only (no emit)

# No linter, formatter, or test framework configured.
# No dev/watch scripts.
```

Build output: `dist/index.js` (ESM bundle) + `dist/index.d.ts` (declarations).
Built automatically on `prepublishOnly` and `prepack`.

## Project Structure

```
src/
├── index.ts              # Barrel re-exports from types/ and utils/
├── types/
│   └── index.ts          # All interfaces and type aliases
└── utils/
    └── index.ts          # runRender() — file I/O, YAML parse/serialize, handler invocation
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
- **JSR specifiers** for Deno std libs: `"@std/yaml"`.
- Prefer single quotes. Prefer semicolons.

```typescript
// Correct
import {RenderHandler, RenderContext} from '../types';
import {parseArgs} from "node:util";
import {parse, stringify} from "@std/yaml";

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
- No try/catch in SDK — errors propagate to Deno runtime.
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

1. Parses `--input-file` and `--output-file` from `Deno.args`
2. Reads input file → deserializes YAML → `RenderContext`
3. Calls handler, validates non-empty `manifests` array
4. Serializes manifests to multi-document YAML (joined by `---\n`)
5. Writes to output file

```
deno run render.ts --input-file context.yaml --output-file manifests.yaml
```

Do NOT change the file-based I/O contract — it is the IPC mechanism with the Nelm runtime.

## Dependencies

- **Runtime**: `@std/yaml` (via `npm:@jsr/std__yaml`) — YAML parse/serialize
- **Dev**: `typescript`, `tsup`, `@types/node`, `@types/deno`

Keep runtime dependencies minimal. Do not add new ones without explicit approval.

## Adding New Code

1. Create types in `src/types/index.ts` (or a new file re-exported from it).
2. Create utilities in `src/utils/index.ts` (or a new file re-exported from it).
3. Ensure new exports flow through the barrel chain to `src/index.ts`.
4. Run `npx tsc --noEmit` to type-check.
5. Run `npm run build` to verify the bundle.

## Key Gotchas

- **Deno runtime**: Code runs under Deno, not Node.js. `Deno.*` APIs are used directly.
- **No tests**: No test infrastructure exists. If adding, choose a Deno-compatible runner.
- **No linter/formatter**: Follow conventions in this doc.
- **PascalCase properties**: Helm-compatible interfaces use Go-style naming. Do not "fix" to camelCase.
- **`@std/yaml` is a JSR package**: Imported as `@std/yaml`, resolved via `@jsr:registry` in `.npmrc`.
