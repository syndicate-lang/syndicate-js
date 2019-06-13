// https://www.ietf.org/rfc/rfc1928.txt

const {
  currentFacet, genUuid,
  Bytes, Map,
  Observe, Skeleton,
  Dataspace,
} = require("@syndicate-lang/core");
const C = activate require("@syndicate-lang/server/lib/client");
const S = activate require("@syndicate-lang/driver-streams-node");
const M = activate require("@syndicate-lang/driver-mdns");
const { PeriodicTick } = activate require("@syndicate-lang/driver-timer");
const debugFactory = require('debug');
const os = require('os');

assertion type VirtualTcpAddress(host, port);
assertion type AddressMap(from, nodeId, to);

assertion type DockerContainerInfo(name, info);
assertion type DockerContainerPort(name, ip, port);
assertion type DockerScan();
message type DockerContainers(blob);

assertion type ToNode(nodeId, assertion);
assertion type FromNode(nodeId, assertion);
assertion type RestrictedFromNode(nodeId, spec, captures);

function usage() {
  console.info('Usage: syndicate-socks-service --server WEBSOCKETURL SCOPE');
  console.info('');
  console.info('  --help, -h            Produce this message and terminate');
}

let server_url = null;
let server_scope = null;
function process_command_line(args) {
  const notUndefined = (x, w) => {
    if (x === void 0) {
      console.error('Missing '+w+' argument on command line');
      usage();
      process.exit(1);
    }
    return x;
  };
  const strArg = (w) => notUndefined(args.shift(), w);
  const numArg = (w) => Number.parseInt(notUndefined(args.shift(), w));
  while (args.length) {
    const opt = args.shift();
    switch (opt) {
      case '--server':
        server_url = strArg('server WebSocket URL');
        server_scope = strArg('server scope name');
        break;
      default:
        console.error("Unsupported command-line argument: " + opt);
        /* FALL THROUGH */
      case '--help':
      case '-h':
        usage();
        process.exit(1);
    }
  }
}

process_command_line(process.argv.slice(2));
if (!server_url || !server_scope) {
  usage();
  process.exit(1);
}
const server_addr = C.WSServer(server_url, server_scope);

const nodeId = genUuid('node');

spawn named 'docker-scan' {
  const debug = debugFactory('syndicate/server:socks:docker:scan');
  const Docker = require('dockerode');
  during Observe(DockerContainerInfo(_, _)) assert DockerScan();
  during Observe(DockerContainerPort(_, _, _)) assert DockerScan();
  during DockerScan() {

    const docker = new Docker();
    function scan() {
      docker.listContainers(Dataspace.wrapExternal((err, containers) => {
        if (err) throw err;
        react {
          stop on message PeriodicTick(5000) scan();
          on start send DockerContainers(containers);
        }
      }));
    }
    on start scan();

    on message DockerContainers($containers0) {
      const containers = containers0.toJSON();
      react {
        stop on message DockerContainers(_);
        containers.forEach((info) => {
          for (let netname in info.NetworkSettings.Networks) {
            const net = info.NetworkSettings.Networks[netname];
            info.Names.forEach((n) => {
              const name = n.replace('/', '') + '.' + netname;
              assert DockerContainerInfo(name, info);
              info.Ports.forEach((p) => {
                if (p.Type === 'tcp') {
                  assert DockerContainerPort(name, net.IPAddress, p.PrivatePort);
                }
              });
            });
          }
        });
      }
    }
  }
}

spawn named 'test-remap' {
  during C.ServerConnected(server_addr) {
    during M.Discovered(M.Service($name, '_ssh._tcp'), $host, $port, _, _, "IPv4", _) {
      const servicename = name + '.' + os.hostname() + '.ssh.fruit';
      assert C.ToServer(server_addr, AddressMap(VirtualTcpAddress(servicename, 22),
                                                nodeId,
                                                S.TcpAddress(host, port)));
    }
    during DockerContainerPort($name, $ip, $port) {
      const servicename = name + '.' + os.hostname() + '.docker.fruit';
      assert C.ToServer(server_addr, AddressMap(VirtualTcpAddress(servicename, port),
                                                nodeId,
                                                S.TcpAddress(ip, port)));
    }
  }
}

spawn named 'to-node-relay' {
  const debug = debugFactory('syndicate/server:socks:to-node-relay');
  during C.ServerConnected(server_addr) {
    on asserted C.FromServer(server_addr, ToNode(nodeId, $a)) {
      debug('Remote peer has asserted', a && a.toString());
      currentFacet().actor.adhocAssert(a);
    }
    on retracted C.FromServer(server_addr, ToNode(nodeId, $a)) {
      debug('Remote peer has retracted', a && a.toString());
      currentFacet().actor.adhocRetract(a);
    }
    on message C.FromServer(server_addr, ToNode(nodeId, $a)) {
      debug('Remote peer has sent', a && a.toString());
      send a;
    }
    during C.FromServer(server_addr, Observe(FromNode(nodeId, $spec))) {
      on start debug('Remote peer has asserted interest in', spec && spec.toString());
      on stop debug('Remote peer has retracted interest in', spec && spec.toString());
      currentFacet().addObserverEndpoint(() => spec, {
        add: (vs) => {
          const a = RestrictedFromNode(nodeId, spec.toString(), vs);
          debug('+', a && a.toString());
          // The "react { assert; stop on retracted ... }" pattern won't work here because of
          // the `VisibilityRestriction`s. We'll never see the "retracted" event if we "stop on
          // retracted aLocal" where aLocal = Skeleton.instantiateAssertion(spec, vs). Instead,
          // we need to use `adhocAssert` and the `del` callback.
          currentFacet().actor.adhocAssert(C.ToServer(server_addr, a));
        },
        del: (vs) => {
          const a = RestrictedFromNode(nodeId, spec.toString(), vs);
          debug('-', a && a.toString());
          currentFacet().actor.adhocRetract(C.ToServer(server_addr, a));
        },
        msg: (vs) => {
          const a = RestrictedFromNode(nodeId, spec.toString(), vs);
          debug('!', a && a.toString());
          send C.ToServer(server_addr, a);
        }
      });
    }
  }
}
