const { Observe, currentFacet, genUuid } = require("@syndicate-lang/core");
const M = activate require("@syndicate-lang/driver-mdns");

spawn named 'test' {
  const svc = M.Service((new Date()).toJSON(), '_syndicate+testing._tcp');
  assert M.Publish(svc, null, 8001, []);

  field this.count = 0;
  dataflow console.log('Service count:', this.count);

  during M.Discovered(M.Service($name, '_syndicate+testing._tcp'),
                      $host, $port, _, $addr, "IPv4", $ifName)
    =>
  {
    on start { this.count++; console.log('+', name, host, port, addr, ifName); }
    on stop  { this.count--; console.log('-', name, host, port, addr, ifName); }
  }
}
