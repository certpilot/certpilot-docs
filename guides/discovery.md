<!-- Synced from docs/api-reference.md in certpilot/certpilot at 9e9a56600009, last changed 2026-09-21T21:48:46Z.
     Source heading: "Discovery". Edit it there, not here. -->

Scanning is operator-gated because it opens connections to third-party
infrastructure from CertPilot's address. Every run is recorded in the audit log
with the targets it was given, so "who asked us to connect to that" is
answerable afterwards. One request is capped at 256 targets.

```json
POST /api/v1/discovery/scan
{ "targets": ["example.com", "10.0.0.0/24", "10.0.0.4-40:8443"], "ports": [443, 8443] }
```

Each entry may be a host, `host:port`, a CIDR network, or an inclusive address
range — `10.0.0.4-10.0.0.40` or the abbreviated `10.0.0.4-40`. A network or
range may name its own port. `ports` applies to everything that does not, and
multiplies the endpoint count. `host: "…"` is accepted as the single-target form.

Everything is expanded and checked before anything is connected to: a malformed
entry fails the whole request rather than leaving you unsure which part of your
list was reached. Network and broadcast addresses are skipped for IPv4 prefixes
wider than /31, so `10.0.0.0/24` is 254 endpoints and not 256.

Two limits apply. A request carries at most **256 entries**, and those may
expand to at most **4096 endpoints**. The second is the one that matters: a
misplaced digit turns `10.0.0.0/24` into `10.0.0.0/8`, and the refusal names the
size so the typo is visible rather than merely denied.

```
10.0.0.0/8 covers 16777216 addresses, past the 4096-endpoint limit for one
scan; narrow it
```

## Small scans wait, wide scans do not

At **32 endpoints or fewer** the scan runs while you wait and returns `200` with
its results. Above that it goes to the background and returns `202` with a poll
URL. The response says which happened without you having to read the status
code — `scan.status` is `COMPLETED` or `RUNNING`:

```json
{
  "scan": { "id": "…", "status": "RUNNING", "target_count": 254, "results_count": 0 },
  "poll": "/api/v1/discovery/scans/<id>",
  "summary": "Scanning 254 endpoints in the background. Results appear as they are found."
}
```

Results are written as they are found, not at the end, so polling shows real
progress and a run that is interrupted keeps what it reached. Progress is also
published to the event stream as `discovery.progress` — **stream only**: it is
never delivered to a notification channel, because a range scan would otherwise
put a message in Slack every few seconds for minutes, and a team that mutes that
channel has also muted CA expiry.


Cancelling keeps everything already found and records the run as `CANCELLED`,
not `FAILED` — the history has to distinguish "somebody stopped it" from
"something went wrong". Endpoints abandoned mid-probe are **not** recorded as
unreachable: they were never really asked, and a row saying otherwise would be a
finding about the estate invented by stopping the scan. Cancelling a run that
has already finished is not an error; the response names its actual status.

The scan record keeps the targets **as they were typed** — `10.0.0.0/24`, not
254 addresses — with `target_count` carrying how far that expanded. A scan is
repeated by re-running what was asked for and found again by the range someone
remembers typing.

The response carries the run, the results, and a sentence:

```json
{
  "scan": { "results_count": 7, "unmanaged_count": 6, "managed_count": 0, "unreachable_count": 1 },
  "data": [ … ],
  "summary": "6 certificate(s) are being served that CertPilot does not manage. Nothing renews them."
}
```

The `summary` exists because the counts alone are ambiguous in the one direction
that matters: an estate where nothing answered and an estate where everything is
managed both produce zero unmanaged results.

## The verdicts

Each result carries two, and they answer different questions.

`management_state` — **`MANAGED`** when the served certificate's SHA-256
fingerprint matches a row in `certificates`, **`UNMANAGED`** when it does not,
**`UNREACHABLE`** when no handshake completed. Matched on fingerprint, not on
name: two certificates for the same hostname are two different certificates, and
the one being served is the one that expires. An inventory lookup that fails
reports `UNMANAGED`, with a finding saying so — calling something managed that
could not be checked is how a lookup error becomes an outage.

`trust_state` — **`PUBLIC`**, **`INTERNAL`** (chains to a CA registered in
CertPilot), **`SELF_SIGNED`**, **`UNTRUSTED`** (neither), or **`UNKNOWN`**.
Internal trust is decided on signatures rather than by path building, so an
expired certificate still reports the CA that issued it instead of reading as a
rogue issuer.

