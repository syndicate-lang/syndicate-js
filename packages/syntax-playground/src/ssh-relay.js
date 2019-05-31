const { currentFacet, genUuid } = require("@syndicate-lang/core");
const S = activate require("@syndicate-lang/driver-streams-node");

spawn named 'ssh-relay-server' {
  on asserted S.Stream($conn, S.Incoming(S.TcpListener(2022))) {
    spawn named ['sshconn', conn] {
      stop on retracted S.Stream(conn, S.Duplex());

      const daemon = genUuid('daemon');
      assert S.Stream(daemon, S.Outgoing(S.SubprocessAddress('/usr/sbin/sshd', ['-dei'], {})));
      stop on message S.Stream(daemon, S.Rejected($err)) {
        console.error("Couldn't start sshd", err);
      }
      stop on message S.Stream(daemon, S.Accepted()) {
        react {
          stop on retracted S.Stream(conn, S.Duplex());
          stop on retracted S.Stream(daemon, S.Duplex());
          assert S.Stream(conn, S.BackPressure(daemon));
          assert S.Stream(daemon, S.BackPressure(conn));
          on message S.Stream(conn, S.Data($chunk)) send S.Stream(daemon, S.Push(chunk, null));
          on message S.Stream(daemon, S.Data($chunk)) send S.Stream(conn, S.Push(chunk, null));
        }
      }
    }
  }
}
