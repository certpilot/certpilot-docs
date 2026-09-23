<!-- Synced from docs/api-reference.md in certpilot/certpilot at 9e9a56600009, last changed 2026-09-21T21:48:46Z.
     Source heading: "Agents". Edit it there, not here. -->

Two APIs, kept completely apart.

```
# For people (OIDC bearer token, as everywhere else in this document)
GET    /api/v1/agents                        The fleet                   (any)
GET    /api/v1/agents/:id                    One host                    (any)
POST   /api/v1/agents/:id/revoke             Withdraw its credential     (admin)
DELETE /api/v1/agents/:id                    Forget it, once revoked     (admin)
GET    /api/v1/agent-enrol-tokens            Which doors are open        (admin)
POST   /api/v1/agent-enrol-tokens            Mint one                    (admin)
DELETE /api/v1/agent-enrol-tokens/:id        Revoke it                   (admin)

# For agents (signed with the agent's own key)
POST   /api/v1/agent/enrol                   Join                        (enrolment token)
POST   /api/v1/agent/heartbeat               Report                      (signed)
```

The separation is the point. `AgentAuth` is mounted only on `/api/v1/agent/*`
and nowhere else; the OIDC authenticator and the display-token middleware are
not mounted there at all. An agent credential cannot read the estate, and a
person's bearer token cannot speak as a host.

## How an agent proves who it is

The agent generates an Ed25519 keypair on its own host during enrolment and
sends only the public half. There is no field in any request for a private key.
The core therefore stores nothing that can impersonate an agent — a database
that leaks yields public keys.

**Not mTLS**, and that is a decision. The core is routinely deployed behind a
reverse proxy; client-certificate authentication terminates at the proxy and
reaches the application as a header, which anything that can reach the core
directly can forge. An application-layer signature is verified by the process
that acts on the request, so it survives every proxy, ingress, and mesh in
between. TLS is still expected on the wire — this authenticates, it does not
encrypt.

Three headers:

```
X-CertPilot-Agent:     <agent id>
X-CertPilot-Timestamp: <unix seconds>
X-CertPilot-Signature: <base64 Ed25519 signature>
```

over exactly these bytes:

```
certpilot-agent-v1 \n
POST               \n
/api/v1/agent/heartbeat \n
1774137600         \n
<hex sha256 of the request body>
```

The scheme name is *inside* the signed bytes, so a verifier that one day
supports two cannot be talked into checking a v2 signature with v1 rules. The
path is inside them, so a heartbeat's signature cannot be lifted onto a route
that does something. An empty body is hashed rather than skipped, so "no body"
and "an empty body" are not interchangeable.

**Replay is prevented on the endpoints where it changes something.** The core
records the signatures it has accepted — in the database, not in a replica's
memory, because a check one replica performs alone implies a property that does
not hold across a deployment of two — and refuses a repeat on
`POST /agent/certificates` and `POST /agent/deployments/claim`.

Heartbeats, inventory, installation reports and deployment results are exempt.
A signature covers a one-second timestamp, so an agent retrying after a network
timeout re-sends bytes it already signed; on a report those are indistinguishable
from a replay and refusing the retry turns a recovered blip into a failure.

A refused replay answers `401` with `"code": "agent_replay"`. An agent's own
retries sign afresh with a new timestamp and never collide, so seeing this means
something else is re-sending its traffic.

