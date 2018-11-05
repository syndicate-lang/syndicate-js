# Syndicate/js

A new, efficient implementation of Syndicate for JavaScript in both
node.js and the browser. The implementation techniques herein are the
subject of a forthcoming paper.

## Creating a new Syndicate/js project

Create a skeletal `package.json`:

    {
      "main": "lib/index.js",
      "scripts": {
        "build": "npx syndicate-babel src --out-dir lib",
        "clean": "rm -rf lib"
      }
    }

The entry point will be `lib/index.js`; the corresponding *source*
file will be `src/index.js`.

Two `npm run` scripts are defined: one which compiles Syndicate/js
source files in `src` to plain JavaScript in `lib`. The compiler uses
Babel; we will configure Babel next.

Create a `.babelrc` file:

    {
      "presets": [ "@babel/preset-env" ],
      "plugins": [ "@syndicate-lang/syntax/plugin" ]
    }

Now, install the necessary dependencies. Babel and the Syndicate/js
extensions are needed at build-time:

    npm i --save-dev @syndicate-lang/syntax @babel/preset-env

The Syndicate/js runtime and as many drivers as you would like to use
are needed at run-time:

    npm i --save @syndicate-lang/core
    npm i --save @syndicate-lang/driver-timer

Finally, create the main program file. Create a directory `src`, and
then a file `src/index.js`:

    const { TimeLaterThan } = activate require("@syndicate-lang/driver-timer");

    spawn named 'ticker' {
      field this.counter = 0;
      field this.deadline = +(new Date());

      on start { console.log('ticker starting'); }
      on stop  { console.log('ticker stopping'); }

      on asserted TimeLaterThan(this.deadline) {
        this.counter++;
        console.log('tick', new Date(), this.counter);
        this.deadline += 1000;
      }

      stop on (this.counter == 5);
    }

Now, compile the project:

    npm run build

Finally, run the program:

    node lib/index.js

The output should be something like:

    ticker starting
    tick 2018-11-05T14:23:27.713Z 1
    tick 2018-11-05T14:23:28.705Z 2
    tick 2018-11-05T14:23:29.706Z 3
    tick 2018-11-05T14:23:30.706Z 4
    tick 2018-11-05T14:23:31.707Z 5
    ticker stopping

## Licence

@syndicate-lang, an implementation of Syndicate for JS.  
Copyright (C) 2016-2018 Tony Garnock-Jones <tonyg@leastfixedpoint.com>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
