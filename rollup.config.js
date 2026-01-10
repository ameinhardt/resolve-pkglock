import { builtinModules } from 'node:module';
import PluginCommonJs from '@rollup/plugin-commonjs';
import PluginNodeResolve from '@rollup/plugin-node-resolve';
import Typescript from '@rollup/plugin-typescript';
import { defineConfig } from 'rollup';

export default defineConfig({
  external: [...builtinModules.flatMap((p) => [p, `node:${p}`])],
  input: './src/index.ts',
  output: {
    dir: './dist',
    format: 'esm',
    sourcemap: true
  },
  plugins: [Typescript(), PluginCommonJs(), PluginNodeResolve({
    preferBuiltins: true
  })]
});
