const path = require('path');
const alias = require('@rollup/plugin-alias');
const typescript = require('@rollup/plugin-typescript');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');
const terser = require('@rollup/plugin-terser');
const nodePolyfills = require('rollup-plugin-polyfill-node');
const tscAlias = require('tsc-alias');

module.exports = function (getConfig) {
  let config = getConfig(true);
  const extensions = ['.ts', '.js'];
  config.forEach(v => {
    // just keep the reference for third-party libs
    v.external = ['axios', 'viem', '@ethereumjs/rlp'];
    v.plugins.unshift(
      alias({
        entries: [
          { find: '@/', replacement: path.resolve(__dirname, 'src/') }
        ]
      }),
      nodePolyfills(),
    );
    v.plugins.push(
      {
        name: 'tscAlias',
        async writeBundle() {
          return tscAlias.replaceTscAliasPaths({
            resolveFullPaths: true,
            outDir: './lib'
          });
        },
      },
      {
        name: 'tscAlias',
        async writeBundle() {
          return tscAlias.replaceTscAliasPaths({
            resolveFullPaths: true,
            outDir: './es'
          });
        },
      }
    );
  });

  config = config.filter(v => {
    const outputs = [
      path.resolve(__dirname, 'src/index.ts'),
      path.resolve(__dirname, 'src/api/index.ts'),
      path.resolve(__dirname, 'src/client/index.ts'),
      path.resolve(__dirname, 'src/utils/index.ts'),
    ]

    return outputs.includes(v.input)
  });

  // umd
  config.push({
    input: 'src/index.ts',
    output: {
      file: 'umd/1money-protocol-ts-sdk.min.js',
      format: 'umd',
      name: '$1money',
      exports: 'named',
      compact: true
    },
    plugins: [
      alias({
        entries: [
          { find: '@/', replacement: path.resolve(__dirname, 'src/') }
        ]
      }),
      nodePolyfills(),
      typescript({
        tsconfig: path.resolve(__dirname, 'tsconfig.json'),
        include: ['src/**/*.ts'],
        // tsconfig.json sets `rootDir: "./src"`; without an explicit
        // filterRoot the plugin resolves `include` against rootDir
        // instead of the project root, so the "src/**/*.ts" pattern
        // above would look for a nonexistent "src/src/**/*.ts".
        filterRoot: path.resolve(__dirname),
        compilerOptions: {
          target: 'es2015',
          module: 'ESNext',
          lib: ['es5', 'es6', 'es2015', 'es2016', 'dom'],
          declaration: false,
          outDir: 'umd',
        }
      }),
      nodeResolve({
        extensions,
        preferBuiltins: true,
        browser: true
      }),
      commonjs(),
      json(),
      terser()
    ]
  });

  return config;
}
