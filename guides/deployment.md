<!-- Synced from docs/api-reference.md in certpilot/certpilot at 9e9a56600009, last changed 2026-09-21T21:48:46Z.
     Source heading: "Deployment", "Cryptographic posture". Edit it there, not here. -->

Everything above deployment in this document observes. This changes something
that is already carrying traffic:

> Renewal creates new material. Deployment replaces material that is currently
> in use.

## Targets, and the column that answers a security question

```json
POST /api/v1/deployment-targets
{
  "name": "lab nginx",
  "description": "receiver that writes /etc/nginx/certs and reloads",
  "target_type": "webhook",
  "config": {
    "url": "https://deploy.internal/install",
    "signing_secret": "at-least-sixteen-characters",
    "include_private_key": true,
    "headers": {"X-Tenant": "eu"}
  }
}
```

The configuration is sealed with the keyring under
`secrets.ContextDeploymentConfig` and never leaves the process. What the list
*does* carry is `deploys_private_key`:

```json
GET /api/v1/deployment-targets
{ "count": 6, "carrying_private_key": 1, "supported_types": ["webhook"], "data": [ … ] }
```

A plain column, set when the target is created, deliberately not derived from
the sealed config at read time. **"Which places does this organisation ship
private keys to" is a question a security team should be able to answer with a
SELECT** — without the KEK, and without something that can decrypt every
deployment credential in the system having to be involved.

`supported_types` is shorter than what the schema permits. `deployment_targets`
has allowed `filesystem`, `aws_acm`, `kubernetes`, `gcp_lb` and `azure_kv` since
migration 001; accepting one because a check constraint tolerates it would
create a target that can be configured, bound, and queued, and that fails at the
last possible moment.

## The webhook deployer

The escape hatch: anything you can put fifteen lines of HTTP handler in front of
is a deployment target. The body is a documented, stable shape:

```json
{
  "event": "cert.deploy",
  "certificate_id": "…",
  "common_name": "app.example.com",
  "sans": ["app.example.com"],
  "serial_number": "…",
  "fingerprint_sha256": "…",
  "not_before": "2026-08-21T00:06:47Z",
  "not_after": "2027-08-21T00:06:47Z",
  "certificate_pem": "-----BEGIN CERTIFICATE-----\n…",
  "chain_pem": "-----BEGIN CERTIFICATE-----\n…",
  "private_key_pem": "-----BEGIN PRIVATE KEY-----\n…",
  "options": {"path": "/etc/nginx/certs/app"},
  "timestamp": "2026-08-21T00:06:17Z",
  "source": "certpilot"
}
```

`options` is the binding's own placement, passed through verbatim, so one target
can serve many certificates that land in different places on it.

