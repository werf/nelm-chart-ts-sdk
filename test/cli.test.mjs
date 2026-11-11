import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, mkdirSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {inputYaml, makeChartDir, run, sdkRoot} from './helpers.mjs';

const cli = join(sdkRoot, 'dist', 'cli.js');
const nodeMajor = Number(process.versions.node.split('.')[0]);

const chart = `import {render, type RenderContext} from '@nelm/chart-ts-sdk';

enum Kind {
    ConfigMap = 'ConfigMap',
}

await render(($: RenderContext) => ({
    manifests: [{apiVersion: 'v1', kind: Kind.ConfigMap, metadata: {name: $.Release.Name}}],
}));
`;

const probe = (expression) => `import {render} from '@nelm/chart-ts-sdk';
import * as fs from 'node:fs';

const attempt = async (fn: () => unknown) => {
    try {
        await fn();
        return 'allowed';
    } catch (err: any) {
        return err.code ?? err.cause?.code ?? String(err);
    }
};

await render(async () => ({manifests: [{result: ${expression}}]}));
`;

test('dev bundles src/index.ts into .dev/bundle.js and prints manifests', (t) => {
    const dir = makeChartDir(t, {'src/index.ts': chart, 'input.example.yaml': inputYaml});

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'Rendered manifests:\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: my-release\n\n\n');
    assert.ok(existsSync(join(dir, '.dev', 'bundle.js')));
});

test('dev maps stack traces to the chart sources', (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': `import {render} from '@nelm/chart-ts-sdk';\n\nawait render((): never => { throw new Error('boom'); });\n`,
        'input.example.yaml': inputYaml,
    });

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 1);
    assert.ok(existsSync(join(dir, '.dev', 'bundle.js.map')));
    assert.match(result.stderr, /src[\\/]index\.ts:3:\d+/);
    assert.doesNotMatch(result.stderr, /\.dev[\\/]bundle\.js:\d+/);
});

test('dev runs CommonJS dependencies that use require and __dirname', (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': `import {render} from '@nelm/chart-ts-sdk';\nimport {location} from 'cjs-dependency';\nawait render(() => ({manifests: [{location: location()}]}));\n`,
        'input.example.yaml': inputYaml,
    });
    symlinkSync(join(sdkRoot, 'test', 'fixtures', 'cjs-dependency'), join(dir, 'node_modules', 'cjs-dependency'), 'junction');

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /location: \.dev\/bundle\.js function\n/);
});

test('dev falls back to src/index.js and accepts --input-file', (t) => {
    const dir = makeChartDir(t, {
        'src/index.js': `import {render} from '@nelm/chart-ts-sdk';\nawait render(($) => ({manifests: [{name: $.Release.Name}]}));\n`,
        'custom.yaml': inputYaml,
    });

    const result = run(dir, [cli, 'dev', '--input-file', 'custom.yaml']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /name: my-release/);
});

test('dev exits with the code of the failed render', (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': `import {render} from '@nelm/chart-ts-sdk';\nawait render(() => { throw new Error('boom'); });\n`,
        'input.example.yaml': inputYaml,
    });

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /boom/);
});

test('dev fails on a build error', (t) => {
    const dir = makeChartDir(t, {'src/index.ts': 'import "./missing.ts";\n', 'input.example.yaml': inputYaml});

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not resolve "\.\/missing\.ts"/);
});

test('dev reports an esbuild failure that is not a build error', {skip: process.platform === 'win32' && 'needs /usr/bin/false'}, (t) => {
    const dir = makeChartDir(t, {'src/index.ts': chart, 'input.example.yaml': inputYaml});

    const result = run(dir, [cli, 'dev'], {...process.env, ESBUILD_BINARY_PATH: '/usr/bin/false'});

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Failed to bundle src\/index\.ts: /);
});

test('dev fails without an entrypoint or an input file', (t) => {
    const noEntry = makeChartDir(t, {'input.example.yaml': inputYaml});
    const noInput = makeChartDir(t, {'src/index.ts': chart});

    const entryResult = run(noEntry, [cli, 'dev']);
    const inputResult = run(noInput, [cli, 'dev']);

    assert.equal(entryResult.status, 1);
    assert.match(entryResult.stderr, /neither src\/index\.ts nor src\/index\.js exists/);
    assert.equal(inputResult.status, 1);
    assert.match(inputResult.stderr, /Input file not found: .*input\.example\.yaml/);
});

