---
title: shin — the TLS layer
description: A hand-rolled, single-threaded TLS 1.3 — sans-io, one cipher suite, one group, no atomics.
sidebar:
  order: 5
---

> **神**: spirit

Hand-rolled TLS 1.3: one cipher suite, one group, no atomics. rustls drags an
`Arc<ServerConfig>` and a mutex-guarded session cache across every core; shin keeps
each connection's keys core-local instead. `ring` does the math, shin does the protocol.

```text
TLS 1.3 only · AES-128-GCM-SHA256 · X25519
sans-io · #![no_std] + alloc · no Arc, no Mutex, no atomics
```

## Sans-io — the caller drives

shin holds no sockets. You feed it record bytes, it hands you back a `Vec<Event>`;
when an `Event::Send` comes out, you put those bytes on the wire. The I/O — the
`io_uring` submit/complete loop — stays in [dope](/stack/dope/). The crypto stays in
`ring`. shin is only the state machine in between.

```text
wire bytes ─► Opener ─► Server::read(epoch, ..) ─► [Event]
[Event::Send] ─► Sealer ─► wire bytes
                           shin owns no I/O · one connection = one Fiber, one core
```

## A handshake

`Server::read` returns the work to do, never performs it. `Epoch` tells you which keys
the bytes were under; `Event` tells you what changed.

```rust
let mut server = shin::server::Server::new(config);

// hand it whatever the record layer decrypted
for event in server.read(Epoch::Plaintext, client_hello)? {
    match event {
        Event::Send { epoch, data }          => out.queue(epoch, data),
        Event::KeysReady { epoch, read_secret, write_secret } => {
            opener = Some(Opener::from_secret(&read_secret));
            sealer = Some(Sealer::from_secret(&write_secret));
        }
        Event::Done                          => {}   // handshake complete
        _ => {}
    }
}
```

- **One suite, one group.** `AES-128-GCM-SHA256` over `X25519`, TLS 1.3 only — same
  bet as [io_uring-first](/philosophy/intro/): commit to one model, don't sand it down
  to a lowest common denominator.
- **ring does the dangerous part.** AEAD, X25519, ECDSA/RSA-PSS, HKDF — all `ring`.
  shin owns the protocol, the DER, the path validation; not the bignum math.
- **Per-core, no sharing.** No `Arc<Config>`, no session-cache mutex. A live connection
  is a [Fiber](/concepts/fiber/) on the core that accepted it, holding its own keys.

## What's in the box

X.509 and raw public keys (RFC 7250), ALPN, SNI, resumption + 0-RTT, and `KeyUpdate`.
Verification is SAN-only, strict-DER, and binds algorithm OIDs so they can't be swapped.
