"use strict";

const UI = activate require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const { Bytes } = require("@syndicate-lang/core");
const { WSServer, ToServer, FromServer, ServerConnected } = activate require("./client");
const P = activate require("./internal_protocol");

const Federation = require("./federation");

assertion type DetectedOverlay(scope);
assertion type AddressMap(from, nodeId, to);
assertion type OverlayLink(downNode, upNode);
assertion type OverlayNode(id);
assertion type OverlayRoot();

assertion type DisplayingNode(nodeDescription);

spawn {
  const ui = new UI.Anchor();
  assert ui.html('body',
                 <div id="main">
                 <h1>Server monitor</h1>
                 <h2>Local scopes</h2>
                 <div id="scopes"></div>
                 <h2>Federation</h2>
                 <div id="federated_scopes"></div>
                 <h2>Overlays</h2>
                 <div id="overlays"></div>
                 </div>);

  const url = (function () {
    const u = new URL(document.location);
    u.protocol = u.protocol.replace(/^http/, 'ws');
    u.pathname = '/';
    return u.toString();
  })();
  const addr = WSServer(url, "monitor");

  during ServerConnected(addr) {
    during FromServer(addr, P.POAScope(_, $scope)) {
      const ui = new UI.Anchor();
      assert ui.html('#scopes',
                     <div class={`scope_${scope}`}>
                       <p>Scope: <tt>{scope}</tt></p>
                       <ul></ul>
                     </div>);
      during FromServer(addr, P.POAScope($id, scope)) {
        const ui = new UI.Anchor();
        assert ui.html(`#scopes div.scope_${scope} ul`,
                       <li>{id.toString()} <button class="disconnect">Disconnect</button></li>);
        on message UI.UIEvent(ui.fragmentId, 'button.disconnect', 'click', _) {
          send ToServer(addr, P.Disconnect(id));
        }
      }
    }

    during FromServer(addr, Federation.ManagementScope($scope)) {
      const addr = WSServer(url, scope);
      during ServerConnected(addr) {
        const ui = new UI.Anchor();
        assert ui.html('#federated_scopes',
                       <div class={`fs_${scope}`}>
                       <p>Management scope <tt>{scope}</tt></p>
                       <ul></ul>
                       </div>);
        during FromServer(addr, P.FederatedLink($id, $federatedScope)) {
          assert DetectedOverlay(federatedScope);
          const ui = new UI.Anchor();
          assert ui.html(`#federated_scopes div.fs_${scope} ul`,
                         <li>FederatedLink:
                         <span> session <tt>{id.toString()}</tt></span>
                         <span> scope <tt>{federatedScope.toString()}</tt></span>
                         </li>);
        }
      }
    }

    during DetectedOverlay($scope) {
      const addr = WSServer(url, scope);
      during ServerConnected(addr) {
        const ui = new UI.Anchor();
        assert ui.html('#overlays',
                       <div class={`o_${scope}`}>
                       <p>Overlay <tt>{scope}</tt></p>
                       <ul class="root"></ul>
                       <ul class="vaddrs"></ul>
                       </div>);
        assert DisplayingNode(OverlayRoot());
        const nodeName = (n) => {
          if (OverlayNode.isClassOf(n)) return "node_" + Bytes.from(OverlayNode._id(n)).toHex();
          return "root";
        };
        during FromServer(addr, $item(OverlayLink($down, $up))) {
          console.log(down.toString(), 'waiting for', up.toString());
          during DisplayingNode(up) {
          console.log(down.toString(), 'sees', up.toString());
            const ui = new UI.Anchor();
            assert ui.html(`#overlays div.o_${scope} ul.${nodeName(up)}`,
                           <li><tt>{down.toString()}</tt><ul class={nodeName(down)}></ul></li>);
            assert DisplayingNode(down);
          }
        }
        during FromServer(addr, $item(AddressMap(_, _, _))) {
          const ui = new UI.Anchor();
          assert ui.html(`#overlays div.o_${scope} ul.vaddrs`,
                         <li><tt>{item && item.toString()}</tt></li>);
        }
      }
    }
  }
}
