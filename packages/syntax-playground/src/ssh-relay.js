const { currentFacet, genUuid } = require("@syndicate-lang/core");
const S = activate require("@syndicate-lang/driver-streams-node");

spawn named 'ssh-relay-server' {
  on asserted S.IncomingConnection($conn, S.TcpListener(2022)) {
    spawn named ['sshconn', conn] {
      stop on retracted S.Duplex(conn);

      const daemon = genUuid('daemon');
      assert S.OutgoingConnection(daemon, S.SubprocessAddress('/usr/sbin/sshd', ['-dei'], {}));
      stop on message S.ConnectionRejected(daemon, $err) {
        console.error("Couldn't start sshd", err);
      }
      stop on message S.ConnectionAccepted(daemon) {
        react {
          stop on retracted S.Duplex(conn);
          stop on retracted S.Duplex(daemon);
          assert S.BackPressure(conn, daemon);
          assert S.BackPressure(daemon, conn);
          on message S.Data(conn, $chunk) send S.Push(daemon, chunk, null);
          on message S.Data(daemon, $chunk) send S.Push(conn, chunk, null);
        }
      }
    }
  }
}
