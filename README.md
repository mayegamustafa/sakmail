# SAK Mail

Shared school email for Sir Apollo Kaggwa Schools. One address per campus and
department, worked by named people, in a portal the schools own.

A single Next.js app: pages, API routes, Prisma and Postgres. Two services to
deploy, one build.

## What it does

- **Thirteen addresses** on `sirapollokaggwaschools.co.ug`, from `kisaasi@` to
  `kjl@`, with `admin@` as the catch-all. More can be added from the admin screen
  with no DNS change.
- **Per-address access.** A Kisaasi secretary sees Kisaasi and nothing else.
  Access is granted, never assumed, and each person either sends from an address
  or is limited to reading it.
- **Conversations**, not loose messages, threaded by `Message-ID` first and by
  subject and sender when a client drops its headers.
- **Assignment**, so a conversation has an owner, and can only be handed to
  somebody who can already open it.
- Inbox, Sent, Starred, Archived, Spam and Trash, with search across subjects,
  participants and message text.

## Running it locally

```bash
cp .env.example .env          # then set DATABASE_URL
npm install
npx prisma migrate deploy
npm run db:seed               # admin account + the 13 addresses
npm run dev
```

The seed is safe to run repeatedly: everything is an upsert that leaves an
existing row alone, so it never resets a password or undoes an edit.

## Environment

| Variable | Needed | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `PUBLIC_URL` | yes | Where this app is reachable, used to show the webhook URL |
| `BREVO_API_KEY` | to send | Outbound mail over HTTPS |
| `SEED_ADMIN_EMAIL` | first run | The first administrator |
| `SEED_ADMIN_PASSWORD` | first run | Change it after signing in |

Sending is over Brevo's HTTPS API rather than SMTP on purpose. Hosting platforms
routinely block outbound 587 and 465, and the failure looks like a connection
timeout, which reads like a wrong password. This was measured on the sister
project: Brevo answered on 587 from an ordinary network and never from the host.

## Before you switch the domain over

`sirapollokaggwaschools.co.ug` currently delivers mail to **Zoho**:

```
MX   10 mx.zoho.com / 20 mx2.zoho.com / 50 mx3.zoho.com
TXT  v=spf1 include:zohomail.com -all
```

Pointing MX at Cloudflare moves every address on the domain at once. MX is
domain-wide: there is no way to move `kisaasi@` and leave `nakasero@` on Zoho.
So this is a single cutover for the whole school group, and it needs planning
rather than a quiet afternoon.

What changes at the moment MX propagates:

- New mail for every address arrives here instead of Zoho.
- Existing Zoho mailboxes stop receiving.
- **Mail already in Zoho stays in Zoho.** This portal starts empty. Nothing is
  migrated by switching MX, and nothing here reads history out of Zoho.
- Anyone using a Zoho client or the Zoho web app keeps seeing only old mail.

A workable order:

1. Stand this up, sign in, and create the staff accounts and access.
2. Send a test to a spare address on a domain you already control here.
3. Pick a quiet hour, tell the schools it is happening.
4. Export from Zoho anything that must be kept.
5. Switch MX, then watch the first deliveries land.
6. Keep the Zoho account alive for a while. It costs little and holds history.

See `docs/SETUP.md` for the step-by-step.
