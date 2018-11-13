"use strict";

import { Observe } from "@syndicate-lang/core";

message type Greeting(who);

spawn named 'sender' {
  on asserted Observe(Greeting(_)) {
    ^ Greeting("world");
  }
}

spawn named 'greeter' {
  on message Greeting($who) {
    console.log(`Hello, ${who}!`);
  }
}
