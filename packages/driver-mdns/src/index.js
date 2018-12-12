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

// TODO: support other than the default (usually ".local") domain.

const { Observe, currentFacet, genUuid } = require("@syndicate-lang/core");
const S = activate require("@syndicate-lang/driver-streams-node");

Object.assign(module.exports, activate require('./routes.js'));

assertion type Service(name, serviceType) = Symbol.for("mdns-service");
assertion type Publish(svc, hostName, port, txtDataRecords) = Symbol.for("mdns-publish");
assertion type Published(svc, hostName, port, txtDataRecords) = Symbol.for("mdns-published");
assertion type Discovered(svc, hostName, port, txtDataRecords, address, family, interfaceName) = Symbol.for("mdns-discovered");

// TODO: nested dataspace to scope these??
message type BrowserInput(subprocessId, fields) = Symbol.for("-mdns-browser-input");
assertion type WildcardBrowserActive() = Symbol.for("-mdns-wildcard-browser-active");

export {
  Service,
  Publish,
  Published,
  Discovered,
};

function unescapeLabel(str) {
  // Per avahi's avahi-common/domain.c's avahi_escape_label:
  return str.replace(
    /\\(\d\d\d|\.|\\)/g, // that is, \NNN in decimal or \. or \\
    function (x) {
      if (x.length === 4) return String.fromCharCode(Number(x.slice(1)));
      // else x.length === 2
      return x[1];
    });
}

spawn named 'driver/avahi-publish' {
  during Observe(Published($svc, $hostName, $port, $txtDataRecords)) {
    assert Publish(svc, hostName, port, txtDataRecords);
  }

  during Publish($svc(Service($name, $serviceType)), $hostName, $port, $txtDataRecords) {
    const topFacet = currentFacet();

    const args = ['-f', '-s'];
    if (hostName !== null) args.push('-H', hostName);
    args.push(name, serviceType, port.toString());
    txtDataRecords.forEach((txt) => args.push(txt));

    const id = genUuid('avahi-publish');
    assert S.Subprocess(id, 'avahi-publish', args, {stdio: ['ignore', 'ignore', 'pipe']});
    stop on message S.SubprocessError(id, $err) {
      console.error("Couldn't start avahi-publish", err);
    }
    stop on asserted S.SubprocessExit(id, $code, _) {
      console.error("Subprocess avahi-publish terminated with code", code);
    }

    on asserted S.SubprocessRunning(id, _, [_, _, $stderr]) {
      react {
        field this.established = false;
        assert Published(svc, hostName, port, txtDataRecords) when (this.established);

        on retracted S.Readable(stderr) topFacet.stop();

        on message S.Line(stderr, $line) {
          line = line.toString('utf-8');
          if (line.startsWith('Established')) {
            this.established = true;
          } else if (line.startsWith('Disconnected')) {
            this.established = false;
          } else if (line.startsWith('Got SIG')) {
            // e.g. "Got SIGTERM, quitting."; ignore.
          } else {
            console.log('avahi-publish', name+':', line);
          }
        }
      }
    }
  }
}

spawn named 'driver/avahi-browse' {
  during Observe(Discovered(Service(_, $serviceType), _, _, _, _, _, _)) {
    const topFacet = currentFacet();

    const args = ['-f', '-r', '-k', '-p'];
    if (typeof serviceType === 'string') {
      args.push(serviceType);
    } else {
      args.push('-a');
    }

    if (typeof serviceType !== 'string') {
      assert WildcardBrowserActive();
    } else {
      stop on asserted WildcardBrowserActive();
    }

    const id = genUuid('avahi-browse');
    assert S.Subprocess(id, 'avahi-browse', args, {stdio: ['ignore', 'pipe', 'ignore']});
    stop on message S.SubprocessError(id, $err) {
      console.error("Couldn't start avahi-browse", err);
    }
    stop on asserted S.SubprocessExit(id, $code, _) {
      if (code !== 0) {
        console.error("Subprocess avahi-browse terminated with code", code);
      }
    }

    on asserted S.SubprocessRunning(id, _, [_, $stdout, _]) {
      react {
        on retracted S.Readable(stdout) topFacet.stop();
        on message S.Line(stdout, $line) {
          // Parsing of TXT record data (appearing after the port
          // number in an '=' record) is unreliable given the way
          // avahi-browse formats it.
          //
          // See https://github.com/lathiat/avahi/pull/206.
          //
          // However, it's still useful to have, so we do our best!
          //
          const pieces = line.toString('utf-8').split(/;/);
          if (pieces[0] === '=') {
            // A resolved address record, which has TXT data.
            const normalFields = pieces.slice(0, 9);
            const txtFields = pieces.slice(9).join(';'); // it's these that are dodgy
            if (txtFields === '') {
              normalFields.push([]);
            } else {
              normalFields.push(txtFields.slice(1,-1).split(/" "/)); // OMG this is vile
            }
            send BrowserInput(id, normalFields);
          } else {
            // Something else.
            send BrowserInput(id, pieces);
          }
        }

        on message BrowserInput(id, ["+", $interfaceName, $family, $name, $serviceType, $domain]) {
          react {
            const svc = Service(unescapeLabel(name), unescapeLabel(serviceType));
            stop on message BrowserInput(
              id, ["-", interfaceName, family, name, serviceType, domain]);
            on message BrowserInput(
              id, ['=', interfaceName, family, name, serviceType, domain,
                   $hostName, $address, $portStr, $txtDataRecords])
            {
              const port0 = Number(portStr);
              const port = Number.isNaN(port0) ? null : port0;
              react assert Discovered(
                svc, hostName, port, txtDataRecords, address, family, interfaceName);
            }
          }
        }
      }
    }
  }
}
