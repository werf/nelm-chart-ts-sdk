import * as esbuild from "esbuild-wasm";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";

const require = createRequire(import.meta.url);

// --- CONFIGURATION ---
const DENO_CONFIG = "./deno.json";
const BUILD_CONFIG = "./deno.build.json"; // Temporary config
const DIST_DIR = "./dist";
const VENDOR_DIR = "vendor";
const TEMP_DIR = "./_vendor_staging";

// Built-in modules (External)
const nodeBuiltIns = [
    "assert", "buffer", "child_process", "cluster", "console", "constants",
    "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
    "module", "net", "os", "path", "punycode", "process", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "tty", "url", "util", "vm", "zlib", "inspector"
];

// --- BRIDGE LOGIC: JSR -> NPM ---

function convertJsrToNpm(specifier: string): string {
    if (!specifier.startsWith("jsr:")) return specifier;

    let clean = specifier.replace("jsr:", "");
    // If there's a version (@1.0.0), split it out
    const lastAt = clean.lastIndexOf("@");
    let version = "";
    if (lastAt > 0 && !clean.startsWith("@")) {
        // example: package@1.0.0
        version = clean.substring(lastAt);
        clean = clean.substring(0, lastAt);
    } else if (clean.startsWith("@") && (clean.match(/@/g) || []).length > 1) {
        // example: @scope/package@1.0.0
        version = clean.substring(clean.lastIndexOf("@"));
        clean = clean.substring(0, clean.lastIndexOf("@"));
    }

    // Name transform: @std/async -> @jsr/std__async
    let npmName = clean;
    if (clean.startsWith("@")) {
        npmName = `@jsr/${clean.slice(1).replace("/", "__")}`;
    } else {
        // Rare case without a scope, but for JSR it's usually scoped
        npmName = `@jsr/${clean.replace("/", "__")}`;
    }

    return `npm:${npmName}${version}`;
}

const linkedPackages: Record<string, boolean> = {};

// Creates a temporary deno.build.json and populates node_modules
async function prepareBuildEnvironment(imports: Record<string, string>, links: string[]) {
    console.log("🛠️  Preparing NPM bridge...");

    const buildImports: Record<string, string> = {};
    const packagesToCache: string[] = [];

    if (links.length > 0) {
        console.log("🔗 Processing linked packages...");
        for (const linkPath of links) {
            const pkgJsonPath = join(linkPath, "package.json");
            try {
                const pkgJsonContent = await Deno.readTextFile(pkgJsonPath);
                const pkg = JSON.parse(pkgJsonContent);
                const pkgName = pkg.name;
                linkedPackages[pkgName] = true;
            } catch (e: unknown) {
                // Skip
            }
        }
    }

    for (const [key, value] of Object.entries(imports)) {
        if (value.startsWith("jsr:")) {
            const npmMirror = convertJsrToNpm(value);
            buildImports[key] = npmMirror; // Substitute
            packagesToCache.push(npmMirror);
        } else {
            buildImports[key] = value;
            if (value.startsWith("npm:") && !linkedPackages[key]) {
                packagesToCache.push(value);
            }
        }
    }

    // Write a temporary config
    const buildConfig = {
        "nodeModulesDir": "auto", // IMPORTANT: this creates files on disk
        "imports": Object.entries(buildImports).reduce((acc, [key, val]) => {
            if (!linkedPackages[key]) {
                acc[key] = val;
            }
            return acc;
        }, {})
    };
    console.log(buildConfig, linkedPackages)
    await Deno.writeTextFile(BUILD_CONFIG, JSON.stringify(buildConfig, null, 2));

    // Force-cache dependencies using the temporary config
    if (packagesToCache.length > 0) {
        console.log("📥 Downloading JS package variants...");
        const command = new Deno.Command(Deno.execPath(), {
            args: ["cache", "--config", BUILD_CONFIG, ...packagesToCache],
            stdout: "inherit",
            stderr: "inherit"
        });
        const result = await command.output();
        if (!result.success) throw new Error("Failed to download dependencies");
    }

    return buildImports;
}

// Find a path to a file inside node_modules
async function resolveNpmPath(pkgName: string) {
    try {
        const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
        const pkgPath = await Deno.readTextFile(pkgJsonPath);
        const pkg = JSON.parse(pkgPath);
        // Prefer ESM (module), but fall back to main
        if (pkg.module) {
            const pkgDir = pkgJsonPath.replace(/package\.json$/, "");
            return require.resolve(pkgDir + pkg.module);
        }
    } catch (_e) {
        // ignore and fall back to default resolution
    }
    // Fallback to standard resolution
    return require.resolve(pkgName);
}

