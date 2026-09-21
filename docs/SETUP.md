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

Set up **one** of two providers. Which one is used is decided by whichever
credentials are present, so moving between them later is a few variables and a
redeploy. Nothing in the database changes, because each stored file records which
provider holds it.

### Cloudinary, if you would rather not hand over a card

Free plan, no payment method required. Sign up at cloudinary.com, and the
dashboard shows your Cloud name, API Key and API Secret on the first screen.

```
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

### Cloudflare R2, the better long-term home

Reading files back costs nothing, which matters because a mailbox is read far
more often than it is written. The free tier is genuinely free, but Cloudflare
requires a payment method on file before it will enable R2 at all.

Cloudflare, R2, create a private bucket. Then Manage R2 API Tokens, create one
with Object Read and Write scoped to that bucket.

```
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

**Do not make the bucket public.** If both providers are configured, R2 wins, and
anything stored on Cloudinary before the switch stays readable.

### How files are protected

Nothing is served from the provider to a browser, on either backend. Every read
goes out through `/api/attachments/<id>`, which checks the reader may work in the
address the message belongs to, the same check the conversation itself gets.

On R2 that is a genuinely private bucket: without the credentials there is no way
in. On Cloudinary the stored address is a capability, held on the server, handed
to nobody. That is weaker, and it is the price of not needing a card. If the
files matter enough, move to R2 later.

Files sent out go inline rather than as a link, so the provider never has to be
reachable by anyone else.

Without either provider nothing breaks. Mail arrives and reads normally, and
attachments are recorded by name and shown as not stored. An attachment must
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