Signed exactly as an alert webhook is — `X-CertPilot-Signature` is the hex
HMAC-SHA256 of `<unix-seconds> "." <raw body>`, with `X-CertPilot-Timestamp`
carrying the seconds. One scheme, one implementation
([`pkg/webhooksig`](https://github.com/certpilot/certpilot/blob/main/pkg/webhooksig)), so a receiver written once works for
both.

Two rules here are stricter than on a notification webhook, and both follow from
what this endpoint can *do* rather than what it carries:

- **`signing_secret` is mandatory.** An unsigned alert webhook means a receiver
  might act on a fabricated alert. An unsigned deployment webhook means anyone
  who can reach the receiver can install their certificate and their key under
  your hostname.
- **`include_private_key` cannot be combined with a plain-http URL** unless the
  host is a loopback address, where there is no wire to intercept. A hostname
  that merely resolves to loopback today does not count: what a name points at
  when the deployment actually runs is not what it points at now.

## Binding: one row per place

```json
POST /api/v1/certificates/{id}/targets
{ "target_id": "…", "options": {"path": "/etc/nginx/certs/app"} }
```

```json
201 Created
{ "message": "app.example.com will be deployed to lab nginx. Binding does not install it — POST /certificates/{id}/deploy does." }
```

A binding to a target that carries the private key is refused when CertPilot
holds no key for the certificate. Caught here rather than at deploy time,
because otherwise it is a configuration that fails on every renewal forever and
is discovered the week it matters.

Asking where a certificate stands is a question about places:

```json
GET /api/v1/certificates/{id}/targets
{ "count": 2,
  "summary": "2 targets: 1 up to date, 1 holding an older certificate." }
```

That sentence costs no network — it compares recorded fingerprints. Post-renewal
verification reaches the same kind of conclusion by opening a connection. Two
independent kinds of evidence, and they should agree.

The summary also reports failure, not only state:

```
"All 1 target hold the current certificate. The last deployment to 1 target failed."
```

Both halves are needed. This shipped reporting only the first, and a live run
produced *"All 1 target hold the current certificate"* over a deployment that
had failed three times and escalated.

## Deploying

```json
POST /api/v1/certificates/{id}/deploy
202 Accepted
{ "queued": 1,
  "message": "app.example.com: queued for 1 target; 1 target already had a deployment outstanding; 1 target switched off and skipped." }
```

Queued rather than deployed: eight targets is eight machines that may each need
a reload, and a synchronous handler would be cut off by the server's write
timeout somewhere in the middle, leaving half an estate updated and the client
with no way to know which half.

The message accounts for what did *not* happen too. A flat "queued" over an
estate where three of five targets were switched off is the kind of half-truth
that gets believed.

**What is deployed is the certificate as it stands now**, not the fingerprint
the job recorded when it was created. If a second renewal happened while the job
waited, installing what the job was created for would push an older certificate
to a live listener — and that renewal's own enqueue may have been a no-op,
because the binding already had a job outstanding. The captured fingerprint is
provenance, never a selector.

## The queue

```json
GET /api/v1/deployments?certificate_id=…&outstanding=true
{ "total": 1, "outstanding": 1, "escalated": 1,
  "summary": "1 deployment is failing: app.example.com at lab nginx (3 attempts). The certificates are fine; what serves them is not being updated." }
```

Durable rows with leases, an attempt log, and deadline-aware backoff — the same
machinery as the renewal queue, because a certificate that has been renewed and
not installed runs down exactly the clock of one that was never renewed at all.

A failing deployment stays `PENDING`. There is no attempt count at which a
certificate stops needing to be where it is served from. It escalates instead —
after three failures, or after one when there is less than a week of runway —
and `cert.deploy_failed` fires once, at that moment:

```
CRITICAL — Cannot install app.example.com at lab nginx

app.example.com has failed to install at lab nginx 3 times. The certificate is
fine; what is serving it is not being updated, so it expires on the schedule of
whatever is there now.
```

A failed deploy never moves the binding's `deployed_fingerprint`. The place is
still holding whatever it was holding, and overwriting it with the fingerprint
that failed to arrive would be the record claiming a deployment that did not
happen.

One thing differs from the renewal queue, and it is the load-bearing line: the
partial unique index is on the **binding**, not the certificate. Renewal allows
one outstanding job per certificate because a second renewal issues a second
certificate. A certificate bound to six targets needs six jobs outstanding at
once, and copying renewal's constraint would have deployed to the first and
dropped five in silence.

## Deploying on renewal

```json
POST /api/v1/certificates/{id}/targets
{ "target_id": "…", "deploy_on_renewal": true }
```

`deploy_on_renewal` defaults to **true** for a binding created now, and is
**false** for every binding that existed before migration 023. That is not a
contradiction: a binding made from here on is made by somebody who knows the
feature exists, and an upgrade must not silently begin writing to production
servers. The binding summary says which is which, because a switch nobody turns
on is a feature nobody has:

```
4 targets: 3 up to date, 1 never deployed. 1 target will not be updated when it
renews, and will hold an older certificate until deployed by hand.
```

A renewal and this endpoint go through the same planner and differ in one field,
the reason. Two code paths would mean the automatic one diverging from the one
people test by hand.

## A failing target halts the rollout

**A deployment that has not itself failed waits while another for the same
certificate has.** The first target attempted therefore becomes a canary on
every certificate, with nobody having configured anything, and a bad certificate
reaches at most as many targets as there are workers — two per replica — rather
than all of them. When the failure clears, the rest resume on their own.

Two failures do not hold each other still: the rule exempts jobs that have
themselves failed, or the retry curve would never run.

Because a deliberate halt and a broken queue look identical from outside, the
escalation says which it is:

> *1 other target is waiting behind it and will not be attempted until this one
> succeeds: a failing target stops the rollout rather than letting a bad
> certificate march through the estate.*

There is no way to express ordering — "staging first, then production" — and no
way to make the canary exactly one rather than one per worker. Both are recorded
as gaps rather than implied.

## The loop that proves it landed

A deployment's success is a claim that bytes were accepted. The verifier's is
evidence from a handshake. Once **every** place a certificate is bound to holds
it, its check moves from the half hour a renewal schedules to three minutes —
not to zero, because a verification that ran the instant a deployer returned
would report the reload it did not wait for, and not at all on a partial
rollout, because that is a STALE nobody needed to see.

## Cloud targets

```
aws_acm           borrows an AWS connection      binding needs certificate_arn
azure_key_vault   borrows an Azure connection    binding needs certificate_name
f5                its own host and credentials   binding needs name
```

All three terminate TLS, so all three carry the private key and all three appear
in the answer to *"where does this organisation ship private keys"*.

**A cloud target names a connection instead of holding credentials.**

```json
POST /api/v1/deployment-targets
{ "name": "acm-eu-west-1", "target_type": "aws_acm",
  "config": { "connection_id": "…" } }
```

Anything else is refused. Two copies of one account's credentials — one in
`cloud_connections` for discovery, one here for deployment — is one rotation
away from a system that can read an account it can no longer write to. The
target's sealed config holds the connection id and nothing else; `region`,
`vault_url` and the credentials are read from the connection at deploy time, and
the connection wins on any collision.

`deployment_targets.cloud_connection_id` is a plain column beside the sealed
blob, for the reason `deploys_private_key` is: *"which cloud accounts can this
system write to"* has to be answerable with a SELECT by somebody who does not
hold the KEK.

## The one mistake all three share

| | The one-field mistake | What is actually being served |
|:---|:---|:---|
| ACM | `ImportCertificate` with no `CertificateArn` | Every listener still points at the old ARN |
| Key Vault | Import under a new name | Whatever reads the old name is on the old certificate |
| F5 | Install under a new crypto-store name | The client-SSL profile references the previous one |

In all three the API returns 200, the attempt log records a success, and the
console shows a fresh green certificate beside the old one. So the identifier of
what is being replaced is required per binding and refused **at binding time**:

```
400  an ACM deployment needs certificate_arn: the ARN of the certificate to
     replace. Importing without one creates a new certificate that no load
     balancer is pointing at, and the old one goes on being served until it
     expires
```

ACM additionally refuses the *result*: an import returning a different ARN means
AWS created rather than replaced, which is the same failure arriving as a
success. On a real replacement it reads back what is attached —
`(issued, in use by 1 resource(s))`, or a warning that nothing is using this ARN
at all.

**The F5 deployer does not touch the client-SSL profile.** It installs over the
crypto-store name the profile already references, which is the deployment.
Repointing a profile at a *different* certificate changes what a virtual server
serves and belongs to whoever owns that virtual server.

Its management address must be `https`, because the certificate and its private
key travel over it. `insecure_skip_verify` is available for the very common case
of a BIG-IP presenting its own admin-generated certificate — allowed, because
refusing outright means somebody copies the certificate by hand instead, and
named in `Describe()` so it is never invisible.

## Cancelling a deployment

```
DELETE /api/v1/deployments/{id}
{ "message": "Deployment cancelled. The target keeps whatever certificate it already has, and nothing will update it." }
```

Deleting a *target* says the same thing more loudly, because the bindings
cascade with it and the certificates carry on renewing perfectly happily while
reaching nothing.

## Cryptographic posture

One distinction governs this section, and most reporting on the subject has it
backwards:

> A classical **signature** is a problem in the 2030s. A classical **key
> exchange** is a problem this afternoon.

Nobody forges a handshake that already happened, so an RSA-signed certificate
expiring in ninety days is a plan, not a risk. Traffic under a classical key
exchange is being recorded now. So the headline is about handshakes:

```
3 of 6 scanned endpoints do not negotiate a post-quantum key exchange. Traffic
to them can be recorded today and decrypted whenever a quantum computer arrives
— and unlike certificate algorithms, that is a cost being paid now rather than a
deadline in the 2030s.
```

That answer needs a real connection to a real server, so it is collected by the
discovery scanner during the handshake it was already making.

## offered_hybrid, and why it is the important column

| | |
|:---|:---|
| `hybrid_key_exchange` | The negotiated group carries ML-KEM |
| `offered_hybrid` | **CertPilot offered one** |

Without the second, the first being false is a fact about CertPilot rather than
about the endpoint. Go enables X25519MLKEM768 by default and that default can
change in a release, so the scanner states its curve preferences explicitly and
records what it offered against every observation.

## Verdicts

| Verdict | |
|:---|:---|
| `EXPOSED` | Offered a post-quantum group and did not take it. Traffic here is being recorded now |
| `HYBRID` | Negotiated one. Protected against harvest-now-decrypt-later |
| `CLASSICAL` | An ordinary certificate, or a handshake that offered nothing to conclude from |
| `READY` | Post-quantum throughout |
| `WEAK` | Broken against **ordinary** computers today — SHA-1, RSA-1024. Not a quantum problem, and reported ahead of every quantum one |

A TLS 1.2 endpoint is told apart from a TLS 1.3 one that declined, because there
is no hybrid key exchange below 1.3: *"enabling a group will not fix it — this
endpoint needs TLS 1.3."* Those are different jobs and read identically unless
the message says so.

## The score

**The percentage of applicable CNSA 2.0 requirements met — not a risk score.** A
certificate scoring zero is the normal state of nearly every certificate in
production today, and presenting that as an alarm is how a report gets muted.
What it is for is measuring movement: the same estate, six months later.

CNSA 2.0's suite is written out in the source so it can be checked against the
NSA's publication. The transition **dates are deliberately absent**: they have
been revised, differ by category of system, and a compliance tool that invents a
deadline is worse than one that reports none.

SHA-256 is reported as a shortfall rather than a break — Grover halves the
effective preimage resistance, giving 128 bits where the suite asks for 192.
Lumping it in with SHA-1 would be false and would teach the reader to ignore the
whole category.

## CBOM

CycloneDX 1.6, validated against the published JSON schema in the test suite
rather than against a reading of it.

Algorithms are emitted **once** and referenced by every certificate that uses
them, with a `dependencies` graph linking the two. That is the only reason the
document is worth producing over a list: *"what does moving off SHA-256 touch"*
becomes a graph query somebody else's tool can answer.

`nistQuantumSecurityLevel` is `0` for classical algorithms rather than omitted,
so a reader can tell "a quantum computer breaks this" from "nobody assessed it".
The serial number is derived from the contents, so two exports of an unchanged
estate are byte-identical and a diff means something.

Post-quantum **issuance** is not implemented: `crypto/mldsa` is not in Go 1.26
and `crypto/x509` cannot build an ML-DSA certificate.
