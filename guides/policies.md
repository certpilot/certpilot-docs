<!-- Synced from docs/api-reference.md in certpilot/certpilot at 51f86f743471, last changed 2026-09-26T16:23:02Z.
     Source heading: "Policies". Edit it there, not here. -->

Rule types, all of which are evaluated:

| `rule_type` | `rule_config` |
|:---|:---|
| `key_size` | `{"rsa_min_bits": 3072, "ecdsa_min_bits": 256}` |
| `key_type` | `{"allowed_key_types": ["ECDSA", "Ed25519"]}` or `{"forbidden_key_types": ["RSA"]}` |
| `max_lifetime` | `{"max_days": 90, "min_days": 30}` |
| `ca_restriction` | `{"allowed_providers": ["acme", "vault"]}` |
| `naming` | `{"allowed_suffixes": ["example.com"], "forbidden_patterns": ["*.internal"], "allow_wildcards": false, "max_sans": 50}` |

`severity` is `INFO`, `WARNING`, or `BLOCK`. Only `BLOCK` refuses the request;
the rest are returned in the issuance response.

`domain_pattern` scopes a policy — `*` matches everything, `*.example.com`
matches any subdomain. A policy applies when **any** requested domain matches.

## Key sizes are per algorithm

`rsa_min_bits` and `ecdsa_min_bits` are separate because the numbers are not
comparable: 256 is a strong ECDSA key and a broken RSA one. A single floor
cannot express both, and the rule's previous answer — check RSA, ignore
everything else — left elliptic keys with no floor at all.

`min_key_size` is still accepted and still means RSA bits, so policies written
against the original shape keep working.

**Ed25519 has one size.** A floor cannot be violated, so `key_size` does not
judge it. Use `key_type` to permit or forbid the algorithm itself.

## Naming

`allowed_suffixes` matches on a label boundary: `example.com` admits
`example.com`, `shop.example.com` and `*.example.com`, and refuses
`evil-example.com`. Every offending name in a request is reported, not just the
first.

`allow_wildcards` is only applied when present. A naming policy that does not
mention it permits wildcards, so a rule written to cap `max_sans` does not ban
them as a side effect.

## A policy never silently does nothing

A rule type this build cannot evaluate, a `rule_config` that will not parse, and
a configuration that sets no constraint each produce a violation at the policy's
own severity. Failing open is the one behaviour a security control must not
have: an operator who wrote "ECDSA only, BLOCK" and got a row in a table with no
effect had no way to tell it apart from compliance.

`approval_required` is no longer accepted on create. There is no approval
workflow in this build — no approvals table, no endpoint to approve or reject —
so a policy claiming to gate on approval was promising a control that did not
exist. The column still permits the value, because rows may already exist; the
engine now reports them rather than passing them.

> Policy is evaluated on issuance only, not on renewal.
