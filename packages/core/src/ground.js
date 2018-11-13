"use strict";

const Immutable = require('immutable');
const Dataspace = require('./dataspace.js').Dataspace;

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
  Ground._resolved.then(thunk);
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

function bootModule(mod) {
  let g = new Ground(() => {
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
    document.addEventListener("DOMContentLoaded", (e) => { g.start(); });
  } else {
    g.start();
  }
}

module.exports.Ground = Ground;
module.exports.bootModule = bootModule;
