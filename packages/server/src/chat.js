"use strict";

const UI = activate require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

const { WSServer, ToServer, FromServer, ServerConnected } = activate require("./client");

assertion type Present(name);
assertion type Says(who, what);

spawn {
  // These lines effectively preventDefault the corresponding events:
  on message UI.GlobalEvent('#chat_form', 'submit', _) {}
  on message UI.GlobalEvent('#nym_form', 'submit', _) {}

  field this.nym;
  on asserted UI.UIChangeableProperty('#nym', 'value', $v) {
    if (!v) {
      v = randomName();
      send UI.SetProperty('#nym', 'value', v);
    }
    this.nym = v;
  }

  field this.next_chat = '';
  on asserted UI.UIChangeableProperty('#chat_input', 'value', $v) this.next_chat = v;

  const ui = new UI.Anchor();

  during UI.UIChangeableProperty('#wsurl', 'value', $url) {
    const addr = WSServer(url, "broker");
    during ServerConnected(addr) {
      on start outputItem(<span class="connected">connected to {addr}</span>,
                          'state_connected');
      on stop outputItem(<span class="disconnected">disconnected from {addr}</span>,
                         'state_disconnected');

      assert ToServer(addr, Present(this.nym));
      during FromServer(addr, Present($who)) {
        assert ui.context(who).html('#nymlist', <li><span class="nym">{who}</span></li>);
      }

      on message UI.GlobalEvent('#send_chat', 'click', _) {
        if (this.next_chat) send ToServer(addr, Says(this.nym, this.next_chat));
        send UI.SetProperty('#chat_input', 'value', '');
      }

      on message FromServer(addr, Says($who, $what)) {
        outputItem(<span class="utterance">
                   <span class="nym">{who}</span><span class="utterance">{what}</span>
                   </span>);
      }

      // on message Syndicate.WakeDetector.wakeEvent() {
      //   :: forceServerDisconnect(addr);
      // }
    }
  }
}

function outputItem(item, klass) {
  var o = document.getElementById('chat_output');
  o.appendChild(UI.htmlToNode(<div class={klass || ''}>
                              <span class="timestamp">{(new Date()).toGMTString()}</span>
                              {item}
                              </div>));
  o.scrollTop = o.scrollHeight;
}

///////////////////////////////////////////////////////////////////////////

// Courtesy of http://listofrandomnames.com/ :-)
const names = ['Lisa', 'Wally', 'Rivka', 'Willie', 'Marget', 'Roma', 'Aron', 'Shakita', 'Lean',
               'Carson', 'Walter', 'Lan', 'Cari', 'Fredrick', 'Audra', 'Luvenia', 'Wilda', 'Raul',
               'Latia', 'Shalanda', 'Samira', 'Deshawn', 'Kerstin', 'Mina', 'Sunni', 'Bev',
               'Chrystal', 'Chad', 'Shaunte', 'Shonna', 'Georgann', 'Von', 'Dorothea', 'Janette',
               'Krysta', 'Graig', 'Jeromy', 'Corine', 'Lue', 'Xuan', 'Kesha', 'Reyes', 'Nichol',
               'Easter', 'Stephany', 'Kimber', 'Rosette', 'Onita', 'Aliza', 'Clementine'];

function randomName() {
  return names[Math.floor(Math.random() * names.length)] +
    '_' + Math.floor(Math.random() * 990 + 10);
}