The reference implementation is [`certpilot-agent-sdk/agentauth`](https://github.com/certpilot/certpilot-agent-sdk/tree/main/agentauth), and
`SigningString` is written out as its own exported function precisely so an
agent in another language can reproduce it byte for byte.

## Enrolment

```json
POST /api/v1/agent-enrol-tokens
{ "name": "june rollout", "expires_in_minutes": 60, "max_uses": 1,
  "labels": {"env": "production"} }
```
```json
201 Created
{ "token": "cpe_…",
  "message": "This token is shown once and cannot be recovered. It enrols one agent and expires at 2026-08-22T02:19:55Z." }
```

One use and one hour by default, capped at a week. An enrolment token only has
to survive a provisioning run; one that outlives the rollout is a live
credential in whatever template it was pasted into. It is spent by a conditional
`UPDATE` rather than a read followed by a write, because two hosts booting from
the same image enrol in the same second — and a one-use token that enrols both
is not one-use.

A malformed public key is rejected *before* the token is spent, so a typo in a
provisioning script does not leave the operator holding a burnt token.

```json
POST /api/v1/agent/enrol
{ "token": "cpe_…", "public_key": "-----BEGIN PUBLIC KEY-----\n…",
  "name": "web-01", "hostname": "web-01", "platform": "linux/amd64",
  "version": "0.1.0", "heartbeat_interval_seconds": 300 }
```

Labels come from the *token*, not the request, so an agent cannot label itself
into a group somebody else's policy is written against.

## Revocation, and who gets told

```
POST /api/v1/agents/{id}/revoke
{ "message": "web-01 can no longer speak to CertPilot. Whatever certificates are on that host stay where they are and stop being maintained." }
```

A revoked agent's next signed request gets **403 with the reason**. Every other
refusal — unknown agent, bad signature, stale clock, missing headers — is a flat
`401` with one uniform sentence, and which check failed goes to the log.

The ordering is load-bearing: **the signature is verified before the agent's
status is looked at.** Checking status first would let anyone who can guess an
id distinguish a revoked agent from an unknown one, which is a fleet-enumeration
oracle. Checking it second means the only caller ever told "you have been
revoked" is the one holding the private key — which is the agent, and precisely
who needs to know, because otherwise it retries a withdrawn credential every few
minutes for as long as the host stays up.

Deleting an agent is refused while it is active: removing the row does not
withdraw the credential, and doing it first destroys every record that the agent
existed.

## The fleet, and hosts that go quiet

```json
GET /api/v1/agents
{ "total": 42, "stale": 1,
  "summary": "42 agents, and 1 has stopped reporting. That host still has certificates on it and nothing is maintaining them." }
```

The number that matters is not how many agents are enrolled. A host whose agent
died three weeks ago still has certificates on it, still has them expiring, and
now has nothing maintaining them — and it looks exactly like a healthy host on a
list that counts rows.

Staleness is measured against **what each agent itself promised**, not one
global number that is wrong for every agent configured differently, and an agent
is late after three missed intervals — a restarted service or a busy host misses
one or two. An agent that enrolled and never reported is measured from
enrolment, so one that failed on its very first heartbeat is as visible as one
that stopped after a year. A revoked agent is not reported as missing: somebody
already knows.

`agent.stale` fires once, and again only if the agent comes back and goes away
a second time.

## What is on the hosts


The fourth place certificates hide, after served, issued, and stored in a cloud:
a file on a disk that no scan, no transparency log, and no cloud API will ever
mention.

The agent sends certificates as **PEM, unparsed**, plus the facts only a process
on the host can produce. Parsing centrally is deliberate — the agent runs on
machines nobody upgrades for years, and parsing logic on five hundred of them
cannot be fixed. **There is no field a private key could travel in**: the agent
parses one only far enough to derive its public half and compare.

```json
GET /api/v1/agent-certificates
{ "total": 7,
  "findings": { "private_key_readable": 2, "private_key_mismatch": 1, "unmanaged": 6 },
  "summary": "7 certificate files across the fleet. 2 certificate files have private keys other accounts on their hosts can read; 1 certificate file has a key that does not match it, so the next restart of whatever serves it will fail; 6 certificate files are not managed by CertPilot." }
```

Filters: `?agent_id=`, `?state=MANAGED|UNMANAGED`, `?kind=leaf|ca|bundle`,
`?finding=<code>`, `?include_removed=true`. The finding filter runs as jsonb
containment in the database, so it works on an estate of thousands.

| Finding | What it means |
|:---|:---|
| `private_key_readable` | Other accounts on that host can read the key. **Reissue** — renewing does not undo it, and neither does changing the mode afterwards |
| `private_key_mismatch` | The key beside the certificate does not belong to it. The next restart of whatever serves it will fail |
| `superseded` | This file holds a certificate a renewal already replaced |
| `private_key_missing` | A leaf with no key beside it, so this host cannot serve it. Usually a copy left by a migration |
| `unmanaged` | CertPilot did not issue it and is not tracking it |
| `expired` / `expiring_soon` | Raised to CRITICAL when a server configuration names the file |
| `unreferenced` | No configuration on the host was found naming it. Only claimed on hosts where the heuristic matched something else |

`private_key_readable` is the one nothing else in this system can produce. A
network scan sees what an endpoint presents; it cannot see that the key behind
it is mode 0644.

`kind` keeps trust stores from drowning the rest: a host's `ca-certificates`
file is one row saying it holds 143 roots, not 143 findings about a package
nobody edited. Findings apply to `leaf` and `ca`, never `bundle`.

A certificate is classified as `ca` only if it is a CA **and carries no DNS or
IP names**. OpenSSL's `req -x509` sets `basicConstraints CA:TRUE` by default, so
most self-signed certificates on an internal estate claim to be authorities
while plainly serving a hostname; trusting that claim made almost everything on
such a host skip the leaf findings.

Two topics, not one: `agent.key_exposed` is a security incident needing the
certificate reissued, `agent.key_mismatch` is an outage waiting for an unrelated
restart. They have different owners, and a message saying "one of these two
things" makes the reader go and look — which is the work an alert exists to
save.

## Certificates with keys CertPilot has never seen

```
GET    /api/v1/agent-grants           What hosts may ask for      (any)
POST   /api/v1/agent-grants           Grant it                    (operator)
DELETE /api/v1/agent-grants/:id       Revoke it                   (operator)
POST   /api/v1/agent/certificates     A host asks                 (signed)
```

The agent generates the key on the host, signs a CSR with it, and sends only the
request. CertPilot never sees the key, and `GET /certificates/:id/private-key`
answers **404** — truthfully.

`certificates.key_custody` says who holds it: `CERTPILOT` (sealed here, and
therefore losable, copyable, subpoenable), `AGENT` (on a host, never anywhere
else), `EXTERNAL` (somebody has it and it is not us). Until agents existed, "no
key stored" meant only the last of those.

## Grants

```json
POST /api/v1/agent-grants
{ "name": "web tier hosts",
  "label_selector": {"tier": "web", "env": "prod"},
  "names": ["*.web.example.com"],
  "ca_account_id": "…",
  "min_key_size": 2048,
  "allowed_key_types": ["ECDSA", "RSA"],
  "validity_days": 90,
  "renew_before_days": 30 }
```

A grant targets one agent (`agent_id`) or a set of labels — and **the labels
come from the enrolment token, not from the agent**, so a host cannot label
itself into a grant written for another tier. Four hundred web servers are one
grant.

Wildcards match one level, exactly as certificates' do: `*.web.example.com`
covers `a.web.example.com` and covers neither `a.b.web.example.com` nor
`web.example.com`. Following the same rule certificates follow is what makes a
grant mean what its author thinks.

`*` is **refused**. A grant permitting every name makes the agent credential
equivalent to the CA behind it.

`min_key_size` means **RSA bits**. Key sizes are not comparable across
algorithms — a P-256 key is considerably stronger than RSA-2048 and 256 is a
smaller integer than 2048 — so elliptic keys are floored at P-256 instead. A
grant cannot require a specific curve; that is a known gap rather than a number
that means two things.

## What is checked on a request

| Check | Why |
|:---|:---|
| The CSR signature verifies | Otherwise anyone reaching the endpoint could obtain a certificate for somebody else's public key — which is a certificate issued to that somebody else |
| Every name is covered, **common name included** | A request with permitted SANs and an unpermitted CN would produce a certificate for a name nobody granted |
| **One** grant covers the whole request | Assembling permission from several would let a host combine one tier's names with another tier's CA account |
| No `basicConstraints CA:TRUE`, no `keyCertSign` | Refused, not stripped. A correct CA ignores CSR extensions — but that is a hope about code that may be a third-party gateway next year, not a control |
| DNS names only | IP, email, and URI names are validated differently and a grant has no way to express them |
| The gateway returned **no** private key | If it did, it ignored the CSR and generated its own pair; storing that leaves the host's certificate and the database's key mismatched, both looking fine |

A refusal is `403` with `"code": "not_permitted"`, and publishes
`agent.request_refused`. The other 403 an agent can get is `"code":
"agent_revoked"` — the codes exist because the right response to each is the
opposite: fix the grant, or stop for good. An agent that could not tell them
apart shut itself down over a missing grant.

## Renewal

The agent renews its own, because rotating means generating a key and only the
host has one. The core's renewal sweep excludes both `key_custody = 'AGENT'` and
`key_custody = 'EXTERNAL'` — the two cases where CertPilot does not hold the key
and so cannot rotate it. Without that the queue would claim those jobs and fail
forever.

An externally held key is renewed by whoever holds it, by submitting a new
signing request. A certificate with no recorded custody stays eligible: that
means nobody wrote one down, not that somebody else holds the key.

*When* is the core's decision, returned as `renew_after` and derived from the
grant's `renew_before_days`. A host that picked its own moment could decide to
renew hourly, and four hundred of them would be a denial of service against the
CA.

## Installing, and reloading


A certificate in the agent's state directory is not a certificate nginx is
serving. This is the step that closes that gap, and it is the first time the
agent writes to a file another process depends on — so it is governed by phase
6's sentence: *renewal creates new material; deployment replaces material that
is currently carrying traffic.*

**Where a certificate goes, and what to run afterwards, is declared on the host
— never sent by the core.** There is no wire format for a destination in
`certpilot-agent-sdk/agentapi`, deliberately, because a core that could hand a host a command to
run would be a fleet-wide remote execution channel with a certificate manager on
the front of it. The core may say *"install certificate X"*; it may never say
*"and here is what to run".*

```json
/etc/certpilot/installs.json
{ "destinations": [
    { "name": "nginx",
      "certificate": "shop.example.com",
      "cert_path": "/etc/nginx/ssl/shop.crt",
      "key_path":  "/etc/nginx/ssl/shop.key",
      "chain_path": "/etc/nginx/ssl/chain.pem",
      "owner": "root", "group": "www-data",
      "cert_mode": "0644", "key_mode": "0640",
      "check":  ["/usr/sbin/nginx", "-t"],
      "reload": ["/usr/sbin/nginx", "-s", "reload"] } ] }
```

`cert_path` and `key_path` may be the same file, which is the layout HAProxy
wants. That file then takes the **key's** mode whatever `cert_mode` says —
because it holds a private key, and 0644 is exactly what step 4b keeps finding
on it.

## Install, check, then reload — in that order

`check` is the most valuable line in the file. The certificate is written, the
server is asked whether it can live with it, and only then is the running
process told to pick it up. A check that fails costs a rollback of files nothing
has read yet; the same failure without a check costs a listener.

| | |
|:---|:---|
| Every file is written to a temporary name **in its own directory** and renamed over the target | A reader sees the old contents or the new ones, never half of either. Rename is atomic within a filesystem and not across one, which is why the temporary file is not in `/tmp` |
| What was there is kept **in memory**, not in a `.bak` | A private key copied to `server.key.bak` is a private key nobody is tracking |
| A failed `check` restores the files and never reloads | Nothing was ever loaded, so the running process is still on what worked |
| A failed `reload` restores the files **and reloads again** | The process is running on material that is no longer on disk; putting the files back is not enough on its own |
| Nothing is written or reloaded when the bytes already match | An agent that reloaded nginx every five minutes because it could would be a worse problem than the stale certificate it was fixing |
| The declared mode and ownership are enforced **without** a write or a reload | A key somebody chmodded to 0644 during an incident is the finding step 4b reports as CRITICAL, and this is the one process in the system that can quietly put it back |

The agent refuses a `key_mode` that is world-readable, at load, naming the mode.
**It must not create the finding it exists to report** — and the fix for that
finding is reissuance, not a later `chmod`.

Commands are an argument vector run with no shell and a bare `PATH`, and
`argv[0]` must be absolute: this very often runs as root out of a systemd unit
whose `PATH` is not the one the person editing the file was looking at.

## An agent is a deployment target like any other

```
POST /api/v1/certificates/{id}/deploy    →  202, a job per binding
```

Every other target type is deployed to by a core worker opening a connection. A
host behind two firewalls **claims the job itself** — same queue, same lease,
same retry curve, same attempt log. Only the worker moves, and the attempt log
names the machine rather than a replica.

The core's own claim query excludes agent targets. A worker that took one would
fail it until the attempt budget ran out, being loudly wrong about something
that in fact works.

The target appears on its own, the first time a host reports a destination —
four hundred hosts are four hundred targets, and a product that asks somebody to
create them by hand gets a script that creates them by hand. It is created with
`deploys_private_key: false`, and that is a fact rather than a default: the key
was generated on that host and is already there, so agent hosts are correctly
absent from the answer to *"where does this organisation ship private keys"*.

Reporting on a job belonging to another host is `403 {"code":
"not_permitted"}`. Without that check a host with a valid credential could mark
another machine's deployment as done, and the binding would record a certificate
as installed somewhere that had never seen it.

## The status nothing else can produce

```
GET /api/v1/agent-installations?attention=true
```

| Status | |
|:---|:---|
| `INSTALLED` | This destination holds what the host holds |
| `FAILED` | The last attempt did not finish. `rolled_back` says whether the previous material was put back — an inconvenience or an outage, and a single status cannot say which |
| `UNFULFILLED` | **This host is configured to install a certificate it does not hold** |

The last one is the reason this endpoint exists. A remote scanner sees what a
listener serves; the issuance record sees what was asked for. Neither can see
that a machine has been configured for a name nobody granted it — there is no
binding, no certificate and no failed attempt, just a host that will do nothing
at all when the renewal it is waiting for never arrives. It is almost always one
character.

Reports are **full state**, like the inventory: a lost one costs nothing because
the next carries everything. Bindings are reconciled to match, so an agent that
renews does not leave the binding for the certificate it replaced sitting beside
the new one — both claiming that place holds the current certificate.

Alerts fire on **transitions**, not on states. A destination that has been
failing since Tuesday must not send a message every cycle until somebody mutes
the channel that also carries CA expiry alerts.
