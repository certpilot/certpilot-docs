<!-- Synced from docs/api-reference.md in certpilot/certpilot at 51f86f743471, last changed 2026-09-26T16:23:02Z.
     Source heading: "Cloud inventory". Edit it there, not here. -->

The third place certificates hide. A scan finds what is **served**; Certificate
Transparency finds what a public CA **issued**; neither finds what is merely
**stored** — in ACM, in a Key Vault, in a Google load balancer, in a Kubernetes
secret, attached to an address nobody scanned or attached to nothing at all.

## What each provider needs

```json
POST /api/v1/cloud/connections
{ "name": "prod-eu", "provider": "aws_acm", "sync_interval_minutes": 360,
  "config": { "region": "eu-west-1",
              "role_arn": "arn:aws:iam::1234:role/certpilot-read",
              "web_identity_token_file": "/var/run/secrets/eks.amazonaws.com/serviceaccount/token" } }
```

| `provider` | `config` | Credentials |
|:---|:---|:---|
| `aws_acm` | `region` | `access_key_id` + `secret_access_key` (+ `session_token`), or `role_arn` + `web_identity_token_file` |
| `azure_key_vault` | `vault_url` | `tenant_id` + `client_id` + `client_secret`, or `managed_identity: true` |
| `gcp` | `project_id` | `service_account_json`, or `use_metadata_server: true` |
| `kubernetes` | `api_url`, optional `namespaces`, `ca_cert` | `token`, or `in_cluster: true` |

Read-only permissions are enough everywhere, and the narrower the better —
`acm:ListCertificates` and `acm:GetCertificate`; `certificates/get` and
`certificates/list` on the vault; `compute.sslCertificates.list`; `get` and
`list` on secrets and ingresses.

`config` is validated **before** it is sealed, so a missing region or a
malformed service account key is a 400 while somebody is typing it, rather than
a sync failure six hours later that reads on a dashboard like the account
refusing the connection. It is then encrypted with the keyring under its own
context string. No endpoint returns it, the listing does not carry the sealed
blob either, and the audit entry records the act rather than the credential.

The floor on `sync_interval_minutes` is **30**. Lower than Certificate
Transparency's, because these are your own accounts rather than somebody's free
service — but not trivial, because every sync is a burst of API calls against a
quota your deployments share.

## The finding this exists for

Not "here is another certificate". This:

| Provider | Renews | Does not renew, and looks identical |
|:---|:---|:---|
| AWS ACM | Amazon-issued and still validating | anything **imported** — `RenewalEligibility: INELIGIBLE` |
| Azure Key Vault | a policy with an `AutoRenew` action | policy issuer `Unknown` — uploaded as a PFX, no issuer to go back to |
| Google Cloud | `MANAGED` | `SELF_MANAGED` |
| Kubernetes | secrets cert-manager annotates | every other `kubernetes.io/tls` secret |

Findings carry the provider's own word for it, because that word is what
somebody has to go and find in their console:

```json
{ "code": "will_not_renew", "severity": "CRITICAL",
  "detail": "Nothing renews this certificate: AWS Certificate Manager reports it as \"IMPORTED\". It expires in 2 weeks, and it will simply stop working then unless somebody replaces it by hand." }
```

Severity tracks **time, not category** — `INFO` beyond 90 days, `WARNING` inside
it, `CRITICAL` inside 30 — because a finding that appears on every row is the
noise that stops people reading the list. `will_not_renew` is raised alongside
`expired` rather than instead of it: an expired certificate cert-manager is
about to replace and an expired certificate nobody will ever replace need
opposite responses.

The inverse is the sharpest finding here. `renewal_overdue` fires when a
provider says it renews a certificate and has not, within a week of expiry —
automatic renewal has failed, and nothing else in the system would have said so.

Filter on any of them:


## Scopes, or what was not looked at

Every successful sync records what it enumerated, in the provider's own words,
and the sync response returns it:

```json
"scopes": [
  "AWS Certificate Manager in eu-west-1 only — certificates in other regions are not visible to this connection",
  "each certificate's PEM body, to match it against inventory by fingerprint"
]
```

ACM is regional. GCP Certificate Manager is **not** covered — the GCP connection
reads `compute.sslCertificates`, and says so. A tool that covers one corner of a
provider while presenting itself as covering the provider produces a short list
that reads as a small estate when it is really a narrow search.

## Synced, versus answered

As with Certificate Transparency, `last_synced_at` and `last_success_at` are
separate columns and the listing surfaces `stale_connections`. A connection
whose credentials lapsed three days ago still attempts every hour, so its "last
synced" is a minute old and means nothing.

`POST …/sync` answers **502** when the provider does not, carrying the
provider's own words and the sentence *"The sync did not complete, so nothing
was learned about this account. It is not the same as finding no
certificates."* It is bounded at 25 seconds, under the server's write timeout,
so the response is never truncated into an empty body that reads as success.

A failed sync also never concludes that the estate was dismantled: certificates
are only marked as gone after a sync that answered, and an answer containing
nothing at all is treated as suspect rather than as an empty account.

## Attachment is three-valued

`attached` is `true`, `false`, or **absent**. Absent means the provider could
not be asked — a Key Vault has no notion of what is serving its certificates,
and a Kubernetes connection without read access to ingresses cannot tell either.
Reporting "nothing is using this" in those cases would be inventing a finding.
`false` is a real one: nobody will notice it expire, and it is still there to be
attached to something during an incident.

## Certificates that disappear

A certificate a successful sync no longer finds is marked `removed_at` and drops
out of the default listing. The row is kept — that a certificate vanished from a
production account is information, and deleting it takes its own history along
with it. `?include_removed=true` brings them back.

## Import

```json
POST /api/v1/cloud/import
{ "cloud_certificate_id": "…", "team": "Payments", "environment": "production" }
```

The certificate becomes a watched inventory record with
`discovered_via: "CLOUD"` and `auto_renew: false` — always false, whatever was
asked for. CertPilot holds no private key for something it read out of somebody
else's store. The response says so, and adds the reason it was found in the
first place: *"Note that the provider does not renew it either."*
