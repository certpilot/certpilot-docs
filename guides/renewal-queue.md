<!-- Synced from docs/api-reference.md in certpilot/certpilot at 51f86f743471, last changed 2026-09-26T16:23:02Z.
     Source heading: "Renewal queue". Edit it there, not here. -->

Renewal is the only part of this system that changes the world. Everything else
observes. So it is not a call the scheduler makes — it is a durable row that
somebody owns, and a process that dies mid-renewal leaves behind something
another process can pick up.

## Asking for one

```json
POST /api/v1/certificates/{id}/renew
→ 202 Accepted
{ "data": { "id": "…", "status": "PENDING", "reason": "MANUAL", "attempts": 0 },
  "message": "Queued. Watch it at GET /api/v1/renewals/…" }
```

**202, not 200.** This endpoint used to call the gateway inline and return the
renewed certificate, which read well and was wrong in three ways: an ACME order
with a DNS challenge outlives the server's 30-second write timeout, so the
caller got a truncated response for a renewal that was still running; a failure
meant one attempt and no record of it; and a core that restarted mid-request
left nothing behind at all.

Pressing it twice returns **the same job**:

```json
{ "data": { "id": "…same id…" },
  "message": "A renewal for this certificate is already queued; this did not start a second one." }
```

Two certificates issued because somebody clicked twice is a real way to spend a
weekly rate limit. A certificate with no CA account — anything discovered rather
than issued — is refused with **400** at this point rather than becoming a job
that fails forever.

So is a certificate whose private key CertPilot does not hold, again with
**400**. When `key_custody` is `AGENT`, the refusal names the agent and says how
to renew it on that host (`certpilot-agent request --name …`). When it is
`EXTERNAL`, it asks for a new signing request from whoever holds the key. A
renewal here always ends with the gateway generating a fresh keypair. For these
certificates, CertPilot would then hold a key it promised never to hold, and
the record would describe a certificate the key holder is not serving. A job
for one that was queued some other way is cancelled, not retried.

## Where a job stands

```json
GET /api/v1/renewals/{id}
{ "data": { "status": "PENDING", "attempts": 3, "run_after": "…",
            "escalated_at": "…", "not_after": "…",
            "attempt_log": [
              { "number": 1, "started_at": "…", "duration_ms": 412,
                "worker": "core-7c9f/1", "error": "dial tcp 10.0.0.5:9091: connection refused" }
            ] },
  "summary": "Failed 3 time(s), with 41 hours left before this certificate expires. Retrying in 8 minutes. The most recent error was: …" }
```

The **whole attempt log**, not just the last error. "This has failed eleven
times in six days with the same DNS error" is a sentence somebody can act on;
`last_error: timeout` cannot tell a blip from a fortnight of silence. Each entry
names the worker that made it, because one replica failing and every replica
failing are different problems.

The log is capped at the 50 most recent attempts, so a renewal retrying for
weeks does not grow without limit inside a row a dashboard reads constantly. The
attempt count is kept separately and is not capped.

## What the queue does with failure

A failed attempt leaves the job **PENDING** with `run_after` moved forward.
There is no attempt count at which a certificate stops needing to be renewed,
and a queue that gives up on its own goes quiet exactly when it matters.

The delay is the **smaller** of two answers: what exponential backoff says
(2 minutes doubling to a 6-hour ceiling), and what the deadline allows — the
remaining runway divided into a budget of 24 more attempts.

| Runway | Delay |
|:---|:---|
| a month | ~6 hours, the ordinary ceiling |
| a day | ~1 hour |
| an hour | a few minutes |
| already expired | the 60-second floor |

Every backoff library assumes there is no deadline. A certificate has one, and
as it approaches the cost of *not* retrying grows without bound while the cost
of retrying stays flat, so backing off further is exactly wrong. Never faster
than 60 seconds, though: a CA answering the same error once a second will not
answer differently on the two hundredth try.

Jittered ±20% either way. Forty renewals failing against one CA outage and all
coming back at the same instant is how a transient failure becomes a rate-limit
suspension.

`escalated_at` is set when a failure stops being a blip — three attempts, or a
single failure with less than seven days of runway, because close to expiry
there may not be room for many more attempts. The `cert.renewal_failed` alert
fires **once**, on escalation, not per attempt.

```
GET /api/v1/renewals?escalated=true
```

