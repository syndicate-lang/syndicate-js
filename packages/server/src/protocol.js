"use strict";

import { Decoder, Discard, Capture, Observe } from "@syndicate-lang/core";

message type Connect(scope);

message type Turn(items);

message type Assert(endpointName, assertion);
message type Clear(endpointName);
message type Message(body);

message type Add(endpointName, captures);
message type Del(endpointName, captures);
message type Msg(endpointName, captures);
message type End(endpointName);
message type Err(detail, context);

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

function shouldDebugPrint(m) {
  // return !(Ping.isClassOf(m) || Pong.isClassOf(m));
  return true;
}

Object.assign(module.exports, {
  Connect,
  Turn,
  Assert, Clear, Message,
  Add, Del, Msg, Err, End,
  Ping, Pong,
  makeDecoder,
  shouldDebugPrint,
});
