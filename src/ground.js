"use strict";

const Immutable = require('immutable');
const Dataspace = require('./dataspace.js').Dataspace;

function Ground(bootProc) {
  this.stepperId = null;
  this.stepping = false;
  this.startingFuel = 1000;
  this.dataspace = new Dataspace(bootProc);
  this.stopHandler = function () {};
}

Ground.prototype.start = function () {
  if (!this.stepperId) {
    this.stepperId = setTimeout(() => {
      this.stepperId = null;
      this._step();
    }, 0);
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
      if (this.stopHandler) {
        this.stopHandler(this);
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

module.exports.Ground = Ground;
