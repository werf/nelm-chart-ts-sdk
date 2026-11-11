#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {realpath, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {build} from 'esbuild';

const usage = 'Usage: nelm-chart-ts dev [--input-file <path>] [--inspect[=[host:]port] | --inspect-brk[=[host:]port]]';

const inspectOptions = ['--inspect', '--inspect-brk'];

const fail = (message: string): never => {
    console.error(message);
    process.exit(1);
};

const parseCliArgs = (): {inputFile: string, inspectFlag: string | null} => {
    // parseArgs has no options with an optional value, so a bare `--inspect` is passed as `--inspect=`.
    const args = process.argv.slice(2);
    const terminator = args.indexOf('--');
    const normalizedArgs = args.map((arg, i) => (terminator === -1 || i < terminator) && inspectOptions.includes(arg) ? `${arg}=` : arg);

    let parsed;
    try {
        parsed = parseArgs({
            args: normalizedArgs,
            allowPositionals: true,
            options: {
                'input-file': {type: 'string', default: 'input.example.yaml'},
                'inspect': {type: 'string'},
                'inspect-brk': {type: 'string'},
            },
        });
    } catch (err) {
        return fail(`${(err as Error).message}\n${usage}`);
    }

    const {positionals, values} = parsed;
    if (positionals.length !== 1 || positionals[0] !== 'dev') {
        return fail(usage);
    }

    if (values.inspect !== undefined && values['inspect-brk'] !== undefined) {
        return fail(`Use either --inspect or --inspect-brk.\n${usage}`);
    }

    let inspectFlag: string | null = null;
    for (const option of inspectOptions) {
        const value = values[option.slice(2) as 'inspect' | 'inspect-brk'];
        if (value !== undefined) {
            inspectFlag = value === '' ? option : `${option}=${value}`;
        }
    }

    return {inputFile: values['input-file'], inspectFlag};
};

const dev = async (inputFile: string, inspectFlag: string | null): Promise<number> => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 26) {
        console.error(`Warning: Node.js ${process.version} does not restrict network access under --permission, use Node.js 26 or newer.`);
    }
    if (inspectFlag) {
        console.error('Warning: the sandbox is disabled while debugging: the chart can access any file, the network and environment variables. To check the chart as nelm renders it, run `npm run dev` without --inspect.');
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
    const input = await realpath(inputPath);
    // Node.js grants read access to a directory recursively.
    if (!(await stat(input)).isFile()) {
        return fail(`Input file is not a regular file: ${input}`);
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
            sourcemap: 'linked',
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
    const sourceMap = `${bundle}.map`;
    for (const path of [bundle, sourceMap, input]) {
        if (path.includes('*')) {
            return fail(`Path "${path}" contains "*", which Node.js takes as a wildcard in permission flags: rename the directory or file.`);
        }
    }
    // node:sqlite writes files and v8.setFlagsFromString can enable V8 tracing that writes files,
    // both bypassing the permission model.
    const hardeningFlags = ['--no-experimental-sqlite', '--freeze-flags-after-init'];
    let nodeArgs: string[];
    let env: NodeJS.ProcessEnv;
    if (inspectFlag) {
        // Debuggers such as the VS Code JavaScript Debug Terminal need the environment and file access.
        nodeArgs = [...hardeningFlags, '--enable-source-maps', inspectFlag];
        env = process.env;
    } else {
        nodeArgs = [
            '--permission',
            ...hardeningFlags,
            '--enable-source-maps',
            `--allow-fs-read=${bundle}`,
            `--allow-fs-read=${sourceMap}`,
            `--allow-fs-read=${input}`,
        ];
        env = {};
        if (process.platform === 'win32' && process.env.SystemRoot) {
            env.SystemRoot = process.env.SystemRoot;
        }
    }

    const child = spawn(process.execPath, [...nodeArgs, bundle, `--input-file=${input}`], {env, stdio: 'inherit'});

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

const {inputFile, inspectFlag} = parseCliArgs();
process.exitCode = await dev(inputFile, inspectFlag);
