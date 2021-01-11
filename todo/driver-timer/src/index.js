//---------------------------------------------------------------------------
// @syndicate-lang/driver-timer, a Syndicate driver for time-related events.
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

import { Observe, Dataspace, Float } from "@syndicate-lang/core";

export { PeriodicTick, TimeLaterThan };

message type PeriodicTick(intervalMS);
assertion type TimeLaterThan(deadlineMS);

export function sleep(ms, cb) {
  react {
    stop on asserted TimeLaterThan(+(new Date()) + ms) {
      cb();
    }
  }
}

spawn named 'driver-timer/PeriodicTick' {
  during Observe(PeriodicTick($intervalMS)) spawn named ('PeriodicTick('+intervalMS+')') {
    let handle = null;
    let finish = Dataspace.backgroundTask();
    on start {
      handle = setInterval(Dataspace.wrapExternal(() => { send PeriodicTick(intervalMS); }),
                           Float.unwrap(intervalMS));
    }
    on stop {
      if (handle) {
        clearInterval(handle);
        handle = null;
      }
      if (finish) {
        finish();
        finish = null;
      }
    }
  }
}

spawn named 'driver-timer/TimeLaterThan' {
  during Observe(TimeLaterThan($deadlineMS)) spawn named ('TimeLaterThan('+deadlineMS+')') {
    let handle = null;
    let finish = Dataspace.backgroundTask();
    on start {
      let delta = Float.unwrap(deadlineMS) - (+(new Date()));
      handle = setTimeout(Dataspace.wrapExternal(() => {
        handle = null;
        finish();
        finish = null;
        react {
          assert TimeLaterThan(deadlineMS);
        }
      }), delta);
    }
    on stop {
      if (handle) {
        clearTimeout(handle);
        handle = null;
      }
      if (finish) {
        finish();
        finish = null;
      }
    }
  }
}
