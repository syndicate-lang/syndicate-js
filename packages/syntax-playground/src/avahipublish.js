const { Observe, currentFacet, genUuid } = require("@syndicate-lang/core");
const S = activate require("@syndicate-lang/driver-streams-node");
const M = activate require("@syndicate-lang/driver-mdns");

spawn named 'test' {
  const svc = M.Service((new Date()).toJSON(), '_syndicate._tcp');
  assert M.Publish(svc, null, 8001, []);

  during M.Discovered(M.Service($name, '_syndicate._tcp'),
                      $hostName,
                      $port,
                      $txtDataRecords,
                      $address,
                      "IPv4",
                      $interfaceName)
  {
    on start console.log('+', name, hostName, port, txtDataRecords, address, interfaceName);
    on stop  console.log('-', name, hostName, port, txtDataRecords, address, interfaceName);
  }

  during M.Discovered(M.Service($n, $t), $h, $p, $d, $a, "IPv4", $i) {
    if (t !== '_syndicate._tcp') {
      on start console.log('**', t, n, h, p, d, a, i);
      on stop  console.log('==', t, n, h, p, d, a, i);
    }
  }
}
