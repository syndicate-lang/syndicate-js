const {Command, flags} = require('@oclif/command')
const path = require('path');
const fs = require('fs');
const unzip = require('unzip');

class SyndicateLangCreateCommand extends Command {
  async run() {
    const { args, flags} = this.parse(SyndicateLangCreateCommand)
    const directory = path.resolve(args.directory);
    const packageName = flags.package || path.basename(directory);
    console.log(`Will create package ${packageName} in ${directory}.`);
    fs.mkdir(directory, { recursive: true }, (err) => {
      if (err) throw err;
      fs.createReadStream(path.join(__dirname, 'syndicate-template.zip')).pipe(
        unzip.Extract({ path: directory }).on('close', (err) => {
          if (err) throw err;
          const packageJsonPath = path.join(directory, 'package.json');
          const p = Object.assign({
            name: packageName,
          }, require(packageJsonPath));
          fs.writeFile(packageJsonPath, JSON.stringify(p, null, 2), (err) => {
            if (err) throw err;
          });
        }));
    });
  }
}

SyndicateLangCreateCommand.id = ''; // ???
SyndicateLangCreateCommand.args = [
  { name: 'directory', required: true },
];

SyndicateLangCreateCommand.description = `Create a new Syndicate/js package.`

SyndicateLangCreateCommand.flags = {
  // add --version flag to show CLI version
  version: flags.version({char: 'v'}),
  // add --help flag to show CLI version
  help: flags.help({char: 'h'}),
  package: flags.string({char: 'n', description: 'package name to create'}),
}

module.exports = SyndicateLangCreateCommand
