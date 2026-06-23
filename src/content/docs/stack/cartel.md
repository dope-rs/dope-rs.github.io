---
title: cartel — the data layer
description: Native, core-local Postgres / Redis / SQLite drivers for dope — typed SQL generated at compile time.
sidebar:
  order: 2
---

> **cartel** — database drivers for dope.

`cartel` is the data layer: native, async Postgres / Redis / SQLite drivers that plug
into dope as connectors. Because every connection belongs to one core, the drivers are
lock-free by construction — no `Arc`, no `Mutex`, no atomics on the path. The inflight
backpressure counter is a plain `&mut` struct; o3 buffer refcounts are `Cell`.

## Typed, generated at compile time

`#[derive(PgTable)]` (or `SqliteTable`) generates a row decoder and column metadata —
*not* query methods. Queries live in a `#[query_group]`: plain `fn`s over a typed DSL,
checked at compile time and dispatched through `run_one` / `run_first` / `run_all`,
never assembled from strings.

```rust
#[derive(PgTable)]
#[table_name = "users"]
struct User {
    #[pk] id: i64,
    name: String,
    email: String,
}

#[query_group]
impl User {
    fn by_id(id: i64) -> User {
        User::filter(|u| u.id == id).one()
    }
    fn rename(id: i64, name: String) {
        User::filter(|u| u.id == id)
            .update(|u| u.name = name)
    }
    fn since(min: i64) -> Vec<User> {
        User::filter(|u| u.id >= min)
            .order_by(|u| u.id)
            .all()
    }
}

let user = User::by_id(&client, 1).await?;
```

Statements are **prepared once at startup** and referenced by name — no runtime parse,
no per-call prepare. Params encode straight into the connection's `o3` wire buffer
(Postgres Bind + Execute); rows decode through a single `fn` pointer into the generated
`Row::decode`.

## Transactions, pipelined

`tx(...)` / `tx_with()` wraps the body in `BEGIN … COMMIT` and rolls back on any `?`.
`Batch` pipelines same-shape queries — each stages its Bind+Execute into one wire
buffer, up to 32 in flight, flushed together:

<figure class="pipe" role="img" aria-label="Sequential pays one network round-trip per query; Batch packs the queries into one flush, up to 32 in flight, paying a single round-trip.">
<div class="pipe-head"><span class="pipe-env">round-trips</span><span class="pipe-axis">time →</span></div>
<div class="lane"><span class="lane-tag">sequential</span><div class="wire"><span class="q">q1</span><span class="rt"><i>rt</i></span><span class="q">q2</span><span class="rt"><i>rt</i></span><span class="q">q3</span><span class="rt"><i>rt</i></span></div></div>
<p class="lane-cost">one round-trip <b>each</b> — three waits</p>
<div class="lane batch"><span class="lane-tag">batch</span><div class="wire"><span class="q">q1</span><span class="q">q2</span><span class="q">q3</span><span class="rt"><i>rt</i></span></div></div>
<p class="lane-cost batch">one flush · <b>≤32 in flight</b> — one wait</p>
</figure>

```rust
use cartel_pg::{Batch, IsolationLevel};

#[derive(PgTable)]
#[table_name = "accounts"]
struct Account {
    #[pk] id: i64,
    balance: i64,
}

#[query_group]
impl Account {
    fn debit(id: i64, cents: i64) {
        Account::filter(|a| a.id == id)
            .update(|a| a.balance = a.balance - cents)
    }
    fn credit(id: i64, cents: i64) {
        Account::filter(|a| a.id == id)
            .update(|a| a.balance = a.balance + cents)
    }
    fn balance(id: i64) -> i64 {
        Account::filter(|a| a.id == id)
            .select(|a| a.balance)
            .one()
    }
}

// Pay many recipients in one serializable transaction; the
// per-recipient credits pipeline instead of a round-trip each.
let treasury_left: i64 = client
    .tx_with()
    .isolation(IsolationLevel::Serializable)
    .run(async |tx| {
        // single debit
        Account::debit(tx, treasury, total).await?;

        // N credits, pipelined: one flush, up to 32 in flight
        Batch::new(
            payouts
                .iter()
                .map(|p| Account::credit(tx, p.id, p.cents))
                .collect(),
        )
        .await;

        // read back, same transaction
        Account::balance(tx, treasury).await
    })
    .await?; // COMMIT — or auto-ROLLBACK on error
```

Need finer control? `client.begin().await` gives a manual `TxGuard` with explicit
`.commit()` / `.rollback()`, and `tx.savepoint("name").await` nests savepoints.
