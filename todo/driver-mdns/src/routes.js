//---------------------------------------------------------------------------
// @syndicate-lang/driver-mdns, mDNS support for Syndicate.
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

const { Observe } = require("@syndicate-lang/core");
const { PeriodicTick } = activate require("@syndicate-lang/driver-timer");
const fs = require('fs');

assertion type Route(ifName, destIP, destMaskBits, gateway, flags) = Symbol.for('network-route');
assertion type DefaultGateway(ifName, gateway) = Symbol.for('network-default-gateway');

assertion type ScanRoutingTable() = Symbol.for('-@syndicate-lang/driver-mdns/scan-routing-table-');

export {
  Route, DefaultGateway,
};

const flags = {
  // From linux/route.h
  UP:        0x0001,            /* route usable                 */
  GATEWAY:   0x0002,            /* destination is a gateway     */
  HOST:      0x0004,            /* host entry (net otherwise)   */
  REINSTATE: 0x0008,            /* reinstate route after tmout  */
  DYNAMIC:   0x0010,            /* created dyn. (by redirect)   */
  MODIFIED:  0x0020,            /* modified dyn. (by redirect)  */
  MTU:       0x0040,            /* specific MTU for this route  */
  WINDOW:    0x0080,            /* per route window clamping    */
  IRTT:      0x0100,            /* Initial round trip time      */
  REJECT:    0x0200,            /* Reject route                 */
};

spawn named 'IPRouteDatabase' {
  during Observe(Route(_, _, _, _, _)) assert ScanRoutingTable();
  during Observe(DefaultGateway(_, _)) assert ScanRoutingTable();

  during ScanRoutingTable() {
    const refresh = () => {
      const rows = fs.readFileSync('/proc/net/route').toString('utf-8')
            .split('\n')
            .filter((x) => x)
            .map((x) => x.split('\t').map((f) => f.trim()));
      const headings = rows.shift();
      const data = rows.map((row) => {
        const rec = {};
        headings.forEach((heading, i) => { rec[heading] = row[i] || ''; });
        return rec;
      });
      react {
        stop on message PeriodicTick(5000) refresh();
        data.forEach((rec) => {
          const destnet = littleEndianHex(rec.Destination);
          const destmask = 32 - countZeroBits(littleEndianHex(rec.Mask));
          const gateway = littleEndianHex(rec.Gateway);
          assert Route(rec.Iface,
                       intToIPv4(destnet),
                       destmask,
                       intToIPv4(gateway),
                       decodeFlags(Number.parseInt(rec.Flags, 16)));
          if (destnet === 0 && destmask === 0) {
            assert DefaultGateway(rec.Iface, intToIPv4(gateway));
          }
        });
      }
    };

    on start refresh();
  }
}

function littleEndianHex(s) {
  let byteCount = s.length / 2;
  let v = Number.parseInt(s, 16);
  let w = 0;
  while (byteCount--) {
    w *= 256;
    w += (v & 255);
    v >>= 8;
  }
  return w;
}

function decodeFlags(fs) {
  let result = {};
  for (let flagName in flags) {
    if (fs & flags[flagName]) result[flagName] = true;
  }
  return result;
}

function intToIPv4(n) {
  return '' + ((n >> 24) & 255)
    + '.' + ((n >> 16) & 255)
    + '.' + ((n >> 8) & 255)
    + '.' + (n & 255);
}

function countZeroBits(n) {
  if (n === 0) return 32;
  let i = 0;
  while ((n & 1) === 0) {
    i++;
    n >>= 1;
  }
  return i;
}
