"use strict";

import { Decoder, Discard, Capture, Observe } from "@syndicate-lang/core";

message type Connect(scope);
message type Peer(scope);

message type Assert(endpointName, assertion);
message type Clear(endpointName);
message type Message(body);

message type Add(endpointName, captures);
message type Del(endpointName, captures);
message type Msg(endpointName, captures);
message type Err(detail);

message type Ping();
message type Pong();

function makeDecoder(initialBuffer) {
  return new Decoder(initialBuffer, {
    shortForms: {
      0: Discard.constructorInfo.label,
      1: Capture.constructorInfo.label,
      2: Observe.constructorInfo.label,
    }
  });
}

Object.assign(module.exports, {
  Connect, Peer,
  Assert, Clear, Message,
  Add, Del, Msg, Err,
  Ping, Pong,
  makeDecoder,
});
