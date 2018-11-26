 - [DONE] `during/spawn`
 - [DONE] `during`
 - [DONE] `let { TimeLaterThan } = activate require("@syndicate-lang/driver-timer");`
 - [DONE] `react`
 - [DONE] `spawn*` or similar - looks like `spawn on start { ... }` will do the trick
 - [DONE] activation
 - [DONE] remove ground dataspace syntax
 - [DONE] `spawn :let childVal = parentCalculation { ... }`
 - [DONE] better autobuilding for smooth and fast dev; babel uses gulp?
 - [DONE] dataspaces, dataspace relays
 - [DONE? Surely there's more] pin down and fix the problems with facet field scope (!!)
 - [DONE] `npm init @syndicate`
 - [DONE] change send syntax from `^ ...` to `send ...` :-(
    - Using `^` is too cute. Indentation doesn't work, and forgetting a semicolon causes silent xor!

 - [DONE] timer driver
 - [DONE] ui driver
 - [DONE] web driver
 - [DONE] tcp driver

 - `defer` statement
 - `define/query`
 - some kind of `stop facet` statement - put a Symbol on the fields blob?

 - other kinds of relay

 - alias wrapExternal to index.js

 - @syndicate-lang/standalone, analogous to @babel/standalone

 - deferTurn should prevent a facet from terminating! This came up in
   some formulations of the game-restart logic in the flappy bird
   demo.

 - driver-streams-node/src/subprocess.js: perhaps figure out some way
   of blocking SIGQUIT, which I'm currently using to get debug output,
   in children, so they don't terminate too?