console.log(`🚀 Initializing esbuild...`);
await esbuild.initialize({ worker: false });

try { await Deno.remove(DIST_DIR, { recursive: true }); } catch {
    // ignore
}
try { await Deno.remove(TEMP_DIR, { recursive: true }); } catch {
    // ignore
}
await Deno.mkdir(TEMP_DIR, { recursive: true });

// 1. Read the original config
const configPath = resolve(Deno.cwd(), DENO_CONFIG);
const configText = await Deno.readTextFile(configPath);
const config = JSON.parse(configText);

// 2. Prepare the environment (bridge)
let buildImports: Record<string, string>;
try {
    buildImports = await prepareBuildEnvironment(config.imports || {}, config.links || []);
} catch (e) {
    console.error(e);
    Deno.exit(1);
}

const entryPoints: Record<string, string> = {};
const importMap: Record<string, string> = {};

console.log("🔍 Dependency analysis (NPM Bridge Mode)...");

for (const builtin of nodeBuiltIns) {
    importMap[builtin] = `node:${builtin}`;
}

// Polyfills
const POLYFILLS_FILE = `${TEMP_DIR}/_polyfills.ts`;
const polyfillsContent = `
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function setupNodeEnvironment(url) {
  const __nativeRequire = createRequire(url);
  const __filename = fileURLToPath(url);
  const __dirname = dirname(__filename);

  const require = function(id) {
    if (typeof id === 'string' && (id === 'typescript' || id.includes('typescript.js'))) {
      return { version: '0.0.0', sys: {} };
    }
    try { return __nativeRequire(id); } catch (e) { return {}; }
  };
  Object.assign(require, __nativeRequire);
  return { require, __dirname, __filename };
}
`;
await Deno.writeTextFile(POLYFILLS_FILE, polyfillsContent);
entryPoints["_polyfills"] = POLYFILLS_FILE;


// --- BUILD PATHS ---
for (const [key, mapping] of Object.entries(buildImports)) {
    if (key.startsWith("@types/") || key.startsWith("./")) continue;
    const safeName = key.replace(/@/g, "").replace(/\//g, "_").replace(/-/g, "_");

    // Now, thanks to the bridge, ALL packages start with npm:
    if (mapping.startsWith("npm:")) {
        // Extract the plain package name for require.resolve
        let pkgName = mapping.replace("npm:", "");
        // Strip trailing version @1.0.0
        const versionIndex = pkgName.lastIndexOf("@");
        if (versionIndex > 0 && !pkgName.startsWith("@")) {
            pkgName = pkgName.substring(0, versionIndex);
        } else if (pkgName.startsWith("@") && (pkgName.match(/@/g) || []).length > 1) {
            // @scope/pkg@1.0.0 -> @scope/pkg
            pkgName = pkgName.substring(0, pkgName.lastIndexOf("@"));
        }

        try {
            const absPath = await resolveNpmPath(pkgName);
            entryPoints[safeName] = absPath;
            importMap[key] = `./${VENDOR_DIR}/${safeName}.js`;

            const isJsr = pkgName.startsWith("@jsr/");
            console.log(`   ✅ ${key} -> ${pkgName} ${isJsr ? '(JSR Mirror)' : ''}`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`   ⚠️ Failed to resolve package ${pkgName}: ${message}`);
        }
    }
}

console.log("📦 Building...");

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
        // Important for .json files inside packages
        loader: { '.json': 'json' },
        external: [
            ...nodeBuiltIns,
            ...nodeBuiltIns.map(m => `node:${m}`),
        ],
        banner: {
            js: `
import { setupNodeEnvironment } from "./_polyfills.js";
const { require, __dirname, __filename } = setupNodeEnvironment(import.meta.url);
      `
        },
    });

} catch (e) {
    console.error("❌ Build failed:", e);
    Deno.exit(1);
} finally {
    try { await Deno.remove(TEMP_DIR, { recursive: true }); } catch {
        // ignore
    }
    try { await Deno.remove(BUILD_CONFIG); } catch {
        // ignore
    }
}

console.log("📝 Generating vendor_map.json...");
await Deno.writeTextFile(
    `${DIST_DIR}/vendor_map.json`,
    JSON.stringify({ imports: importMap }, null, 2)
);

console.log("\n🎉 Done!");
esbuild.stop();
