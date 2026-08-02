# Deliverability Guide

Reaching the inbox is mostly about **authentication**, **reputation**, and **compliance** — not the message body. This guide covers the DNS records, warmup, and legal footers Dispatch expects you to have in place.

## 1. Authenticate your domain (SPF, DKIM, DMARC)

Configure all three on the sending domain before your first campaign. Mailbox providers treat unauthenticated mail as suspicious.

- **SPF** — a TXT record on the sending domain listing the hosts allowed to send for it:
  ```
  v=spf1 include:<your-esp-or-relay> ~all
  ```
  Keep it to a single SPF record; stay under the 10-DNS-lookup limit.

- **DKIM** — publish the public key your relay/provider gives you as a TXT record at `<selector>._domainkey.<domain>`. Every outgoing message is then signed so recipients can verify it was not altered in transit.

- **DMARC** — a policy record at `_dmarc.<domain>` telling receivers what to do with mail that fails SPF/DKIM alignment, and where to send reports:
  ```
  v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com
  ```
  Start at `p=none` (monitor), then tighten to `p=quarantine` and `p=reject` once your reports show legitimate mail passing.

## 2. Verify the sending domain

Add your sending domain in the app and complete DNS verification before sending. Dispatch checks that the expected records resolve so you catch a misconfigured SPF/DKIM record before it costs you reputation.

## 3. Warm up new IPs and domains

A brand-new IP or domain has no reputation. Sending a large volume on day one gets you throttled or blocked. Use the built-in **warmup** feature to ramp send volume gradually over a schedule while you build a positive history. Warm up any new dedicated IP, and re-warm after long idle periods.

## 4. Suppression & bounce handling

Dispatch maintains a **suppression list** and honors it on every send:

- **Hard bounces** and **unsubscribes** are suppressed automatically — the address is never emailed again.
- **GDPR erasure** adds the address (as a salted hash) to the suppression list so an erased contact can never be re-imported and re-mailed.
- Continuing to mail addresses that bounce or complain is the fastest way to wreck domain reputation — never disable suppression.

## 5. CAN-SPAM: sender identity & footer

Before a campaign can launch, the org must have a complete **sender identity** (Settings → Sender Identity), including a valid **physical postal address**. Dispatch **hard-gates** the launch and the send worker on this — CAN-SPAM requires:

- A truthful `From` name/address and non-deceptive subject line.
- A valid physical postal address in every commercial message (injected into the footer).
- A working, honored unsubscribe mechanism.

The CAN-SPAM footer (postal address + unsubscribe link) is appended automatically to outgoing campaign mail.

## 6. One-click unsubscribe (RFC 8058)

Bulk senders should support one-click unsubscribe. Dispatch sets the `List-Unsubscribe` header (with `List-Unsubscribe-Post: List-Unsubscribe=One-Click` per RFC 8058) so Gmail/Yahoo show a native "Unsubscribe" control and a single click removes the recipient — no landing page required. This is now effectively **required** by major mailbox providers for bulk senders.

## Quick checklist

- [ ] SPF, DKIM, DMARC published and passing for the sending domain
- [ ] Sending domain verified in-app
- [ ] New IP/domain warmed up before high volume
- [ ] Sender identity complete, including physical postal address
- [ ] Suppression list left enabled; bounces/complaints honored
- [ ] `List-Unsubscribe` (one-click) present on campaign mail
