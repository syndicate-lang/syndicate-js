"use strict";

const Immutable = require('immutable');
const Dataspace = require('./dataspace.js').Dataspace;

function Ground(bootProc) {
  this.stepperId = null;
  this.stepping = false;
  this.startingFuel = 1000;
  this.dataspace = new Dataspace(this, bootProc);
  this.stopHandlers = [];
  this.backgroundTaskCount = 0;
}

Ground._resolved = Promise.resolve();
Ground.laterCall = function (thunk) {
  Ground._resolved.then(thunk);
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

Ground.prototype._step = function () {
  this.stepping = true;
  try {
    let stillBusy = false;
    for (var fuel = this.startingFuel; fuel > 0; fuel--) {
      stillBusy = this.dataspace.runScripts();
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
    Dataspace.activate(mod.exports);
  });
  if (typeof document !== 'undefined') {
    document.addEventListener("DOMContentLoaded", (e) => { g.start(); });
  } else {
    g.start();
  }
}

module.exports.Ground = Ground;
module.exports.bootModule = bootModule;
