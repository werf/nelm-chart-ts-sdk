# AGENTS.md — nelm-ts-chart-sdk

## Project Overview

TypeScript SDK for generating Kubernetes manifests with TypeScript instead of Helm templates.
Published as `@nelm/chart-ts-sdk`. Users import types (`RenderContext`, `RenderResult`, etc.)
and the `runRender` helper to build Helm-compatible chart renderers.

**Runtime**: Deno (uses `Deno.args`), with Node.js built-in modules via `node:` prefix.
**Module system**: ESM only (`"type": "module"`).
**License**: Apache-2.0.

## Build & Development Commands

```bash
# Build (tsup, ESM output + .d.ts)
npm run build              # tsup src/index.ts --format esm --dts

# Type-check only (no emit)
npx tsc --noEmit

# No linter configured (no eslint/prettier)
# No test framework configured (no test files exist)
# No "dev" or "watch" script configured
```

### Build Output
- `dist/index.js` — bundled ESM
- `dist/index.d.ts` — type declarations
- Built automatically on `prepublishOnly` and `prepack`

## Project Structure

```
src/
├── index.ts              # Barrel re-exports from types/ and utils/
├── types/
│   └── index.ts          # All interfaces and type aliases
└── utils/
    └── index.ts          # runRender() — the main runtime entry point
```

- **3 source files total.** This is a small, focused SDK.
- `dist/` and `node_modules/` are gitignored.

## TypeScript Configuration

- `target`: ESNext
- `module`: ESNext
- `moduleResolution`: Bundler
- `strict`: true (all strict checks enabled)
- `allowJs`: false (TypeScript only)
- `esModuleInterop`: true

## Code Style & Conventions

### Imports

- **Named imports only** — no default imports, no namespace imports.
- **Relative paths** for internal modules: `'../types'` (no path aliases).
- **`node:` prefix** for Node.js built-ins: `"node:util"`.
- **No consistent quote style** — single quotes for relative, double for `node:` imports.
  When adding code, prefer single quotes for consistency with the majority.
- **No semicolon consistency** — some lines have them, some don't.
  Prefer semicolons when adding new code.

```typescript
// ✅ Correct
import {RenderHandler, RenderContext} from '../types';
import {parseArgs} from "node:util";

// ❌ Wrong
import * as types from '../types';
import RenderContext from '../types';
```

### Module Organization

- **Barrel exports** via `index.ts` files in each directory.
- Root `src/index.ts` re-exports everything: `export * from './types/index'`.
- All public types and functions MUST be exported through the barrel chain.
- New modules: create a directory with `index.ts`, add `export *` in parent barrel.

### Interfaces & Types

- **PascalCase** for interface and type names: `RenderContext`, `ChartMetadata`.
- **No `I` prefix** — use `Release`, not `IRelease`.
- **PascalCase properties** for Helm/Kubernetes-compatible structures: `$.Release.Name`,
  `$.Chart.Version`, `$.Values.replicaCount`. This mirrors Go's exported field naming
  from the Helm ecosystem.
- **camelCase properties** for SDK-internal structures: `manifests` in `RenderResult`.
- **`export interface`** — always exported, never internal-only.
- **`export type`** for type aliases: `export type RenderHandler = ...`.

```typescript
// ✅ Helm-compatible interface — PascalCase properties
export interface Release {
    Name: string;
    Namespace: string;
    Revision: number;
    IsInstall: boolean;
}

// ✅ SDK-internal interface — camelCase properties
export interface RenderResult {
    manifests: object[] | null;
}
```

### Functions

- **`export const` + arrow** for async utility functions: `export const runRender = async (...) => { }`.
- **`export function`** for synchronous helpers: `export function fullname(...)`.
- **`$` parameter name** is the conventional shorthand for `RenderContext` in render helpers.
- **Explicit return types** on exported functions.

```typescript
// Async runner — arrow function
export const runRender = async (handler: RenderHandler) => { ... };

// Sync helper — function declaration
export function trunc(str: string, max: number): string { ... }

// Render helper — $ convention for RenderContext
export function fullname($: RenderContext): string { ... }
```

### Null Handling

- **`| null`** in type definitions (not `| undefined`): `manifests: object[] | null`.
- **Nullish coalescing `??`** for defaults: `$.Values.replicaCount ?? 1`.
- **Optional chaining `?.`** for nested access: `$.Values.image?.repository`.

### Error Handling

- No custom error classes. No try/catch patterns in the current codebase.
- `runRender` does not wrap handler calls in try/catch — errors propagate to the runtime.

### Comments & Documentation

- **No JSDoc.** No inline comments in source files.
- Keep it minimal — the code is self-documenting given its small size.

### Naming Conventions

| Element              | Convention  | Example                        |
|----------------------|-------------|--------------------------------|
| Interfaces/Types     | PascalCase  | `RenderContext`, `RenderResult`|
| Helm-compat fields   | PascalCase  | `Release.Name`, `Chart.Version`|
| SDK-internal fields  | camelCase   | `manifests`                    |
| Functions            | camelCase   | `runRender`, `fullname`        |
| Variables/params     | camelCase   | `handler`, `ctx`               |
| RenderContext param  | `$`         | `function labels($: RenderContext)` |
| Directories          | lowercase   | `types/`, `utils/`             |

### Async Patterns

- **async/await** preferred over raw Promises.
- `RenderHandler` supports both sync and async: `($: RenderContext) => Promise<RenderResult> | RenderResult`.

## Communication Protocol

`runRender` outputs results via `console.log` with a specific prefix:
```
NELM_RENDER_RESULT:<json>
```
Do NOT change this prefix — it is the IPC contract with the Nelm runtime.

## Dependencies

### Dev Dependencies Only
- `typescript` ^5.0.0 — type checking
- `tsup` ^8.5.1 — bundler (esbuild-based)
- `@types/node` ^25.2.3 — Node.js type definitions
- `@types/deno` ^2.5.0 — Deno type definitions

### No Runtime Dependencies
This package has zero runtime dependencies. Keep it that way.

## Adding New Code

1. Create types in `src/types/index.ts` (or a new file re-exported from it).
2. Create utilities in `src/utils/index.ts` (or a new file re-exported from it).
3. Ensure new exports flow through the barrel chain to `src/index.ts`.
4. Run `npx tsc --noEmit` to type-check.
5. Run `npm run build` to verify the bundle.

## Key Gotchas

- **Deno runtime**: Code runs under Deno, not Node.js. `Deno.args` is used directly.
- **No test infrastructure**: There are no tests. If adding tests, choose a Deno-compatible
  test runner and document the command here.
- **No linter/formatter**: No eslint or prettier configured. Follow conventions in this doc.
- **PascalCase properties**: The Helm-compatible interfaces use Go-style PascalCase field names.
  This is intentional — do not "fix" it to camelCase.
- **Zero runtime deps**: Do not add runtime dependencies without explicit approval.
