"use strict";

const UI = activate require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const { WSServer, ToServer, FromServer, ServerConnected } = activate require("./client");
const P = activate require("./internal_protocol");

const Federation = require("./federation");

assertion type DetectedOverlay(scope);
assertion type AddressMap(from, nodeId, to);

spawn {
  const ui = new UI.Anchor();
  assert ui.html('body',
                 <div id="main">
                 <h1>Server monitor</h1>
                 <h2>Local scopes</h2>
                 <div id="scopes"></div>
                 <h2>Federated scopes</h2>
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
                         <li>FederatedLink: session <tt>{id.toString()}</tt>
                         scope <tt>{federatedScope.toString()}</tt></li>);
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
                       <ul></ul>
                       </div>);
        during FromServer(addr, $item(AddressMap(_, _, _))) {
          const ui = new UI.Anchor();
          assert ui.html(`#overlays div.o_${scope} ul`,
                         <li><tt>{item && item.toString()}</tt></li>);
        }
      }
    }
  }
}
