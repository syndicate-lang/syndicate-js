//---------------------------------------------------------------------------
// @syndicate-lang/core, an implementation of Syndicate dataspaces for JS.
// Copyright (C) 2016-2021 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//---------------------------------------------------------------------------

import { Dataspace, Script } from './dataspace.js';

export type StopHandler<D extends Dataspace> = (ds: D) => void;

declare global {
    interface Window {
        _ground: Ground;
    }
}

const _resolved = Promise.resolve();

export class Ground extends Dataspace {
    stepScheduled = false;
    stepping = false;
    startingFuel: number = 1000;
    stopHandlers: Array<StopHandler<this>> = [];
    backgroundTaskCount = 0;

    constructor(bootProc: Script) {
        super(function () { Dataspace.currentFacet.addStartScript(bootProc); });
        if (typeof window !== 'undefined') {
            window._ground = this;
        }
    }

    static async laterCall(thunk: () => void): Promise<void> {
        await _resolved;
        if ('stackTraceLimit' in Error) {
            (Error as any).stackTraceLimit = 100;
        }
        try {
            thunk();
        } catch (e) {
            console.error("SYNDICATE/JS INTERNAL ERROR", e);
        }
    }

    backgroundTask(): () => void {
        let active = true;
        this.backgroundTaskCount++;
        return () => {
            if (active) {
                this.backgroundTaskCount--;
                active = false;
            }
        };
    }

    start(): this {
        if (!this.stepScheduled) {
            Ground.laterCall(() => {
                this.stepScheduled = false;
                this._step();
            });
        }
        return this; // allows chaining start() immediately after construction
    }

    ground(): Ground {
        return this;
    }

    _step() {
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
                    this.stopHandlers.forEach((h) => h(this));
                    this.stopHandlers = [];
                }
            }
        } finally {
            this.stepping = false;
        }
    }

    addStopHandler(h: StopHandler<this>): this {
        this.stopHandlers.push(h);
        return this;
    }
}

  // let g = new Ground(() => {
  //   Worker.spawnWorkerRelay();
  // });
  // if (typeof document !== 'undefined') {
  //   document.addEventListener("DOMContentLoaded", () => {
  //     g.start();
  //     if (k) k(g);
  //   });
  // } else {
  //   g.start();
  //   if (k) k(g);
  // }

