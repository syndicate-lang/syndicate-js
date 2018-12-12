const { Observe, currentFacet, genUuid } = require("@syndicate-lang/core");
const S = activate require("@syndicate-lang/driver-streams-node");
const M = activate require("@syndicate-lang/driver-mdns");

spawn named 'test' {
  // const svc = M.Service((new Date()).toJSON(), '_syndicate._tcp');
  // assert M.Publish(svc, null, 8001, []);

  // during M.Discovered(M.Service($name, '_syndicate._tcp'),
  //                     $hostName,
  //                     $port,
  //                     $txtData,
  //                     $address,
  //                     "IPv4",
  //                     $interfaceName)
  // {
  //   on start console.log('+', name, hostName, port, txtData, address, interfaceName);
  //   on stop  console.log('-', name, hostName, port, txtData, address, interfaceName);
  // }

  field this.count = 0;
  dataflow console.log('Broker count:', this.count);

  during M.Discovered(M.Service($name, '_syndicate+ws._tcp'), $host, $port, $txt, $addr, "IPv4", _)
  {
    on start { this.count++; console.log('+ws', name, host, port, txt.get(0, 'N/A'), addr); }
    on stop  { this.count--; console.log('-ws', name, host, port, txt.get(0, 'N/A'), addr); }
  }

  during M.Discovered(M.Service($name, '_syndicate._tcp'), $host, $port, _, $addr, "IPv4", _)
  {
    on start { this.count++; console.log('+tcp', name, host, port, addr); }
    on stop  { this.count--; console.log('-tcp', name, host, port, addr); }
  }

  // during M.Discovered(M.Service($n, $t), $h, $p, $d, $a, "IPv4", $i) {
  //   if (t !== '_syndicate._tcp') {
  //     on start console.log('**', t, n, h, p, d, a, i);
  //     on stop  console.log('==', t, n, h, p, d, a, i);
  //   }
  // }
}
