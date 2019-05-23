"use strict";

const UI = activate require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const { WSServer, ToServer, FromServer, ServerConnected } = activate require("./client");
const P = activate require("./internal_protocol");

spawn {
  const ui = new UI.Anchor();
  assert ui.html('body',
                 <div id="main">
                   <h1>Server monitor</h1>
                   <div id="scopes"></div>
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
  }
}
