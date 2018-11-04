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

const Http = activate require("@syndicate-lang/driver-http-node");

const server = Http.HttpServer(null, 8080);

spawn named 'rootServer' {
  field this.counter = 0;
  during Http.Request($id, server, 'get', [], _, _) {
    const v = this.counter++;
    assert Http.Response(id, 200, "OK", {"Content-type": "text/plain"}, 'counter is ' + v);
  }
}

spawn named 'greetingServer' {
  during Http.Request($id, server, 'get', ['hello', $name], _, _) {
    assert Http.Response(id, 200, "OK", {"Content-type": "text/plain"}, "Hello, "+name+"!");
  }
}

spawn named 'websocketEchoServer' {
  during Http.WebSocket($id, server, ['echo'], _) {
    on message Http.RequestData(id, $message) {
      console.log('got', id, message);
      ^ Http.ResponseData(id, message);
    }

    stop on message Http.RequestData(id, "quit");
  }
}