The listing surfaces a `warning` naming them: *"3 renewal(s) have been failing
long enough to need attention … Each of these is a certificate on a countdown."*

The listing defaults to outstanding jobs only — the question is almost always
"what is about to happen", not "what happened last month". `?outstanding=false`
returns the history.

## Renewal information (RFC 9773)

```
POST /api/v1/certificates/{id}/renewal-info      Ask the CA now      (operator)
```

A CA publishes a window it would like each certificate replaced inside.
CertPilot polls it, picks a **random instant** within the window rather than
renewing at its start — renewing at the start would move the thundering herd
rather than disperse it — and honours the CA's `Retry-After` when polling again,
floored at 15 minutes.

```json
{ "data": { "ari_supported": true,
            "ari_window_start": "2026-08-19T21:16:26Z",
            "ari_window_end":   "2026-08-20T09:16:26Z",
            "renewal_scheduled_at": "2026-08-20T03:03:48Z",
            "ari_next_check_at": "2026-08-19T03:16:26Z",
            "ari_explanation_url": "" },
  "summary": "The CA suggests renewing this certificate in 29 hours, and CertPilot picked a random moment inside its window rather than the start so that renewals do not cluster." }
```

`ari_supported` is **three-valued** and the summary says which state you are in:

| Value | Meaning |
|:---|:---|
| `null` | nobody has asked this CA yet; the lead time applies |
| `false` | asked, and this CA publishes nothing — *"it will not be able to warn you if it revokes this certificate in bulk"* |
| `true` | asked, and `renewal_scheduled_at` came from the CA |

Collapsing the first two would make a CA nobody has reached look identical to
one with nothing to say. A gateway that is *down* is recorded as neither: the
existing advice is left alone and retried, because a window does not stop being
true because the next call failed.

The advice overrides the configured lead time in both directions — it can bring
a renewal forward and hold one back — but **never past a seven-day safety
floor**, or past a third of the certificate's lifetime when that is shorter. A
six-day certificate is inside seven days from the moment it is issued, so an
unbounded floor would renew it on every sweep whatever the CA advised. Inside that window a certificate renews regardless of what the CA
suggested, so a bad window, or a stale one left by a poller that stopped
running, cannot defer something about to expire.

Only certificates that could act on the answer are polled: renewed
automatically, issued by a CA account, and with a stored body to name to that
CA. Asking about anything else spends somebody's rate limit to learn nothing.

### When the CA changes its mind

This is what the feature is for. A CA facing mass revocation pulls the affected
windows into the past, and for anyone not reading ARI that is an email to
whatever address is on the account.

A window brought **materially** forward — more than 12 hours, so an ordinary
re-draw inside an unchanged window is not mistaken for one — publishes
`cert.renewal_window_moved`, CRITICAL when the window has already opened:

> **ari-lab.example.com: the CA wants this replaced sooner**
>
> ARI Lab Issuing CA has brought this certificate's renewal window forward by
> about 3 days. A CA does that when something is wrong with a certificate it
> issued — most often a bulk revocation. CertPilot has rescheduled the renewal;
> check the explanation before assuming it is routine.

The alert carries the CA's own `explanationURL` when it sends one, and the
renewal moment with a **time** on it rather than only a date — during a
revocation, "in 55 minutes" and "sometime on 18 August" are different
instructions.

## Post-renewal verification


A renewal is not done when the certificate is stored. It is done when the thing
serving it is serving it — and a renewal does not deploy itself, so a successful
renewal routinely leaves a new certificate in the database and the old one in
front of the users, expiring on the old schedule under a green dashboard.

Every successful renewal schedules a check 30 minutes later (a deployment done
by hand does not happen in the same second as the issuance) and re-probes **the
endpoints discovery has actually observed serving that certificate**.

```json
409 Conflict
{ "state": "STALE",
  "summary": "127.0.0.1:9500 is still serving the certificate this renewal replaced. The new certificate exists in CertPilot and has not reached the server, so what users get expires on the old schedule." }
```

**409, not 200.** The status code carries the same news the body does, because a
script that only checks the code is the one most likely to be running this in a
pipeline.

| `verification_state` | Meaning |
|:---|:---|
| `PENDING` | renewed, inside the grace period |
| `VERIFIED` | every known endpoint serves the renewed certificate |
| `STALE` | an endpoint is serving something else — see below |
| `UNREACHABLE` | endpoints are known and did not answer |
| `NO_ENDPOINTS` | discovery has never observed this certificate anywhere |

