# Streams in node.js 10.x → Syndicate

Streams can be in binary or object mode

Desiderata: Like enumerator/observable, it seems like
readable/writable should be duals. If they're not, why not, other than
historical reasons?

## GENERAL

`stream.finished()`

## WRITABLE

Has a buffer of to-be-accepted elements.

Emits:

 - `close` (optional), after all resources have been released. No more
   events, no more computation, nothing more will happen.

 - `drain`, when the buffer runs *empty*, to signal a demand for more
   input.

 - `error`

 - `finish`, exactly equivalent to a callback-function acknowledging
   the `end()` call: the "no more input is available" signal has been
   completely processed and has made its way through to the
   underlying/backing medium.

 - `pipe`/`unpipe`, notifies the `Writable` of an attached/detached
   pipe sender.

Methods:

 - `cork`/`uncork`, for batching supplied inputs

 - `destroy`, abandon the `Writable` without bothering to try to
   finish; dual to `error`, more or less

 - `end`, does an optional `write` and then signals the clean end of
   the input stream. If a callback is supplied, it is attached as a
   listener to `finish`.

 - `write`, delivers a chunk of input. Yields `false` when the buffer
   is *full* at the time the call to `write` returns; will issue
   `drain` later in this case.

Properties:

 - high water mark, length of buffer in use.

## READABLE

Has a buffer of to-be-relayed elements.

Emits:

 - `close` (optional), exactly the same as for `Writable`.

 - `readable`, when the buffer becomes *nonempty* from having been
   empty, to signal the possibility of more output.

 - `error`

 - `end`, when no more data will be produced; analogous to TCP's
   `FIN`. Is in-order wrt other data.

 - `data`, delivers a chunk of output.

Methods:

 - `pipe`/`unpipe`, for attaching a `Writable` to this `Readable`.
   Many of them can be attached! I guess that makes a fan-out? By
   default, the `end` method of the `Writable` is called when the
   `Readable` emits its `end` event, but this can be overridden with
   an option.

 - `isPaused`, `pause` and `resume` control and interrogate
   XON/XOFF-style flow control.

 - `destroy`, abandon the `Readable` without bothering to try to
   finish reading from it; not quite dual to error since a `Readable`
   is a source, not a sink

 - `read`, explicitly get a chunk

 - `push`, internal API for poking a chunk into the "last-in" end of
   the FIFO to-be-delivered buffer. Returns `false` when the buffer is
   (over-)full.

 - `unshift`, internalish API for poking a chunk into the "first-in"
   end of the FIFO buffer, like `ungetc()` etc. There are
   complications in using this, check the docs.

Properties:

 - high water mark, length of buffer in use.
