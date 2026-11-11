import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {load} from 'js-yaml';
import {inputYaml, makeChartDir, run} from './helpers.mjs';

const chart = `import {render} from '@nelm/chart-ts-sdk';

class Service {
    constructor(name) {
        this.apiVersion = 'v1';
        this.kind = 'Service';
        this.metadata = {name};
    }
}

await render(($) => ({
    manifests: [
        {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: {name: $.Release.Name, namespace: $.Release.Namespace},
            data: {bool: 'yes', octal: '0755', time: '12:30', date: '2024-01-01', missing: undefined},
        },
        new Service($.Release.Name),
    ],
}));
`;

const expected = `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-release
  namespace: my-namespace
data:
  bool: 'yes'
  octal: '0755'
  time: '12:30'
  date: '2024-01-01'
---
apiVersion: v1
kind: Service
metadata:
  name: my-release
`;

test('writes manifests as multi-document YAML to --output-file', (t) => {
    const dir = makeChartDir(t, {'chart.mjs': chart, 'input.yaml': inputYaml});

    const result = run(dir, ['chart.mjs', '--input-file', 'input.yaml', '--output-file', 'output.yaml']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, 'output.yaml'), 'utf8'), expected);
});

test('prints manifests to stdout without --output-file', (t) => {
    const dir = makeChartDir(t, {'chart.mjs': chart, 'input.yaml': inputYaml});

    const result = run(dir, ['chart.mjs', '--input-file=input.yaml']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `Rendered manifests:\n${expected}\n\n`);
});

test('fails without --input-file', (t) => {
    const dir = makeChartDir(t, {'chart.mjs': chart});

    const result = run(dir, ['chart.mjs']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: .*--input-file <input-file>/);
});

test('fails when the handler returns no manifests array', (t) => {
    const dir = makeChartDir(t, {
        'chart.mjs': `import {render} from '@nelm/chart-ts-sdk';\nawait render(() => ({}));\n`,
        'input.yaml': inputYaml,
    });

    const result = run(dir, ['chart.mjs', '--input-file', 'input.yaml']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Handler must return an object with a 'manifests' array/);
});

test('reads the input as nelm does', (t) => {
    const dir = makeChartDir(t, {
        'chart.mjs': `import {render} from '@nelm/chart-ts-sdk';\nawait render(($) => ({manifests: [$.Values]}));\n`,
        'input.yaml': `Values:
  octal: 0755
  octalO: 0o755
  notOctal: 08
  hex: 0X1F
  underscores: 1_000
  exponent: 1e3
  time: 12:30
  date: 2024-01-01
  dateTime: 2024-01-01T10:00:00Z
  quoted: "0755"
  yes: yes
  off: off
  answer: n
  tilde: ~
  base: &base {a: 1, b: 2}
  merged:
    <<: *base
    b: 3
  duplicate: 1
  duplicate: 2
`,
    });

    const result = run(dir, ['chart.mjs', '--input-file', 'input.yaml', '--output-file', 'output.yaml']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(load(readFileSync(join(dir, 'output.yaml'), 'utf8')), {
        octal: 493,
        octalO: 493,
        notOctal: 8,
        hex: 31,
        underscores: 1000,
        exponent: 1000,
        time: '12:30',
        date: '2024-01-01',
        dateTime: '2024-01-01T10:00:00Z',
        quoted: '0755',
        true: true,
        false: false,
        answer: false,
        tilde: null,
        base: {a: 1, b: 2},
        merged: {a: 1, b: 3},
        duplicate: 2,
    });
});
