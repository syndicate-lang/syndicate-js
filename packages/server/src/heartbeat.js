"use strict";

const { TimeLaterThan } = activate require("@syndicate-lang/driver-timer");
const debug = require('debug')('syndicate/server:heartbeat');
const W = require('./protocol');

const PERIOD = 60 * 1000; // milliseconds
const GRACE = 3 * PERIOD;

function heartbeat(fields, who, sendMessage, teardown) {
  debug('Configuring heartbeat', who, PERIOD, GRACE);

  const NEXT_PING_TIME = Symbol('NEXT_PING_TIME');
  const LAST_RECEIVED_TRAFFIC = Symbol('LAST_RECEIVED_TRAFFIC');

  function now() { return (+(new Date())); } // returns milliseconds

  field fields[NEXT_PING_TIME] = 0;
  field fields[LAST_RECEIVED_TRAFFIC] = now();

  const scheduleNextPing = () => { fields[NEXT_PING_TIME] = now() + PERIOD; };

  on asserted TimeLaterThan(fields[NEXT_PING_TIME]) {
    scheduleNextPing();
    sendMessage(W.Ping());
  }

  on asserted TimeLaterThan(fields[LAST_RECEIVED_TRAFFIC] + GRACE) {
    debug('Heartbeat timeout', who, GRACE);
    teardown();
  }

  return () => {
    scheduleNextPing();
    fields[LAST_RECEIVED_TRAFFIC] = now();
  };
}

Object.assign(module.exports, {
  PERIOD,
  GRACE,
  heartbeat,
});
