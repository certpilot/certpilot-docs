<script setup>
// Read rather than typed. This page claimed 109 endpoints against a router
// serving 111 — the drift the generated tables exist to prevent, on the first
// page a reader opens.
import census from '../.vitepress/census-generated.json'
</script>

# Overview

CertPilot's control plane exposes **{{ census.routeCount }} endpoints**. All but one
are under `/api/v1` and speak JSON.

```
https://certpilot.example.com/api/v1
```

## The three callers

The API is used by three quite different kinds of client, and they authenticate
in three different ways. This is deliberate: a credential sitting on a screen in
a corridor must not be able to do what an operator can, and a host agent must
not be able to read the estate.

| Caller | Credential | What it can do |
|:--|:--|:--|
| A person, or a script acting for one | `Authorization: Bearer <jwt>` | Everything their role permits |
| An unattended wall display | `X-Display-Token: cpd_…` | Read-only, `GET` only, and never the sensitive paths |
| A host agent | A signature over the request body | Only the seven agent routes, and nothing else |

Start with [Authentication](/api/authentication), then
[Roles and permissions](/api/roles).

## What is not here

One thing worth knowing before you plan against this API.

**There is no rate limiting.** The API does not throttle callers. If you are
exposing it beyond a trusted network, put something in front of it.

> Revocation **is** here, and this page used to say it was not.
> `POST /certificates/:id/revoke` (admin) tells the CA first and records the
> result only if the CA agreed. `DELETE /certificates/:id` deletes the record
> and does not revoke — it refuses a live certificate with a `409` that names
> the revoke endpoint. See [Operations](/operations#revoke).

## Health

```
GET /healthz
```

The only unauthenticated endpoint, and deliberately uninformative — it reports
that the process is up and says nothing about the database, the gateways, or
anything else an unauthenticated caller has no business learning.

```json
{ "status": "ok", "service": "certpilot-core" }
```
