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

const dev = async (inputFile: string): Promise<number> => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 26) {
        console.error(`Warning: Node.js ${process.version} does not restrict network access under --permission, use Node.js 26 or newer.`);
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
            outfile: bundlePath,
            logLevel: 'warning',
        });
    } catch {
        // esbuild has already printed the errors.
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
        `--allow-fs-read=${bundle}`,
        `--allow-fs-read=${input}`,
        bundle,
        `--input-file=${input}`,
    ], {env, stdio: 'inherit'});

    return new Promise((resolvePromise) => {
        child.on('error', (err) => {
            console.error(`Failed to run ${process.execPath}: ${err.message}`);
            resolvePromise(1);
        });
        child.on('close', (code) => resolvePromise(code ?? 1));
    });
};

const {inputFile} = parseCliArgs();
process.exitCode = await dev(inputFile);
