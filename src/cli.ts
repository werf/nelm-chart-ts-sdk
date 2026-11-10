#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {realpath} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {build} from 'esbuild';

const usage = 'Usage: nelm-chart-ts dev [--input-file <path>]';

const fail = (message: string): never => {
    console.error(message);
    process.exit(1);
};

const parseCliArgs = (): {inputFile: string} => {
    let parsed;
    try {
        parsed = parseArgs({
            args: process.argv.slice(2),
            allowPositionals: true,
            options: {
                'input-file': {type: 'string', default: 'input.example.yaml'},
            },
        });
    } catch (err) {
        return fail(`${(err as Error).message}\n${usage}`);
    }

    const {positionals, values} = parsed;
    if (positionals.length !== 1 || positionals[0] !== 'dev') {
        return fail(usage);
    }

    return {inputFile: values['input-file']};
};

const minNodeVersion = [26, 12, 1];

const isOlderThanMinNode = (version: string): boolean => {
    const parts = version.split('-')[0].split('.').map(Number);
    for (const [i, min] of minNodeVersion.entries()) {
        const part = parts[i] ?? 0;
        if (part !== min) {
            return part < min;
        }
    }
    return false;
};

const dev = async (inputFile: string): Promise<number> => {
    if (isOlderThanMinNode(process.versions.node)) {
        console.error(`Warning: the --permission sandbox is incomplete on Node.js ${process.version}: network access is open before Node.js 26, and permission model bypasses are fixed in Node.js ${minNodeVersion.join('.')}. Use Node.js ${minNodeVersion.join('.')} or newer.`);
    }

    const workDir = process.cwd();
    const entryPoint = ['src/index.ts', 'src/index.js'].find((path) => existsSync(join(workDir, path)));
    if (!entryPoint) {
        return fail(`Entrypoint not found: neither src/index.ts nor src/index.js exists in ${workDir}`);
    }

    const inputPath = resolve(workDir, inputFile);
    if (!existsSync(inputPath)) {
        return fail(`Input file not found: ${inputPath}`);
    }

    const bundlePath = join(workDir, '.dev', 'bundle.js');
    try {
        await build({
            entryPoints: [entryPoint],
            absWorkingDir: workDir,
            bundle: true,
            format: 'esm',
            platform: 'node',
            target: 'node26',
            // CommonJS dependencies need require() for built-in modules and __dirname/__filename.
            banner: {js: "import { createRequire as __nelmCreateRequire } from 'node:module'; const require = __nelmCreateRequire(import.meta.url);"},
            define: {__dirname: 'import.meta.dirname', __filename: 'import.meta.filename'},
            outfile: bundlePath,
            logLevel: 'warning',
        });
    } catch (err) {
        // Build failures carry diagnostics that esbuild has already printed.
        if (!Array.isArray((err as {errors?: unknown}).errors)) {
            console.error(`Failed to bundle ${entryPoint}: ${(err as Error).message}`);
        }
        return 1;
    }

    const bundle = await realpath(bundlePath);
    const input = await realpath(inputPath);
    const env: Record<string, string> = {};
    if (process.platform === 'win32' && process.env.SystemRoot) {
        env.SystemRoot = process.env.SystemRoot;
    }

    const child = spawn(process.execPath, [
        '--permission',
        // node:sqlite writes files bypassing the permission model.
        '--no-experimental-sqlite',
        // v8.setFlagsFromString can enable V8 tracing that writes files bypassing the permission model.
        '--freeze-flags-after-init',
        `--allow-fs-read=${bundle}`,
        `--allow-fs-read=${input}`,
        bundle,
        `--input-file=${input}`,
    ], {env, stdio: 'inherit'});

    const forwardedSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    for (const signal of forwardedSignals) {
        process.on(signal, forward);
    }

    return new Promise((resolvePromise) => {
        child.on('error', (err) => {
            console.error(`Failed to run ${process.execPath}: ${err.message}`);
            resolvePromise(1);
        });
        child.on('close', (code, signal) => {
            for (const forwardedSignal of forwardedSignals) {
                process.off(forwardedSignal, forward);
            }
            if (signal) {
                process.kill(process.pid, signal);
            }
            resolvePromise(code ?? 1);
        });
    });
};

const {inputFile} = parseCliArgs();
process.exitCode = await dev(inputFile);
