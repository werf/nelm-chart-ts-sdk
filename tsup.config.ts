import {defineConfig} from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/cli.ts'],
    format: ['esm'],
    clean: true,
    dts: {entry: 'src/index.ts'},
    // Keep `node:` specifiers: they are the only external imports allowed in a chart bundle.
    removeNodeProtocol: false,
});
