"use strict";

const UI = activate require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const { ToBroker, FromBroker, BrokerConnected } = activate require("./client");

assertion type ConnectionName(scope, id);
assertion type Connection(connId);
message type Disconnect(connId);

spawn {
  const ui = new UI.Anchor();
  assert ui.html('body',
                 <div id="main">
                   <h1>Broker monitor</h1>
                   <div id="scopes"></div>
                 </div>);

  const url = (function () {
    const u = new URL(document.location);
    u.protocol = u.protocol.replace(/^http/, 'ws');
    u.pathname = '/monitor';
    return u.toString();
  })();

  during BrokerConnected(url) {
    during FromBroker(url, Connection(ConnectionName($scope, _))) {
      const ui = new UI.Anchor();
      assert ui.html('#scopes',
                     <div class={`scope_${scope}`}>
                       <p>Scope: <tt>{scope}</tt></p>
                       <ul></ul>
                     </div>);
      during FromBroker(url, Connection(ConnectionName(scope, $id))) {
        const ui = new UI.Anchor();
        assert ui.html(`#scopes div.scope_${scope} ul`,
                       <li>{id.toString()} <button class="disconnect">Disconnect</button></li>);
        on message UI.UIEvent(ui.fragmentId, 'button.disconnect', 'click', _) {
          send ToBroker(url, Disconnect(ConnectionName(scope, id)));
        }
      }
    }
  }
}
