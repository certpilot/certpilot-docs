<!-- Synced from docs/api-reference.md in certpilot/certpilot at 51f86f743471, last changed 2026-09-26T16:23:02Z.
     Source heading: "PKI and CA authorities", "Ownership and acknowledgement". Edit it there, not here. -->

## Importing the CAs behind a CA account

```http
POST /api/v1/pki/authorities/import
POST /api/v1/pki/authorities/import?account=vault-issuing
```

Asks every connected gateway that reports `supports_ca_info` for its issuers and
records them. This runs on its own timer and when a CA account is created; the
endpoint is for the moment after somebody has rotated an issuer and wants to see
it land rather than wait.

```json
{
  "summary": {"added": 2, "refreshed": 0},
  "data": [{
    "account": "vault-issuing",
    "outcomes": [
      {"name": "pki-int/Corp Root CA", "action": "added", "days_remaining": 3649},
      {"name": "pki-int/Corp Issuing CA", "action": "added", "days_remaining": 1824}
    ]
  }]
}
```

An imported CA carries `source: "GATEWAY"` and `last_seen_at`. A sweep refreshes
what the certificate says and never overwrites the name, alert thresholds,
owning team, tags or notes — those are what an operator decided. A CA that stops
being offered is not deleted: it signed certificates that are still being
served, so `last_seen_at` goes stale instead.

Entries a gateway names without sending a certificate are skipped with a reason.
There is no expiry to monitor and nothing to identify them by, and the ACME
gateway returns exactly this — ACME publishes no endpoint listing issuers.

`GET /pki/authorities` filters and sorts:

| Parameter | |
|:---|:---|
| `status` | `HEALTHY`, `WARNING`, `CRITICAL`, `EXPIRED`, `UNKNOWN` |
| `expiring_within_days` | Keeps CAs expiring inside the window |
| `sort` | `urgency` (soonest expiry first) or `name` (default) |

`urgency` is the order the CA health view is built on: the question a team
watching a wall display is asking is which authority fails first, and an
alphabetical list answers a different one.

The expiry window is evaluated against `not_after`, not the stored
`days_remaining`. That column is a snapshot written by the health sweep and is
stale by however long it has been since the last one — a CA whose sweep has not
run since registration would otherwise report itself comfortable while expiring
next week.

The list omits `certificate_pem`; the detail endpoint still returns it. It is
kilobytes per CA, no client renders it, and the list is re-read on every
dashboard refresh.

> The CRL freshness check is real. The OCSP check currently issues a plain GET
> rather than an RFC 6960 request and reports a responder as healthy when it
> should not — see the README's known gaps.

## The hierarchy

`GET /pki/tree` returns roots with their children attached recursively. Each
node carries the authority, its `children`, and its `depth` — issuing steps from
the root of its own chain, so a root is `0`.

```json
{
  "authority": { "id": "...", "name": "Corporate Root", "...": "..." },
  "depth": 0,
  "children": [
    { "authority": { "name": "Corporate Intermediate" }, "depth": 1, "children": [] }
  ]
}
```

Three guarantees, because the interesting cases here are malformed hierarchies
rather than well-formed ones:

- **Every registered CA appears exactly once**, including ones whose parentage is
  wrong. A CA missing from a monitoring view is the one nobody notices expiring.
- **The response is always acyclic and always serialisable.** A CA naming itself,
  or a ring of CAs naming each other, is broken out to the top level rather than
  reproduced as a loop.
- **The order is stable.** Siblings sort by name, then id, so the tree does not
  reshuffle itself between identical requests.

A CA that could not be placed under a real root is returned at the top level with
`"detached": true` and a `detached_reason` naming the problem:

| Reason | Meaning |
|:---|:---|
| `its issuing CA is not registered in CertPilot` | Ordinary — a root held offline, or an intermediate imported on its own |
| `this CA is recorded as its own issuer` | Bad data. `parent_ca_id` points at the CA itself |
| `its issuer chain forms a loop, so it has no root` | Bad data. Two or more CAs name each other |

The last two are also logged at `WARN` by the core, since they mean the recorded
hierarchy is wrong rather than merely incomplete.

## Ownership and acknowledgement

**Silencing suppresses delivery, never display.** An acknowledged CA still
appears on `/pki/authorities`, on the CA health view, and on the wall display,
with its status unchanged and an `acknowledgement` object attached. Nothing here
removes a row. Hiding a problem because someone clicked a button is how CAs
expire in organisations that believed they were monitoring them.

## Acknowledging

```json
{"note": "replacement issued, cutover Thursday", "silence_days": 7, "threshold": 14}
```

| Field | |
|:---|:---|
| `note` | Why. The most useful field: it turns a red row from an unanswered alarm into a status, and stops the next person re-investigating |
| `silence_days` | Suppress **delivery** for this many days. `0` (the default) acknowledges without silencing — the alert stops being new and still goes out. Capped at 90 |
| `threshold` | The expiry threshold in days this covers. Defaults to the CA's current `last_alert_threshold` |

There is no indefinite silence. A permanent one is indistinguishable from
deleting the alert, and the CA goes on expiring while the team believes it is
monitored.

**An acknowledgement is bound to its threshold.** Silencing a CA at 30 days does
not silence its 7-day alert: the situation has materially worsened, and the
earlier "yes, we know" answered a different question. The same rule governs
display — a CA that has since crossed a tighter threshold stops showing as
acknowledged, because the annotation would otherwise become the false
reassurance the feature exists to prevent.

The response states what was and was not changed, because "acknowledged" is
ambiguous and the ambiguity is the dangerous part:

```json
{
  "data": {"id": "…", "threshold": 7, "silence_until": "2026-08-24T09:48:18Z", "note": "…"},
  "note": "This certificate authority still appears on the dashboard and the wall display, now marked as acknowledged. Delivery is suppressed until 24 August 2026 09:48 CEST, but only for the 7-day threshold: if it crosses a tighter one, it alerts again."
}
```

Withdrawal marks rather than deletes: a CA acknowledged in error and then
un-acknowledged is something an incident review wants to see, not a row that
quietly disappeared. `GET …/acknowledgements` returns the full history, newest
first, revoked entries included.

If the acknowledgement lookup fails, the alert is **delivered anyway**. The cost
of a duplicate notification is an annoyed engineer; the cost of a suppressed one
is an expired CA.

## Ownership

```json
{"owner_team": "Platform Security", "owner_email": "pki@example.com"}
```

Both are free text — team names and distribution lists do not live in CertPilot.
Send an empty string to clear either: ownership moving to nobody is a real state,
and one worth seeing on the dashboard rather than silently keeping the old team's
name. A CA with no owner renders as "Nobody", not as a blank cell.
