<!-- Synced from docs/api-reference.md in certpilot/certpilot at 81031950a7b7, last changed 2026-09-26T11:56:08Z.
     Source heading: "CA accounts and gateways". Edit it there, not here. -->

## Registering

```json
{
  "name": "letsencrypt-prod",
  "provider_type": "acme",
  "gateway_addr": "acme-gateway:9092",
  "server_name": "acme-gateway",
  "config": {
    "directory_url": "letsencrypt",
    "email": "ops@example.com",
    "challenge": "dns-01",
    "dns_provider": "cloudflare",
    "dns_config": {"api_token": "..."}
  },
  "is_default": false
}
```

The core connects over mTLS, calls the gateway's `ValidateConfig`, and stores
nothing if the gateway rejects it — a 400 comes back listing what is wrong.
Warnings do not block and are returned alongside the created account.

`config` is sealed with AES-256-GCM before storage and decrypted only to
populate a single outbound gRPC call. It is not readable back through the API.

`server_name` overrides the name expected in the gateway's TLS certificate;
omit it to derive from the host part of `gateway_addr`.
