import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts'
  },
  format: ['cjs'],
  target: 'node18',
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  shims: false,
  banner: {
    js: '#!/usr/bin/env node'
  }
});
