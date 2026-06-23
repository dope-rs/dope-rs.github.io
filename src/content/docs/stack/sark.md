---
title: sark — the typed web framework
description: A thread-per-core, shared-nothing HTTP framework — compile-time routes, zero dyn, zero-copy requests.
sidebar:
  order: 3
---

> **삵**: korean leopard cat

Thread-per-core, shared-nothing HTTP. Requests, responses and routes are generated at
compile time; a handler is a plain function that runs as a [Fiber](/concepts/fiber/)
on the core that accepted the connection.

<figure class="cores" role="img" aria-label="SO_REUSEPORT gives every core its own listener. A connection accepted on a core runs its whole Listener → Fiber → Response pipeline on that core, against core-local state. Nothing is shared between cores.">
<div class="cores-rail"><span class="rail-name">SO_REUSEPORT</span></div>
<div class="cores-lanes">
<div class="core"><span class="core-tag">core 0</span><div class="flow"><span class="st">Listener</span><span class="st hot">Fiber</span><span class="st">Response</span></div><span class="state">own State</span></div>
<div class="core"><span class="core-tag">core 1</span><div class="flow"><span class="st">Listener</span><span class="st hot">Fiber</span><span class="st">Response</span></div><span class="state">own State</span></div>
<div class="core"><span class="core-tag">core N</span><div class="flow"><span class="st more">…</span></div><span class="state none">nothing shared</span></div>
</div>
</figure>

## Handlers

A handler is `(Request, &State) -> Response`. State is core-local — here a visit
counter that's a plain `Cell`, no atomic in sight:

```rust
use std::cell::Cell;
use http::StatusCode;

struct State {
    index:     &'static [u8],   // pre-rendered HTML
    font:      &'static [u8],   // a woff2 asset
    font_etag: &'static str,    // content hash, for 304s
    counter:   Cell<u64>,       // per-core, non-atomic
}

#[sark_gen::response(raw)]
#[header("content-type", "text/html")]
struct IndexResponse { status: StatusCode, body: &'static [u8] }

#[sark_gen::response(raw)]
#[header("content-type", "text/plain")]
struct CountResponse { status: StatusCode, body: o3::buffer::Owned }

#[sark_gen::response(raw)]
#[header("content-type", "font/woff2")]
struct AssetResponse { status: StatusCode, body: &'static [u8] }

// No fields: no query, no path — and the header map is never parsed.
#[sark_gen::request]
struct IndexRequest {}

// Query string: /count?by=5  (defaults to 1 when absent).
#[sark_gen::request]
struct CountRequest {
    #[query("by", default = "1")] by: u64,
}

// Path param + one opt-in header. This is the only struct that names a
// header, so it's the only handler that ever parses one.
#[sark_gen::request]
struct AssetRequest {
    #[path("name")] name: &str,         // matches /assets/:name
    #[header("if-none-match")] etag: Option<&str>,
}

// Static body: rendered once at boot, handed out by pointer.
#[sark_gen::handler]
#[response_body(Static)]
#[static_response]
fn index(_req: IndexRequest, state: &State) -> IndexResponse {
    IndexResponse { status: StatusCode::OK, body: state.index }
}

// Dynamic body: mutate core-local state with no lock and no atomic.
#[sark_gen::handler]
fn count(req: CountRequest, state: &State) -> CountResponse {
    let n = state.counter.get().saturating_add(req.by);
    state.counter.set(n);
    let body = format!("visit #{n}");
    CountResponse {
        status: StatusCode::OK,
        body: o3::buffer::Owned::from(body.as_bytes()),
    }
}

#[sark_gen::handler]
fn asset(req: AssetRequest, state: &State) -> AssetResponse {
    // `if-none-match` is parsed only because this request named it.
    if req.etag == Some(state.font_etag) {
        return AssetResponse {
            status: StatusCode::NOT_MODIFIED,
            body: b"",
        };
    }
    match req.name {
        "font.woff2" =>
            AssetResponse { status: StatusCode::OK, body: state.font },
        _ =>
            AssetResponse { status: StatusCode::NOT_FOUND, body: b"" },
    }
}
```

**Headers are parsed lazily — only the fields a request names get read.** `IndexRequest`
and `CountRequest` declare none, so those handlers never touch the header map; only
`AssetRequest` asked for `if-none-match`, so only it pays to parse one. You parse the
headers you name, and nothing else.

## Routes

`define_route!` compiles the table to a static-prefix tree plus a parameter DFA —
nested `scope`s, path params, no runtime registry:

```rust
sark_gen::define_route! {
    pub Site: State => {
        GET "/"        => index,
        GET "/count"   => count,
        scope "/assets" => [
            GET "/:name" => asset,
        ],
    }
}
```

## Boot

`Launcher` runs the same closure on every CPU; each core builds its own `State` and
leaks it to `&'static`, so nothing is shared:

```rust
use dope::launcher::Launcher;
use sark::{Build, ServerCfg};

fn main() -> std::io::Result<()> {
    let cfg = ServerCfg {
        bind: "0.0.0.0:8080".parse().unwrap(),
        max_conn: 1024,
        backlog: 4096,
    };
    Launcher::new(Launcher::allowed_cpus()).run(move |ctx| {
        let state: &'static State = Box::leak(Box::new(State::new()));
        Build::http(Site::new(state), cfg.clone(), ctx, None)
    })
}
```

The server `Dispatcher` is dope [manifolds](/concepts/manifold/) — a `Listener`, a
timer, db connectors. [cartel](/stack/cartel/) drivers plug in as another per-core
manifold, so the database client shares the exact same thread-per-core design.
