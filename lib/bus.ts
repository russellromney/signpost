// A tiny in-process notifier so the event feed can long-poll instead of
// busy-polling. logEvent() fires a tick after each append; a waiting /v1/events
// request wakes, re-queries, and returns. Single-process only (the prototype is
// one Node process) — a networked deployment would use LISTEN/NOTIFY or a broker.
//
// Safe with better-sqlite3: writes are synchronous, so emit() runs while the
// writing transaction is still on the stack, but a waiter's continuation only
// resumes on a later microtask — after the transaction has committed.
import { EventEmitter } from "node:events";

const g = globalThis as unknown as { __signpostBus?: EventEmitter };

function bus(): EventEmitter {
  if (!g.__signpostBus) {
    const e = new EventEmitter();
    e.setMaxListeners(0); // many concurrent long-poll waiters are expected
    g.__signpostBus = e;
  }
  return g.__signpostBus;
}

export function emitEvent(): void {
  bus().emit("event");
}

// Resolve on the next appended event, or after `timeoutMs`, whichever is first.
export function waitForEvent(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const b = bus();
    const onEvent = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      b.off("event", onEvent);
      resolve();
    }, timeoutMs);
    b.once("event", onEvent);
  });
}
