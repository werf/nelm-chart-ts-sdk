import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
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

test('dev denies network access', {skip: nodeMajor < 26 && 'needs Node.js 26+'}, (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': probe(`await attempt(() => fetch('http://127.0.0.1:8080'))`),
        'input.example.yaml': inputYaml,
    });

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /result: ERR_ACCESS_DENIED/);
});

test('dev warns on Node.js older than 26', {skip: nodeMajor >= 26 && 'needs Node.js < 26'}, (t) => {
    const dir = makeChartDir(t, {'src/index.ts': chart, 'input.example.yaml': inputYaml});

    const result = run(dir, [cli, 'dev']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /does not restrict network access under --permission/);
});

test('dev forwards SIGTERM to the render and exits by it', {skip: process.platform === 'win32' && 'needs POSIX signals', timeout: 10_000}, async (t) => {
    const dir = makeChartDir(t, {
        'src/index.ts': `console.error('started');\nawait new Promise((resolve) => setTimeout(resolve, 60_000));\n`,
        'input.example.yaml': inputYaml,
    });

    const cliProcess = spawn(process.execPath, [cli, 'dev'], {cwd: dir});
    let stderr = '';
    await new Promise((resolve) => cliProcess.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.includes('started')) resolve();
    }));
    cliProcess.kill('SIGTERM');
    const [code, signal] = await once(cliProcess, 'close');

    assert.equal(code, null);
    assert.equal(signal, 'SIGTERM');
});
