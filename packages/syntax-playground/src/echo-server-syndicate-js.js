const S = activate require("@syndicate-lang/driver-streams-node");

spawn named 'echoserver' {
  on asserted S.Stream($id, S.Incoming(S.TcpListener(5999))) {
    spawn {
      stop on retracted S.Stream(id, S.Duplex());
      on message S.Stream(id, S.Data($bs)) send S.Stream(id, S.Push(bs, false));
    }
  }
}