## Findings

`findings` is an array of `{code, severity, detail}`. Codes are stable:
`expired`, `not_yet_valid`, `expiring_soon`, `hostname_mismatch`, `self_signed`,
`untrusted_issuer`, `incomplete_chain`, `weak_key`, `weak_signature`,
`legacy_tls`, `weak_cipher`, `no_forward_secrecy`, `long_validity`,
`internal_issuer`, `inventory_lookup_failed`.

`weak_signature` covers the whole served chain, not just the leaf: a SHA-1
intermediate breaks a connection as completely as a SHA-1 leaf, and is the more
common of the two. Self-signed certificates are skipped, since a root's own
signature is never verified by anything.

A classical key exchange is deliberately **not** a finding. It is true of nearly
every endpoint alive, and a finding on every row is not a finding. The
negotiated group is recorded verbatim in `key_exchange` instead — that column is
what a posture report reads.

## Import

```json
POST /api/v1/discovery/import
{ "result_id": "…", "team": "Platform", "environment": "production" }
```

`certificate_pem` is accepted instead, for a certificate someone has in hand.

**`auto_renew` is always false on import, whatever was requested.** CertPilot
holds no private key for something it merely observed, so a record claiming it
will renew itself is a promise the system cannot keep — and the moment you find
out is expiry. The response says so in words. Importing the same certificate
twice converges on one record and returns 200 rather than a conflict.

Publishes `discovery.unmanaged` (WARNING) when a run finds anything unmanaged,
so the finding reaches the channels a team already configured instead of waiting
to be noticed on a page nobody has open.

## Scheduled scans

```json
POST /api/v1/discovery/schedules
{ "name": "nightly perimeter", "targets": ["10.0.0.0/24"], "interval_minutes": 1440 }
```

An interval, not a cron expression. A cron field is a small language whose
mistakes are silent, and a schedule meant to run nightly that instead runs
yearly looks identical on screen to one that works. The floor is 15 minutes;
below that a scan of the same range is indistinguishable from a denial of
service aimed at your own estate.

Targets are expanded and validated **when the schedule is saved**, not when it
first fires — including a check that the run can finish before the next one
starts. A schedule that looks configured and silently never scans is worse than
no schedule, and 3am on the night it mattered is the wrong time to find out its
targets do not parse.

A new schedule runs within the minute, so you can see it work rather than find
out tomorrow. `last_run_at`, `next_run_at`, `last_scan_id`, and `last_error` are
on every schedule: one that fails every night and is never read is the
appearance of coverage. `POST …/run` starts it immediately **without** moving
its schedule — testing what you just wrote should not silently push tonight's
run to tomorrow.

> Two replicas both run every schedule. Leader election over Postgres advisory
> locks arrives with the renewal engine in phase 4, which has the same gap.

## What a repeated scan adds

The second run of a scan is not worth much as a list. It is worth what it says
has **changed**, and three findings exist only on a re-scan:

| Code | |
|:---|:---|
| `certificate_changed` | The endpoint is serving a different certificate. **WARNING** when CertPilot manages neither the old nor the new one — something out there is renewing certificates without going through this system, so somebody knows how to replace it. **INFO** when the new one is managed, because that is a renewal it performed |
| `endpoint_disappeared` | It answered last time and does not now: either it moved and the scan no longer covers it, or it is down |
| `endpoint_appeared` | It did not answer last time and does now |

A first scan reports none of these. Every endpoint is new the first time, and a
run whose findings are all "this is new" is one nobody reads twice.

Changes publish `discovery.changed` (WARNING), separate from
`discovery.unmanaged`: "there is an endpoint you do not manage" may have been
true for years, while "the certificate on it changed last night" is a fact about
somebody actively operating it.

## One row per endpoint

`GET /discovery/results` returns the **latest observation of each endpoint** by
default. A nightly schedule records the same unmanaged certificate every night,
and counting each of those as a separate finding turns one problem into thirty
until the number stops meaning anything.

The collapse happens *before* the filters, which is the part that is easy to get
backwards: filtering first would answer "the most recent time this endpoint was
unmanaged" and keep asking for work that has already been done. Pass
`latest=false` for the full history, which is what an investigation wants.
