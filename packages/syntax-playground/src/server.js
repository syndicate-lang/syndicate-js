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

const UI = require("@syndicate-lang/driver-browser-ui");
// @jsx UI.html
// @jsxFrag UI.htmlFragment

import { currentFacet, genUuid } from "@syndicate-lang/core";

const Http = activate require("@syndicate-lang/driver-http-node");

const server = Http.HttpServer(null, 8080);

assertion type Counter(id);

function counter() {
  const id = genUuid();
  spawn named ['counter', id] {
    const rootFacet = currentFacet();

    assert Counter(id);

    field this.counter = 0;
    during Http.Request($reqId, server, 'get', ['counter', id], _, _) {
      assert :snapshot Http.Response(
        reqId, 200, "OK", {"Content-type": "text/html"},
        '<!DOCTYPE html>' + UI.htmlToString(
          <div>
            <p>The current value of counter <tt>{id}</tt> is {this.counter}.</p>
            <ul>
              <li><a href={"/counter/"+id+"/inc"}>Increment</a></li>
              <li><a href={"/counter/"+id+"/dec"}>Decrement</a></li>
              <li><a href={"/counter/"+id+"/delete"}>Delete</a></li>
            </ul>
            <p><a href="/">Back to counter list.</a></p>
          </div>
        ));
    }

    during Http.Request($reqId, server, 'get', ['counter', id, 'inc'], _, _) {
      on start this.counter++;
      assert :snapshot Http.Response(
        reqId, 303, "See other", {"Location": "/counter/" + id}, "");
    }

    during Http.Request($reqId, server, 'get', ['counter', id, 'dec'], _, _) {
      on start this.counter--;
      assert :snapshot Http.Response(
        reqId, 303, "See other", {"Location": "/counter/" + id}, "");
    }

    during Http.Request($reqId, server, 'get', ['counter', id, 'delete'], _, _) {
      on stop { rootFacet.stop(); }
      assert :snapshot Http.Response(
        reqId, 303, "See other", {"Location": "/"}, "");
    }
  }
  return id;
}

spawn named 'rootServer' {
  let counters = {};
  on asserted Counter($id) counters[id] = true;
  on retracted Counter($id) delete counters[id];

  during Http.Request($reqId, server, 'get', [], _, _) {
    const es = [];
    for (let id in counters) {
      es.push(<li><a href={"/counter/"+id}>{id}</a></li>);
    }

    assert :snapshot Http.Response(
      reqId, 200, "OK", {"Content-type": "text/html"},
      '<!DOCTYPE html>' + UI.htmlToString(
        <div>
          <p>Available counters:</p>
          <ul>{es}</ul>
          <p><a href="/new">New counter</a></p>
        </div>
      ));
  }

  during Http.Request($reqId, server, 'get', ['new'], _, _) {
    assert :snapshot Http.Response(
      reqId, 303, "See other", {"Location": "/counter/" + counter()}, "");
  }
}

spawn named 'greetingServer' {
  during Http.Request($reqId, server, 'get', ['hello', $name], _, _) {
    assert Http.Response(reqId, 200, "OK", {"Content-type": "text/plain"}, "Hello, "+name+"!");
  }

  during Http.Request($reqId, server, 'get', ['hello'], $query, _) {
    assert Http.Response(reqId, 200, "OK", {"Content-type": "text/plain"},
                         "Hello, "+query.get('name')+"!");
  }
}

spawn named 'websocketEchoServer' {
  during Http.WebSocket($reqId, server, ['echo'], _) {
    on message Http.RequestData(reqId, $message) {
      console.log('got', reqId, message);
      ^ Http.ResponseData(reqId, message);
    }

    stop on message Http.RequestData(reqId, "quit");
  }
}