`STALE` distinguishes three cases, because they need different actions:

- **still on the certificate this renewal replaced** — install the new one
- **an older certificate for this name** — renewals have been landing nowhere
  for more than one cycle
- **a certificate for a different name entirely** — something other than this
  certificate is terminating TLS there

Endpoints come from discovery, never from the certificate's SANs. Probing
hostnames read out of certificate data would have CertPilot opening connections
nobody asked for, to names that may not resolve to anything it should be
touching. A certificate discovery has never seen is `NO_ENDPOINTS` with the
sentence that fixes it — *"run a discovery scan that covers wherever it is
deployed"* — rather than a guess. **"We cannot verify this" is useful; a
fabricated verification is not.**

Silence is never success. An endpoint that does not answer is `UNREACHABLE`, and
a certificate where some endpoints serve the new one while others stay quiet is
*not* verified — the quiet ones are exactly the ones that might still be on the
old certificate.

The `cert.not_deployed` alert fires **once**, on the first check that finds it
stale. An unresolved certificate is rechecked on a widening schedule (30m, 1h,
4h, 12h, 24h) and then the verifier stops asking — but not reporting: the state
stays on the record.

## Rate limits: deferred is not failed

```
PUT /api/v1/ca-accounts/{id}/rate-limit          (operator)
{ "renewal_rate_limit": 50, "renewal_rate_window_hours": 168 }
```

A public CA counts certificates per registered domain per week, and exhausting
that suspends issuance for the whole organisation — at exactly the moment
somebody is reissuing to fix an outage. `0` means unlimited and is the default,
deliberately: inventing a limit for a CA whose real limits nobody entered would
delay renewals for a constraint that does not exist.

A renewal with no slot available is **deferred**, and a deferral is carefully
not a failure:

- `attempts` is not incremented — the claim's increment is undone, because
  nothing was tried
- `last_error` is left holding whatever real failure came before it
- nothing escalates: a job that waited nine times has not failed nine times
- `run_after` is set to the moment the oldest renewal ages out of the window, so
  it returns exactly once rather than polling

```json
{ "attempt_log": [ { "deferred": true,
    "reason": "letsencrypt-prod has renewed 50 certificate(s) in the last 168 hours, which is its limit of 50. A slot opens at 2026-08-25T20:53:33+02:00." } ] }
```

The listing counts them separately as `waiting_on_rate_limit`, because a waiting
renewal is the pacing working and a stuck one is a certificate on a countdown.

Counted in the database rather than in a per-process token bucket: N replicas
each holding their own would allow N times the limit. A limit that cannot be
*read* never blocks a renewal — turning a database hiccup into an expiry is a
much worse trade than being one certificate over a quota.

**When the quota outlasts the certificate** it is not a deferral at all, and the
alert says so in different words, because retrying will not fix it:

> `step7-filter-probe.example.com` cannot be renewed because the CA account's
> renewal rate limit is full until 29 November 2028, and it expires on
> 18 August 2027. Retrying will not fix this: the limit has to be raised, or
> this certificate moved to another CA account.

Published once, when it is first noticed — months before the day, not on the
morning it happens.

## Ordering, leases, and why there is no leader

Jobs are claimed **by the deadline being raced, not by age**. A certificate
expiring tomorrow outranks one enqueued an hour earlier with a month left.

A claim is a **lease** — `locked_by` and `locked_until`. A worker killed
mid-renewal does not need to be cleaned up after: its claim expires and another
worker takes the job. Long renewals heartbeat to extend it, so an ACME order
waiting on DNS propagation is not stolen mid-flight.

There is no leader election and no advisory lock. Enqueues collide on a partial
unique index (`at most one outstanding job per certificate`) and claims use
`FOR UPDATE SKIP LOCKED`, so N replicas can all run the sweep and all run
workers without duplicating anything. A leader would be a single point of
failure with a window after it dies during which nothing renews at all, which is
a strange thing to build into the component whose entire job is that nothing
lapses.

## Cancelling

```
DELETE /api/v1/renewals/{id}
{ "message": "Renewal cancelled. Nothing is now scheduled to replace this certificate before it expires." }
```

Admin, and the response says what it costs. Cancelling is never how a failure is
handled — a renewal nobody cancelled keeps trying.