test('dev rejects "*" in the bundle and input paths', {skip: process.platform === 'win32' && 'needs "*" in file names'}, (t) => {
    const dir = makeChartDir(t, {
        'ch*rt/src/index.ts': chart,
        'ch*rt/input.example.yaml': inputYaml,
        'src/index.ts': chart,
        'in*put.yaml': inputYaml,
    });

    const bundleResult = run(join(dir, 'ch*rt'), [cli, 'dev']);
    const inputResult = run(dir, [cli, 'dev', '--input-file', 'in*put.yaml']);

    assert.equal(bundleResult.status, 1);
    assert.match(bundleResult.stderr, /ch\*rt\/\.dev\/bundle\.js" contains "\*", which Node\.js takes as a wildcard in permission flags/);
    assert.equal(inputResult.status, 1);
    assert.match(inputResult.stderr, /in\*put\.yaml" contains "\*", which Node\.js takes as a wildcard in permission flags/);
});

test('rejects an unknown command', (t) => {
    const dir = makeChartDir(t, {});

    const result = run(dir, [cli, 'build']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: nelm-chart-ts dev \[--input-file <path>\]/);
});

test('dev hides the environment from the chart', (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': probe('process.env.NELM_CHART_TS_TEST_SECRET ?? "unset"'),
        'input.example.yaml': inputYaml,
    });

    const result = run(dir, [cli, 'dev'], {...process.env, NELM_CHART_TS_TEST_SECRET: 'secret'});

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /result: unset/);
});

