import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';

function distfile(insertion) {
  const f = `syndicate${insertion}.js`;
  return `dist/${f}`;
}

function umd(insertion, extra) {
  return {
    file: distfile(insertion),
    format: 'umd',
    name: 'Syndicate',
    globals: {
      'crypto': 'crypto',
    },
    ... (extra || {})
  };
}

function es6(insertion, extra) {
  return {
    file: distfile('.es6' + insertion),
    format: 'es',
    ... (extra || {})
  };
}

export default [
  {
    input: 'lib/index.js',
    plugins: [
      resolve({
        preferBuiltins: false,
      }),
    ],
    output: [
      umd(''),
      umd('.min', { plugins: [terser()] }),
    ],
  }, {
    input: 'lib/index.js',
    plugins: [
      resolve({
        moduleDirectories: ['stubs', 'node_modules'],
        preferBuiltins: false,
      }),
    ],
    output: [
      es6(''),
      es6('.min', { plugins: [terser()] }),
    ],
  }
];
