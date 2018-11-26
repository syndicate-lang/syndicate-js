//---------------------------------------------------------------------------
// @syndicate-lang/driver-streams-node, Stream support for Syndicate/js
// Copyright (C) 2016-2018 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
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

import { currentFacet, Observe, Dataspace, genUuid, Bytes } from "@syndicate-lang/core";
const S = activate require("./streams");
const child_process = require('child_process');

assertion type Subprocess(id, command, args, options);
message type SubprocessError(id, err);

assertion type SubprocessRunning(id, pid, stdio);
assertion type SubprocessExit(id, code, signal);

message type SubprocessKill(id, signal); // also on frame teardown

export {
  Subprocess, SubprocessError,
  SubprocessRunning, SubprocessExit,
  SubprocessKill,
};

spawn named 'driver/Subprocess' {
  during Subprocess($id, $command, $args, $options) spawn named ['Subprocess', id] {
    const sp = child_process.spawn(command, args.toJS(), options ? options.toJS() : void 0);

    const stdio = sp.stdio.map((s, i) => {
      if (s !== null) {
        const fd = genUuid('fd');
        if (s.readable && s.writable) {
          on start react S.duplexStreamBehaviour(fd, s);
        } else if (s.readable) {
          on start react S.readableStreamBehaviour(fd, s);
        } else if (s.writable) {
          on start react S.writableStreamBehaviour(fd, s);
        }
        return fd;
      } else {
        return null;
      }
    });

    field this.isRunning = null;

    on stop if (this.isRunning !== false) sp.kill('SIGKILL');

    assert SubprocessRunning(id, sp.pid, stdio) when (this.isRunning === true);

    sp.on('exit', Dataspace.wrapExternal((code, signal) => {
      this.isRunning = false;
      react assert SubprocessExit(id, code, signal);
    }));

    sp.on('error', Dataspace.wrapExternal((err) => {
      this.isRunning = false;
      send SubprocessError(id, err);
      currentFacet().stop();
    }));

    process.nextTick(Dataspace.wrapExternal(() => {
      if (this.isRunning === null) {
        this.isRunning = true;
      }
    }));

    on message SubprocessKill(id, $signal) {
      if (this.isRunning !== false) {
        this.isRunning = false;
        sp.kill(signal);
      }
    }
  }
}
