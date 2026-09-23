<!-- Synced from docs/api-reference.md in certpilot/certpilot at 9e9a56600009, last changed 2026-09-21T21:48:46Z.
     Source heading: "Live event stream". Edit it there, not here. -->

Opens with a `retry:` directive and a `snapshot` event carrying current
dashboard statistics and a CA summary per authority, so a client never renders
from an empty store. Live events follow, and a `: heartbeat` comment every 15
seconds keeps intermediaries from reaping the connection — and lets a client
tell "nothing is happening" from "I have stopped receiving", which on a wall
display is the difference that matters.

```
event: ca.expiry_alert
id: 42
data: {"id":42,"topic":"ca.expiry_alert","severity":"CRITICAL","entity_id":"...","payload":{...}}
```

Topics: `ca.health`, `ca.expiry_alert`, `cert.issued`, `cert.renewed`,
`cert.renewal_failed`, `cert.expiring`, `gateway.status`.

Reconnecting clients send `Last-Event-ID` (or `?last_event_id=`) and are
replayed from that point. When the gap is larger than the broker's history, or a
client falls behind mid-stream, the server sends `event: resync` followed by a
fresh snapshot rather than deltas onto a stale base — a dashboard that looks
live and is wrong is worse than one that admits it lost its place.

The snapshot deliberately omits `certificate_pem`: it is kilobytes per CA, it is
re-sent on every resync, and no dashboard uses it.

> Behind a reverse proxy, buffering must be off for this route or the stream
> arrives in chunks and the display looks frozen. See
> [`deploy/docker/nginx.conf`](https://github.com/certpilot/certpilot/blob/main/deploy/docker/nginx.conf).
