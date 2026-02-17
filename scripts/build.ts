import * as esbuild from "esbuild-wasm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DENO_CONFIG = "./deno.json";
const DIST_DIR = "./dist";
const VENDOR_DIR = "vendor";

// Node built-in modules list (for externalization)
const nodeBuiltIns = [
    "assert", "buffer", "child_process", "cluster", "console", "constants",
    "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
    "module", "net", "os", "path", "punycode", "process", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "tty", "url", "util", "vm", "zlib"
];

await esbuild.initialize({ worker: false });

console.log(`Clear dist ${DIST_DIR}...`);
await Deno.remove(DIST_DIR, { recursive: true }).catch(() => {});

const configText = await Deno.readTextFile(DENO_CONFIG);
const config = JSON.parse(configText);
const imports = config.imports || {};

const entryPoints: Record<string, string> = {};
const importMap: Record<string, string> = {};

console.log("Analyze deps...");

for (const builtin of nodeBuiltIns) {
    importMap[builtin] = `node:${builtin}`;
}

// Polyfill file generation
const POLYFILLS_FILE = "./_vendor_polyfills_gen.ts";
const polyfillsContent = `
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function setupNodeEnvironment(url) {
  const __nativeRequire = createRequire(url);
  const __filename = fileURLToPath(url);
  const __dirname = dirname(__filename);

  const require = function(id) {
    // TypeScript stub (so Pulumi doesn't crash)
    if (typeof id === 'string' && (id === 'typescript' || id.includes('typescript.js') || id.includes('/vendor/typescript'))) {
      return { version: '0.0.0', sys: {} };
    }
    return __nativeRequire(id);
  };
  
  Object.assign(require, __nativeRequire);
  
  return { require, __dirname, __filename };
}
`;
await Deno.writeTextFile(POLYFILLS_FILE, polyfillsContent);

entryPoints["_polyfills"] = POLYFILLS_FILE;

// Function to resolve a package entry point (prefer ESM > CJS)
async function resolvePackageEntry(pkgName: string) {
    try {
        // 1. Try to find the package's package.json
        const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
        const pkgPath = await Deno.readTextFile(pkgJsonPath);
        const pkg = JSON.parse(pkgPath);

        // 2. If the "module" field exists, it's ESM! Use it.
        if (pkg.module) {
            // Compute the path relative to the package folder
            // path.dirname(pkgJsonPath) + pkg.module
            const pkgDir = pkgJsonPath.replace(/package\.json$/, "");
            return require.resolve(pkgDir + pkg.module);
        }
    } catch (e) {
        // Ignore package.json read errors
    }

    // 3. Fallback: use the default CJS entry point
    return require.resolve(pkgName);
}

// 3. PACKAGE DISCOVERY
for (const key of Object.keys(imports)) {
    if (key.startsWith("@types/") || key.startsWith("./")) continue;
    const mapping = imports[key];

    // !!! FIX: handle non-NPM packages !!!
    if (!mapping.startsWith("npm:")) {
        // We can't bundle JSR/HTTPS via esbuild (in node platform mode),
        // but we MUST put them into the import map so Deno can resolve them.
        importMap[key] = mapping;
        console.log(`   ⏩ ${key} -> Passthrough (JSR/External)`);
        continue;
    }

    // From here on, the old npm logic...
    let pkgName = mapping.replace("npm:", "").split("@")[0];
    if (mapping.startsWith("npm:@")) {
        pkgName = "@" + mapping.replace("npm:", "").split("@")[1];
    }

    try {
        const absPath = await resolvePackageEntry(pkgName);
        const safeName = key.replace(/@/g, "").replace(/\//g, "_").replace(/-/g, "_");
        entryPoints[safeName] = absPath;
        importMap[key] = `./${VENDOR_DIR}/${safeName}.js`;
        console.log(`   ✅ ${key} -> ${pkgName} [bundled]`);
    } catch (e) {
        console.warn(`   ⚠️ Not found ${pkgName}.`);
    }
}

console.log("📦 Build vendor...");

try {
    await esbuild.build({
        entryPoints: entryPoints,
        outdir: `${DIST_DIR}/${VENDOR_DIR}`,
        bundle: true,
        splitting: true,
        format: "esm",
        platform: "node",
        target: "esnext",
        minify: true,
        treeShaking: true,
        external: [...nodeBuiltIns, "node:*"],

        banner: {
            js: `
import { setupNodeEnvironment } from "./_polyfills.js";
const { require, __dirname, __filename } = setupNodeEnvironment(import.meta.url);
      `
        },
    });

} catch (e) {
    console.error("❌ Build error:", e);
    Deno.exit(1);
} finally {
    try { await Deno.remove(POLYFILLS_FILE); } catch {}
}

console.log("📝 Generate vendor_map.json...");

const finalMap = {
    imports: importMap
};

await Deno.writeTextFile(
    `${DIST_DIR}/vendor_map.json`,
    JSON.stringify(finalMap, null, 2)
);

console.log("\n🎉 Done!");
esbuild.stop();