---
title: Features
description: The four features every dope-rs crate shares — thread-per-core, no atomics, no dyn, no shared state.
sidebar:
  order: 2
---

## 1 · Thread-per-core

One executor per core, pinned. No global scheduler, no work-stealing.

## 2 · No atomics

One owner per value. Wakers are `Cell` / `UnsafeCell`; o3's shared refcount is a
`Cell<u32>`, not an `Arc`.

## 3 · No dyn dispatch

Manifolds route by a `const ID` `match`, decoders are `fn` pointers, routers are
generated code. A workspace grep for `dyn` returns zero.

## 4 · No shared state

No `Arc`, `Mutex`, `RwLock`, or cross-core channel — each core owns its slab and waker
arena outright.

```text
Arc ✗   Mutex ✗   RwLock ✗   Atomic* ✗   dyn ✗   cross-core channel ✗
```
