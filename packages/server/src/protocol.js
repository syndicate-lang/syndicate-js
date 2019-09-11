"use strict";

import { Map, Decoder, Encoder, Discard, Capture, Observe } from "@syndicate-lang/core";

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

const _decode_placeholders =
      (Map()
       .set(0, Discard.constructorInfo.label)
       .set(1, Capture.constructorInfo.label)
       .set(2, Observe.constructorInfo.label));

const _encode_placeholders = _decode_placeholders.mapEntries((e) => [e[1], e[0]]);

function makeDecoder(initialBuffer) {
  return new Decoder(initialBuffer, {placeholders: _decode_placeholders});
}

function makeEncoder() {
  return new Encoder({placeholders: _encode_placeholders});
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
  makeDecoder, makeEncoder,
  shouldDebugPrint,
});
