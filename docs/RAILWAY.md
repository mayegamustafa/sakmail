# Deploying SAK Mail on Railway

Two services in one project: Postgres, and this app.

## 1. Postgres

New, Database, Add PostgreSQL. Railway sets `DATABASE_URL` on it.

## 2. This app

New, GitHub Repo, `mayegamustafa/sakmail`.

Railway builds with Nixpacks and reads `railway.json`, so the start command is
already set:

```
npx prisma migrate deploy && npm run db:seed && npm run start
```

Migrations and the seed both run before start, and both are safe to repeat, so
this works on every deploy rather than only the first. The seed never resets a
password or undoes a change made in the admin screen.

## 3. Variables

On the app service:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Reference the Postgres service: `${{Postgres.DATABASE_URL}}` |
| `PUBLIC_URL` | `https://mail.sirapollokaggwaschools.co.ug` |
| `BREVO_API_KEY` | From Brevo, SMTP & API, API keys |
| `SEED_ADMIN_EMAIL` | `admin@sirapollokaggwaschools.co.ug` |
| `SEED_ADMIN_PASSWORD` | Something long. Change it after the first sign in. |

`PUBLIC_URL` must include `https://`. It is what Setup shows as the webhook URL,
and a schemeless value fails inside the Cloudflare Worker at delivery time rather
than at setup time.

## 4. The subdomain

Settings, Networking, Custom Domain, `mail.sirapollokaggwaschools.co.ug`.

Railway gives you a CNAME target. Add it in Cloudflare DNS as a CNAME on `mail`.

**Set that record to DNS only, not proxied.** Cloudflare's orange cloud in front
of Railway's own edge causes redirect loops and certificate trouble, and the grey
cloud avoids both.

This subdomain is unrelated to the MX records. Adding `mail.` does not touch
where mail for the domain is delivered.

## 5. Cost

Railway Hobby is a $5 monthly minimum that includes $5 of usage. If the City
Parents project already sits under that, this app and its database may fit inside
the same allowance at no extra cost. Check the usage graph before assuming either
way.

## After it is up

Sign in, change the seeded password, then work through `docs/SETUP.md` for the
webhook secret, the Cloudflare Worker and Brevo.

**Do not switch MX until you have read the cutover section in the README.** The
domain currently delivers to Zoho and the change moves all thirteen addresses at
once.
