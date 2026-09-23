<!-- Synced from docs/api-reference.md in certpilot/certpilot at 9e9a56600009, last changed 2026-09-21T21:48:46Z.
     Source heading: "Certificates". Edit it there, not here. -->

`GET /certificates` filters on `status`, `environment`, `common_name`,
`ca_account_id`.

## Issuing

```http
POST /api/v1/certificates
```

```json
{
  "common_name": "app.example.com",
  "sans": ["www.app.example.com"],
  "ca_account_id": "uuid",
  "key_type": "ECDSA",
  "key_size": 256,
  "validity_days": 90,
  "environment": "production",
  "team": "platform",
  "auto_renew": true,
  "renewal_lead_days": 30
}
```

What happens, in order: the CA account is loaded, policy is evaluated, the
gateway is located, its stored configuration is decrypted for exactly this one
call, issuance is requested, and the returned certificate is **parsed before it
is stored**. A gateway that returns anything other than a valid X.509
certificate produces a 502 rather than a record marked `ISSUED`.

Metadata on the stored record — serial, issuer, validity dates, fingerprint,
key type and size — is read from the certificate itself, not from what the
gateway claimed.

If the gateway returns a private key, it is sealed before it touches the
database. Supplying your own CSR avoids this entirely and is the better pattern:
the key then stays wherever it was generated.

Returns `201`. When non-blocking policy violations were recorded, the body is
`{"certificate": {...}, "policy_violations": [...]}` instead of the bare record —
a policy that finds something must say so even when it does not block.

## Renewing

`POST /certificates/:id/renew` runs the same path. The key is rotated and the
new one persisted; a renewal that produced a certificate without storing its
matching key would leave a record that looks healthy and cannot terminate TLS.

On failure the record is marked `RENEWAL_FAILED` with `renewal_error` set, and
the previous certificate is left intact.

## Exporting a private key

```http
GET /api/v1/certificates/:id/private-key
```

```json
{ "common_name": "app.example.com", "private_key_pem": "-----BEGIN..." }
```

Admin only. Writes `cert.private_key_exported` to the audit log with the actor
and client IP. Returns 404 when no key is stored — which is the normal case for
imported, discovered, or CSR-based certificates.

## Revoking

```http
POST /api/v1/certificates/:id/revoke
```

```json
{ "reason": 1 }
```

Admin only. **The CA is told first, and the record is updated only if the CA
agreed.** The ordering is the guarantee: a record reading `REVOKED` beside a
certificate that still answers handshakes is worse than either alternative, so
every failure on this path leaves the record untouched and says so.

`reason` is required. Accepted codes are `0` unspecified, `1` keyCompromise,
`3` affiliationChanged, `4` superseded, `5` cessationOfOperation, `9`
privilegeWithdrawn — the subset of RFC 5280 a CA will act on. Anything else is
a 400 listing them, so a caller does not have to go and read the RFC.

| Status | When |
|:---|:---|
| `200` | Revoked at the CA and recorded |
| `400` | Missing or unaccepted reason; no stored copy of the certificate; or no CA account to send it to |
| `404` | No such certificate |
| `409` | Already revoked — the CA is not asked again |
| `502` | Gateway not connected, or the CA declined. Nothing has been changed |
| `500` | The CA revoked it and the record could not be written. The certificate is dead and the record is wrong until the write succeeds |

Writes `certificate.revoked` to the audit log with the actor, reason code and
fingerprint, and publishes `cert.revoked` on the event stream so a wall display
reflects it without waiting for a sweep.

`DELETE /certificates/:id` is not a substitute: it removes the record and the
certificate stays valid at the CA. It refuses a live certificate with a 409 that
names this endpoint; `?forget=true` overrides that deliberately.
