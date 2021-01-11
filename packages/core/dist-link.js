import * as fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

for (let f of fs.readdirSync('dist')) {
  const prefix = `syndicate-${pkg.version}`;
  if (f.startsWith(prefix)) {
    const linkname = `dist/syndicate${f.substring(prefix.length)}`;
    try {
      fs.unlinkSync(linkname);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    fs.symlinkSync(f, linkname);
  }
}
