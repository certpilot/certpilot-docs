<!-- Synced from docs/api-reference.md in certpilot/certpilot at 9e9a56600009, last changed 2026-09-21T21:48:46Z.
     Source heading: "Display tokens". Edit it there, not here. -->

Create:

```json
{ "name": "fourth-floor-corridor", "expires_in_days": 90 }
```

`name` is required and unique — it is what makes "revoke the screen by the lifts"
an answerable request. `expires_in_days` defaults to 90 and is capped at 365;
there is no unlimited option.

```json
{
  "token": "cpd_...",
  "display": { "id": "...", "name": "...", "status": "ACTIVE", "expires_at": "..." },
  "warning": "This token is shown once and cannot be retrieved again. ..."
}
```

**`token` appears in this response and nowhere else.** Only its SHA-256 is
stored, so a database dump yields no working credentials — and neither does the
list endpoint, which returns everything except the hash.

`status` is `ACTIVE`, `EXPIRED`, or `REVOKED`. Revocation outranks expiry, and
is a soft delete: the row survives with `revoked_at` and `revoked_by` set,
because when a credential had to be pulled is exactly what someone will ask
later.

See [Authenticating an unattended screen](/api/display-tokens)
for what the credential can and cannot do.
