//---------------------------------------------------------------------------
// @syndicate-lang/syntax-test, a demo of Syndicate extensions to JS.
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

import { currentFacet, genUuid } from "@syndicate-lang/core";

const U = activate require("@syndicate-lang/driver-udp-node");
const { PeriodicTick } = activate require("@syndicate-lang/driver-timer");

const evil = false; // Set true to hijack mDNS's multicast group and port number (!);
                    // Otherwise, set false to use "239.192.57.49", which is in
                    // Organization Local Scope (see RFC 2365), and port 5998.

const GROUP_ADDRESS = evil ? "224.0.0.251" : "239.192.57.49";
const PORT = evil ? 5353 : 5998; // make sure your firewall is open to UDP on this port!

spawn named 'multicast_demo' {
  const HANDLE = U.UdpListener(PORT);
  during HANDLE {
    assert U.UdpMulticastGroupMember(HANDLE, GROUP_ADDRESS, null);
    assert U.UdpMulticastLoopback(HANDLE, true);

    on message U.UdpPacket(U.UdpPeer($host, $port), HANDLE, $body) {
      console.log('Got', body, 'from', host, port);
    }

    on message PeriodicTick(2000) {
      ^ U.UdpPacket(HANDLE, U.UdpPeer(GROUP_ADDRESS, PORT), genUuid('timestamp'));
    }
  }
}
