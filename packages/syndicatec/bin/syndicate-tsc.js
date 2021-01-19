#!/usr/bin/env node
try {
  require('../lib/tsc.js').main(process.argv.slice(2));
} catch (e) {
  console.error(e);
  process.exit(1);
}
