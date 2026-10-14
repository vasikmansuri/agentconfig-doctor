import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli/main.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  // tsup's declaration build sets `baseUrl`, which TypeScript 6 deprecates.
  dts: { entry: { index: 'src/index.ts' }, compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: false,
  splitting: true,
  define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
});
