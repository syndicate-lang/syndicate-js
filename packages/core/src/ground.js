"use strict";

if (require('preserves/src/singletonmodule.js')('syndicate-lang.org/syndicate-js',
                                                require('../package.json').version,
                                                require('path').basename(module.filename),
                                                module)) return;

const Immutable = require('immutable');
const Dataspace = require('./dataspace.js').Dataspace;
const Worker = require('./worker');

function Ground(bootProc) {
  Dataspace.call(this, bootProc);
  this.stepperId = null;
  this.stepping = false;
  this.startingFuel = 1000;
  this.stopHandlers = [];
  this.backgroundTaskCount = 0;
  if (typeof window !== 'undefined') {
    window._ground = this;
  }
}
Ground.prototype = new Dataspace(null);

Ground._resolved = Promise.resolve();
Ground.laterCall = function (thunk) {
  Ground._resolved.then(() => {
    Error.stackTraceLimit = 100;
    try {
      thunk();
    } catch (e) {
      console.error("SYNDICATE/JS INTERNAL ERROR", e);
    }
  });
};

Ground.prototype.backgroundTask = function (k) {
  const ground = this;
  let active = true;
  ground.backgroundTaskCount++;
  function finish() {
    if (active) {
      ground.backgroundTaskCount--;
      active = false;
    }
  }
  return k ? k(finish) : finish;
};

Ground.prototype.start = function () {
  if (!this.stepperId) {
    this.stepperId = Ground.laterCall(() => {
      this.stepperId = null;
      this._step();
    });
  }
  return this; // allows chaining start() immediately after construction
};

Ground.prototype.ground = function () {
  return this;
};

Ground.prototype._step = function () {
  this.stepping = true;
  try {
    let stillBusy = false;
    for (var fuel = this.startingFuel; fuel > 0; fuel--) {
      stillBusy = this.runScripts();
      if (!stillBusy) break;
    }
    if (stillBusy) {
      this.start();
    } else {
      if (!this.backgroundTaskCount) {
        this.stopHandlers.forEach((h) => h());
        this.stopHandlers = [];
      }
    }
  } finally {
    this.stepping = false;
  }
};

Ground.prototype.stop = function () {
  if (this.stepperId) {
    clearTimeout(this.stepperId);
    this.stepperId = null;
  }
};

Ground.prototype.addStopHandler = function (h) {
  this.stopHandlers.push(h);
};

function bootModule(mod, k) {
  let g = new Ground(() => {
    Worker.spawnWorkerRelay();
    if (Dataspace.BootSteps in mod) {
      // It's really an exports dict, not a module.
      Dataspace.activate(mod);
    } else if ('exports' in mod) {
      // It's probably a module.
      Dataspace.activate(mod.exports);
    } else {
      const e = new Error("Cannot boot Syndicate module");
      e.irritant = mod;
      throw e;
    }
  });
  if (typeof document !== 'undefined') {
    document.addEventListener("DOMContentLoaded", (e) => {
      g.start();
      if (k) k(g);
    });
  } else {
    process.on('SIGQUIT', () => {
      console.log('---------------------------------------------------------------------------');
      console.log(g._debugString());

      g._dotGraph();
      // const child_process = require('child_process');
      // const sp = child_process.spawn('dotpreview.sh 100% neato', {
      //   shell: true,
      //   stdio: ['pipe', 'ignore', 'ignore']
      // });
      // sp.stdin.end(g._dotGraph());
    });
    g.start();
    if (k) k(g);
  }
}

module.exports.Ground = Ground;
module.exports.bootModule = bootModule;
