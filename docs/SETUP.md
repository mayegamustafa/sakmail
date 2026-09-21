# Setting up SAK Mail

Three things have to be connected: somewhere to run, a way for mail to get in,
and a way for mail to get out. They are independent, and the app tells you which
of the three is missing under Setup.

## 1. Deploy

Two Railway services: Postgres, and this app.

On the app service set:

```
DATABASE_URL        from the Postgres service
PUBLIC_URL          https://mail.sirapollokaggwaschools.co.ug
BREVO_API_KEY       from Brevo, SMTP & API, API keys
SEED_ADMIN_EMAIL    admin@sirapollokaggwaschools.co.ug
SEED_ADMIN_PASSWORD something you change immediately after signing in
```

Build and start:

```
npm run build
npx prisma migrate deploy && npm run db:seed && npm start
```

Migrations and the seed both run before start, and both are safe to repeat, so
this start command works on every deploy rather than only the first.

## 2. Incoming mail

### Generate the secret

Sign in, open Setup, and generate the webhook secret. It is shown once. The
portal refuses any inbound call that does not present it.

### Create the Cloudflare Worker

Cloudflare, Workers and Pages, Create, Start from Hello World. Replace the code
with `docs/cloudflare-email-worker.js` and deploy. It has no npm dependencies, so
it runs from the dashboard editor with no build step: it parses nested multipart
MIME, quoted-printable, base64 and RFC 2047 subjects itself.

Then Settings, Variables and Secrets:

| Name | Type | Value |
| --- | --- | --- |
| `PORTAL_WEBHOOK_URL` | Text | `https://<your-host>/api/inbound` |
| `PORTAL_SECRET` | Secret | the secret from Setup |

Deploy again. Variables added after a deploy do not reach the running code until
the next one, and this catches people out constantly.

The URL must include `https://`. A schemeless value fails inside the Worker's
`fetch`, at delivery time rather than at setup time, which is the worst place to
find out.

### Switch the domain

**Read the cutover section in the README first.** This domain has live mail on
Zoho and MX is domain-wide, so this moves all thirteen addresses at once.

Cloudflare, the domain, Email, Email Routing, Enable. Accept the MX records it
offers. Then under Routing rules, send each address to the Worker with the action
**Send to a Worker**, not "Forward to an email address", which bypasses the
portal entirely.

Mail for an address nobody has created is bounced back to the sender rather than
dropped, so a typo tells the sender instead of vanishing.

## 3. Outgoing mail

Cloudflare Email Routing receives only. Replies leave through Brevo.

1. Brevo, Senders, domains, IPs: add `sirapollokaggwaschools.co.ug` and add the
   records it gives you to Cloudflare DNS.
2. **The SPF record is the one to be careful with.** A domain may only have one.
   Cloudflare Email Routing writes its own when enabled, and the current Zoho one
   has to go. Merge, do not stack:

   ```
   v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all
   ```

   Two SPF records make both fail and every reply lands in spam.
3. Brevo, SMTP & API, API keys: generate one and set `BREVO_API_KEY`.
4. Leave Brevo's authorized-IP restriction **off**. Railway has no fixed outbound
   address, so there is nothing stable to authorize, and Brevo drops rather than
   rejects an unauthorized IP, which surfaces as a timeout.

Until sending is connected, a reply is still saved on the conversation and shown
with the reason it did not leave, so nothing anyone types is lost.

## Attachments

Files are kept on Cloudflare R2: 10GB free, and no charge for reading them back,
which matters because a mailbox is read far more often than it is written.

In the Cloudflare dashboard, R2, create a bucket. Then Manage API Tokens, create
one with Object Read and Write on that bucket. Set four variables on the service:

```
R2_ACCOUNT_ID        from the R2 overview page
R2_ACCESS_KEY_ID     from the token
R2_SECRET_ACCESS_KEY from the token
R2_BUCKET            the bucket name
```

**Leave the bucket private.** Nothing is served from it directly. Every file goes
back out through `/api/attachments/<id>`, which checks that the reader may work
in the address the message belongs to, the same check the conversation itself
gets. An attachment on a school mailbox is as likely to be a medical form or a
fee statement as a photograph, and a public bucket URL cannot be taken back once
it leaks.

Files sent out go inline rather than as a link, which is what lets the bucket
stay private: the mail provider never needs to reach it.

Without these variables nothing breaks. Mail still arrives and reads normally,
and attachments are recorded by name and shown as not stored. An attachment must
never cost the school the message it came with.

## How threading works

1. `In-Reply-To` and `References` matched against stored Message-IDs.
2. Failing that, the same subject from the same person to the same address within
   180 days joins the existing conversation.
3. Otherwise a new conversation opens.

Replies carry a Message-ID owned by the school domain, and Brevo preserves it, so
a reply to a reply threads exactly rather than by the subject fallback.

A provider retrying after a timeout cannot double-deliver: `messageId` is unique
in the database and a repeat returns the original.

## Access

| Who | Sees |
| --- | --- |
| Administrator | Every address, and manages addresses, staff and access |
| Staff with addresses | Only those addresses |
| Staff with none | Nothing |

Each member either sends from an address or is limited to reading it. Reaching
for a conversation in another address returns the same "not found" as one that
does not exist, so the mailbox cannot be mapped out by probing ids.

Suspending an account ends its sessions immediately, and so does setting a new
password, so a handed-over account cannot keep the old browser signed in.
