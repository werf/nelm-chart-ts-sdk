import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const inputYaml = `Release:
  Name: my-release
  Namespace: my-namespace
Values:
  replicas: 2
`;

// Creates a temporary chart `ts/` directory with the SDK linked into node_modules.
export function makeChartDir(t, files) {
    const dir = mkdtempSync(join(tmpdir(), 'nelm-chart-ts-test-'));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    mkdirSync(join(dir, 'node_modules', '@nelm'), {recursive: true});
    symlinkSync(sdkRoot, join(dir, 'node_modules', '@nelm', 'chart-ts-sdk'), 'dir');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({type: 'module', private: true}));
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), {recursive: true});
        writeFileSync(join(dir, path), content);
    }
    return dir;
}

export function run(cwd, args, env = process.env) {
    return spawnSync(process.execPath, args, {cwd, env, encoding: 'utf8'});
}
