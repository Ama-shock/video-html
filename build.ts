import { build, context } from 'esbuild';

build({
    entryPoints: [
        './src/main.ts'
    ],
    bundle: true,
    outfile: './docs/main.js',
    minify: false,
    sourcemap: true
});