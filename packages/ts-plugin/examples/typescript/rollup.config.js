import sourcemaps from 'rollup-plugin-sourcemaps';

export default {
  input: 'lib/index.js',
  plugins: [sourcemaps()],
  output: {
    file: 'index.js',
    format: 'umd',
    name: 'Main',
    sourcemap: true,
    globals: {
      '@syndicate-lang/core': 'Syndicate',
    },
  },
};
