//---------------------------------------------------------------------------
// @syndicate-lang/driver-udp-node, UDP support for Syndicate/js
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

import { currentFacet, Observe, Dataspace } from "@syndicate-lang/core";
import { createSocket } from "dgram";

const { sleep } = activate require("@syndicate-lang/driver-timer");

assertion type UdpPeer(host, port); // A remote peer
assertion type UdpHandle(id);       // A local "anonymous" UDP socket
assertion type UdpListener(port);   // A local bound UDP socket

assertion type UdpMulticastGroupMember(localAddress, groupAddress, interfaceName);
assertion type UdpMulticastLoopback(localAddress, enabled);

message type UdpPacket(source, destination, payload);

export {
  UdpPeer, UdpHandle, UdpListener,
  UdpMulticastGroupMember,
  UdpMulticastLoopback,
  UdpPacket,
};

spawn named 'UdpDriver' {
  during Observe($addr(UdpListener($port))) spawn named ['UdpListener', port] {
    _socket.call(this, addr, port);
  }
  during Observe($addr(UdpHandle($id))) spawn named ['UdpHandle', id] {
    _socket.call(this, addr, 0);
  }
}

function _socket(addr, port) {
  const facet = currentFacet();

  let finish = Dataspace.backgroundTask();
  on stop finish();

  let socket = null;
  field this.connected = false;

  const connect = () => {
    disconnect();
    socket = createSocket({ type: "udp4", reuseAddr: true });
    if (port) {
      socket.bind(port);
    }

    socket.on('error', Dataspace.wrapExternal((e) => {
      console.error('UdpSocket', addr, e.message);
      disconnect();
      sleep(1000, connect);
    }));

    socket.on('listening', Dataspace.wrapExternal(() => { this.connected = true; }));
    socket.on('message', Dataspace.wrapExternal((message, rinfo) => {
      ^ UdpPacket(UdpPeer(rinfo.address, rinfo.port), addr, message);
    }));
  };

  const disconnect = () => {
    if (socket) {
      try { socket.close(); } catch (_e) { console.error('Closing', addr, _e); }
      socket = null;
    }
    this.connected = false;
  };

  on start connect();
  on stop disconnect();

  assert addr when (this.connected);

  on message UdpPacket(addr, UdpPeer($host, $port), $payload) {
    socket.send(payload, 0, payload.length, port, host, Dataspace.wrapExternal((err) => {
      if (err) {
        console.error(err);
      }
    }));
  }

  during UdpMulticastGroupMember(addr, $group, $ifName) {
    on (this.connected) {
      socket.addMembership(group, ifName || (void 0));
    }
    on stop {
      if (socket) {
        socket.dropMembership(group, ifName || (void 0));
      }
    }
  }

  during UdpMulticastLoopback(addr, $enabled) {
    on (this.connected) {
      socket.setMulticastLoopback(enabled);
    }
  }
}
