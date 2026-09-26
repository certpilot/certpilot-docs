<!-- Synced from docs/api-reference.md in certpilot/certpilot at 81031950a7b7, last changed 2026-09-26T11:56:08Z.
     Source heading: "Certificate Transparency". Edit it there, not here. -->

This is the half of discovery a network scan cannot reach. A scan answers "what
is being served on the addresses I told you about". CT answers **what has been
issued in your name at all** — by any CA, to anyone, whether or not it was ever
deployed and whether or not the machine is reachable from CertPilot. A developer
who obtained a certificate for `api.corp.example.com` with a personal ACME
account appears in no scan of any range, and appears in CT within minutes,
because every publicly-trusted CA is required to log there.

```json
POST /api/v1/ct/monitors
{ "domain": "example.com", "include_subdomains": true, "check_interval_minutes": 360 }
```

Give the domain itself — `*.example.com` is refused, because subdomains are what
`include_subdomains` is for. The floor on the interval is **60 minutes**, higher
than a scan's, for a different reason: the logs are read through a free
community service, and polling it harder is how an organisation loses access to
it and then finds out nothing at all.

## Checked, versus answered

Every monitor carries **both** `last_checked_at` and `last_success_at`, and the
list surfaces `stale_domains` derived from them.

Collapsing those into one field is the failure this whole product exists to
prevent, in miniature: a monitor that has been unable to reach the log for a
week would look exactly like a monitor that has found nothing for a week, and
one of those means nobody is being told about certificates issued in their name.
For the same reason `POST …/check` answers **502** when the index is
unreachable, with its own words and the sentence *"The check did not complete,
so nothing was learned about this domain. It is not the same as finding no
certificates."*

## One certificate, two log entries

A precertificate and its final certificate are logged separately and share a
serial number. The index publishes no field saying which is which, so the
earlier entry for a serial is labelled `is_precertificate` — precertificates are
always logged first. Both rows are kept, because "this was pre-logged then
issued" is real information, but `GET /ct/certificates` hides the pre-issuance
row by default and the counts are per certificate.

This is not cosmetic. Before it existed, a live check of `badssl.com` reported
**18** certificates where there are **9**, and a headline number wrong by a
factor of two is one people act on. Pass `include_precertificates=true` for the
raw log entries.

## Matching your own certificates

Findings are matched to inventory on **serial number**, since the log index does
not publish a SHA-256 fingerprint. The two sides format serials differently —
CertPilot stores unpadded lowercase hex, indexes pad and upper-case them — so
both are normalised before comparison. Getting that wrong would report this
system's own certificates as ones nobody manages, and a findings list full of
your own certificates is one nobody reads.

An unmanaged finding publishes `ct.unmanaged` (WARNING), and only for
certificates that are **new to that monitor**. Check windows overlap by design,
and an alert repeating the same certificate every six hours is how a channel
gets muted — taking the CA expiry alerts sharing it along with it.

> Cloud inventory (ACM, Azure Key Vault, GCP, Kubernetes secrets) is not
> implemented yet.
