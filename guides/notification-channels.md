<!-- Synced from docs/api-reference.md in certpilot/certpilot at 81031950a7b7, last changed 2026-09-26T11:56:08Z.
     Source heading: "Notification channels". Edit it there, not here. -->

Three channel types have a notifier: `slack`, `webhook`, `email`. Migration 001
also permitted `teams` and `pagerduty`; neither is implemented and 004 narrowed
the constraint, because a channel of a type nothing can deliver looks configured
on the dashboard and silently drops every alert routed to it.

`config` carries the destination's settings and is **write-only**. It is
validated by the notifier, sealed with the keyring, and never returned — not by
the create response and not by the list. Omit it on an update to keep what is
stored; send it to replace it wholesale.

| Field | |
|:---|:---|
| `name` | Required. What names the channel in a delivery failure |
| `channel_type` | `slack`, `webhook`, or `email` |
| `severity_threshold` | `INFO`, `WARNING` (default), or `CRITICAL` — the minimum this channel delivers |
| `topics` | Event topics to accept. **Empty means all**, which is the useful default. An unknown topic is rejected rather than accepted and ignored |
| `is_enabled` | Defaults to true on create |

Configuration per type:

```jsonc
// slack — webhook_url must be https; it is a bearer credential
{"webhook_url": "https://hooks.slack.com/services/...", "username": "", "icon_emoji": ""}

// webhook
{"url": "https://receiver.example.com/hook",
 "signing_secret": "at least 16 characters",
 "headers": {"X-Tenant": "acme"},
 "allow_insecure_http": false}

// email
{"host": "smtp.example.com", "port": 587,
 "username": "", "password": "",
 "from": "pki@example.com", "to": ["oncall@example.com"],
 "encryption": "starttls",   // or "tls" (465) or "none"
 "insecure_skip_verify": false}
```

## Testing a channel

`POST /notification-channels/:id/test` sends a real, clearly labelled test alert.
It does not retry and returns the destination's own complaint verbatim:

```json
{"delivered": false, "error": "Slack returned 403: invalid_token"}
```

The status is **502**, not 500: CertPilot worked and the destination did not, and
that distinction is the entire content of the answer.

## Webhook payload and signature

```json
{
  "severity": "CRITICAL",
  "topic": "ca.expiry_alert",
  "title": "CA expiring: Corporate Issuing CA",
  "summary": "Corporate Issuing CA expires in 9 days. Every certificate it has issued stops validating when it does.",
  "entity_id": "…",
  "fields": [{"label": "Days remaining", "value": "9 days"}],
  "timestamp": "2026-08-17T07:33:24Z",
  "source": "certpilot"
}
```

| Header | |
|:---|:---|
| `X-CertPilot-Event` | The topic, so a receiver can route without parsing |
| `X-CertPilot-Timestamp` | Unix seconds |
| `X-CertPilot-Signature` | Hex HMAC-SHA256, present only when a signing secret is configured |

The signed string is exactly `<X-CertPilot-Timestamp> "." <raw request body>`.
Verify it in constant time and reject anything outside a few minutes' tolerance.
The timestamp is inside the signature rather than merely alongside it: signing
the body alone yields a signature that stays valid forever, so a captured
delivery could be replayed indefinitely and the receiver could not tell.

```python
import hashlib, hmac
want = hmac.new(secret, ts.encode() + b"." + body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(want, signature)
```

## Delivery behaviour

The dispatcher subscribes to the event broker rather than being called inline, so
a wedged destination loses its own place in the queue and can never apply
backpressure to the CA health sweep. Deliveries retry three times with jittered
exponential backoff, then stop — an endpoint that has refused three times inside
a minute is down, and retrying past that turns one outage into a queue that
outlives it.

Both outcomes are audited as `notification.sent` and `notification.failed`, and
are queryable through `/dashboard/activity?action=notification.failed`.