test('dev denies file reads and writes outside the bundle and input', (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': probe(`[
            await attempt(() => fs.readFileSync(new URL('../package.json', import.meta.url))),
            await attempt(() => fs.writeFileSync(new URL('./written.txt', import.meta.url), 'x')),
        ]`),
        'input.example.yaml': inputYaml,
    });

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /result:\n\s+- ERR_ACCESS_DENIED\n\s+- ERR_ACCESS_DENIED\n/);
});

test('dev denies file writes through node:sqlite', (t) => {
    const dir = makeChartDir(t, {'input.example.yaml': inputYaml});
    const database = join(dir, 'sqlite.db');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), probe(`await attempt(async () => {
        const {DatabaseSync} = await import('node:sqlite');
        new DatabaseSync(${JSON.stringify(database)}).exec('CREATE TABLE t (x)');
    })`));

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /result: ERR_UNKNOWN_BUILTIN_MODULE\n/);
    assert.ok(!existsSync(database));
});

test('dev denies file writes through V8 flags', (t) => {
    const dir = makeChartDir(t, {'input.example.yaml': inputYaml});
    const traceFile = join(dir, 'code-traces.txt');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), `import {render} from '@nelm/chart-ts-sdk';
import {setFlagsFromString} from 'node:v8';

setFlagsFromString(${JSON.stringify(`--redirect-code-traces-to=${traceFile}`)});
setFlagsFromString('--redirect-code-traces');
setFlagsFromString('--print-opt-code');
const double = (x: number) => x * 2;
let sum = 0;
for (let i = 0; i < 1_000_000; i++) sum += double(i);

await render(() => ({manifests: [{sum}]}));
`);

    const result = run(dir, [cli, 'dev']);

    assert.ok(!existsSync(traceFile));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Check failed: !IsFrozen\(\)/);
});

test('dev denies network access', {skip: nodeMajor < 26 && 'needs Node.js 26+'}, (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': probe(`await attempt(() => fetch('http://127.0.0.1:8080'))`),
        'input.example.yaml': inputYaml,
    });

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /result: ERR_ACCESS_DENIED/);
});

const withNodeVersion = (version) => `data:text/javascript,Object.defineProperty(process, 'versions', {value: {...process.versions, node: '${version}'}}); Object.defineProperty(process, 'version', {value: 'v${version}'});`;

for (const [version, warns] of [['24.13.0', true], ['25.9.0', true], ['26.0.0', false], ['26.12.0', false], ['27.0.0', false]]) {
    test(`dev ${warns ? 'warns' : 'does not warn'} about network access on Node.js ${version}`, (t) => {
        const dir = makeChartDir(t, {'src/index.ts': chart, 'input.example.yaml': inputYaml});

        const result = run(dir, ['--import', withNodeVersion(version), cli, 'dev']);

        assert.equal(result.status, 0, result.stderr);
        if (warns) {
            assert.match(result.stderr, new RegExp(`Node\\.js v${version.replaceAll('.', '\\.')} does not restrict network access under --permission`));
        } else {
            assert.equal(result.stderr, '');
        }
    });
}

const debugChart = `import {render} from '@nelm/chart-ts-sdk';

await render(() => ({manifests: [{execArgv: process.execArgv, secret: process.env.NELM_CHART_TS_TEST_SECRET ?? 'unset'}]}));
`;

test('dev --inspect runs the chart without the sandbox', (t) => {
    const dir = makeChartDir(t, {'src/index.ts': debugChart, 'input.example.yaml': inputYaml});

    const result = run(dir, [cli, 'dev', '--inspect=127.0.0.1:0'], {...process.env, NELM_CHART_TS_TEST_SECRET: 'secret'});

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Debugger listening on ws:\/\/127\.0\.0\.1:\d+\//);
    assert.match(result.stderr, /the sandbox is disabled while debugging/);
    assert.match(result.stdout, /- --inspect=127\.0\.0\.1:0\n/);
    assert.doesNotMatch(result.stdout, /--permission/);
    assert.match(result.stdout, /secret: secret\n/);
});

test('dev --inspect-brk waits for the debugger', {timeout: 10_000}, async (t) => {
    const dir = makeChartDir(t, {'src/index.ts': debugChart, 'input.example.yaml': inputYaml});

    const cliProcess = spawn(process.execPath, [cli, 'dev', '--inspect-brk=127.0.0.1:0'], {cwd: dir});
    t.after(() => cliProcess.kill('SIGKILL'));
    let stdout = '';
    let stderr = '';
    cliProcess.stdout.on('data', (chunk) => stdout += chunk);
    const debuggerUrl = await new Promise((resolve, reject) => {
        cliProcess.stderr.on('data', (chunk) => {
            stderr += chunk;
            const match = stderr.match(/Debugger listening on (ws:\/\/\S+)/);
            if (match) resolve(match[1]);
        });
        cliProcess.once('exit', () => reject(new Error(`dev exited before the debugger started: ${stderr}`)));
    });

    const socket = new WebSocket(debuggerUrl);
    await once(socket, 'open');
    socket.send(JSON.stringify({id: 1, method: 'Runtime.runIfWaitingForDebugger'}));
    await new Promise((resolve) => socket.addEventListener('message', (event) => {
        if (JSON.parse(event.data).id === 1) resolve();
    }));
    socket.close();
    const [code] = await once(cliProcess, 'close');

    assert.equal(code, 0, stderr);
    assert.match(stdout, /- --inspect-brk=127\.0\.0\.1:0\n/);
});

test('dev rejects --inspect together with --inspect-brk', (t) => {
    const dir = makeChartDir(t, {'src/index.ts': chart, 'input.example.yaml': inputYaml});

    const result = run(dir, [cli, 'dev', '--inspect', '--inspect-brk']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use either --inspect or --inspect-brk/);
});

test('dev forwards SIGTERM to the render and exits by it', {skip: process.platform === 'win32' && 'needs POSIX signals', timeout: 10_000}, async (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': `console.error('started');\nawait new Promise((resolve) => setTimeout(resolve, 60_000));\n`,
        'input.example.yaml': inputYaml,
    });

    const cliProcess = spawn(process.execPath, [cli, 'dev'], {cwd: dir});
    t.after(() => cliProcess.kill('SIGKILL'));
    let stderr = '';
    await new Promise((resolve, reject) => {
        cliProcess.stderr.on('data', (chunk) => {
            stderr += chunk;
            if (stderr.includes('started')) resolve();
        });
        cliProcess.once('exit', () => reject(new Error(`dev exited before the render started: ${stderr}`)));
    });
    cliProcess.kill('SIGTERM');
    const [code, signal] = await once(cliProcess, 'close');

    assert.equal(code, null);
    assert.equal(signal, 'SIGTERM');
});
