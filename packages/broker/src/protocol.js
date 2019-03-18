"use strict";

import { Decoder, Discard, Capture, Observe } from "@syndicate-lang/core";

// Client ---> Broker
message type Assert(endpointName, assertion);
message type Clear(endpointName);
message type Message(body);

// Client <--- Broker
message type Add(endpointName, captures);
message type Del(endpointName, captures);
message type Msg(endpointName, captures);

// Bidirectional
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
  Assert, Clear, Message,
  Add, Del, Msg,
  Ping, Pong,
  makeDecoder,
});
