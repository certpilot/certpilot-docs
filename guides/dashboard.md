<!-- Synced from docs/api-reference.md in certpilot/certpilot at 9e9a56600009, last changed 2026-09-21T21:48:46Z.
     Source heading: "Dashboard". Edit it there, not here. -->

## Statistics

The five CA counts partition the estate — every authority lands in exactly one,
and they sum to `total_cas`:

| Field | |
|:---|:---|
| `healthy_cas` | |
| `warning_cas` | |
| `critical_cas` | Close to expiry. Still replaceable in an orderly way |
| `expired_cas` | Already an outage. Separate from critical because the response differs |
| `unknown_cas` | Never checked, or the certificate could not be parsed |

`unknown_cas` is reported rather than folded away: a CA nobody can assess is not
a healthy one, and hiding it is how a green dashboard covers an unmonitored CA.

## Activity


| Parameter | |
|:---|:---|
| `action` | Repeatable, or comma-separated. Matches any of the listed actions |
| `entity_type`, `entity_id` | Narrow to one object's history |
| `since` | RFC 3339 timestamp, inclusive lower bound |
| `limit` | 1–500, default 20 |
| `offset` | |

`total` counts the filtered set, not the table, so a client paging through CA
alerts is told how many alerts exist rather than how large the audit log is.

Filtering is what makes CA alerts reachable. They share a table with every
issuance, so without it the newest twenty rows on a busy day contain no alerts
at all — they were recorded, and never seen. An unparseable `since`, `limit`, or
`offset` is a 400 rather than a silently ignored parameter: a filter that
quietly does nothing is worse than one that fails, because the caller believes
they are looking at a narrowed view.

> Refused to kiosk display tokens. Audit entries carry actor identity, and
> "alice@example.com deleted a certificate" does not belong on a corridor
> screen. Signed-in `viewer` accounts are not restricted.
