---
title: Introduction
description: Why dope-rs is shared-nothing and io_uring-first — the three reasons.
sidebar:
  order: 1
---

You scale out anyway — more cores, more machines. So making threads share memory
(locks, atomics, channels, a work-stealing scheduler) buys nothing. dope-rs skips it.

> `Send` and `Sync` are not zero-cost.

## 1 · No heavy abstractions

A function, not a machine. Connections are core-local, queries resolve at compile
time, dispatch is plain monomorphized calls. The [home page](/) counts the cycles for
one row-read: **7,400** the conventional way, **180** ours. We didn't optimize the
machinery — there isn't any.

## 2 · You scale out anyway

Once the unit of scale is "one more core," shared state is pure overhead. So each core
is a complete runtime, and `SO_REUSEPORT` spreads the load across them — no global
scheduler, no work-stealing.

## 3 · io_uring is the target

We build for `io_uring` and shape the design to it. `kqueue` is a dev stand-in for
macOS — unoptimized, not a second target. Committing to one model *is* the point.
