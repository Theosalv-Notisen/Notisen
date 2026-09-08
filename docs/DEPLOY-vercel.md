# Deploy til Vercel

Fra lokalt prosjekt til kjørende app på Vercel. Engangsoppsett + hva som skjer ved hver senere deploy.

## 0. Forutsetninger

- GitHub-konto (Vercel deployer enklest fra et Git-repo).
- Vercel-konto (logg inn med GitHub på <https://vercel.com>).
- Supabase-prosjektet er satt opp (`qqbbpuazrvdajqtqciqw`), `schema.sql` + `storage.sql` kjørt.
- Verdiene du har lokalt i `.env` og `.env.local` (du trenger dem i steg 4).

## 1. Legg prosjektet på GitHub

Repoet har ingen remote ennå. Opprett et **privat** repo på GitHub (uten README/gitignore – vi har det), så:

```bash
cd ~/code/notisen
git remote add origin git@github.com:<ditt-brukernavn>/notisen.git
git push -u origin main
```

Sjekk at `.env` og `.env.local` **ikke** ble pushet (de er git-ignorert – `git ls-files | grep env` skal kun vise `.env.example`).

## 2. Importer i Vercel

1. <https://vercel.com/new> → velg GitHub-repoet `notisen` → **Import**.
2. Framework: **Next.js** (auto-detektert). Build/output-settings: la stå som default.
3. **Ikke deploy ennå** – utvid **Environment Variables** først (steg 4). Deployer du uten dem, feiler build-en på manglende Supabase-nøkler.

## 3. Bestem prod-URL

Vercel gir deg `https://notisen-<hash>.vercel.app` med en gang, og `https://notisen.vercel.app` hvis navnet er ledig. Har du domenet `notisen.no`, kan du koble det senere (steg 9) – men **bestem nå** hvilken URL som er den kanoniske, for den skal inn tre steder: `APP_URL`, `FIKEN_REDIRECT_URI`, og Supabase Site URL.

Resten av guiden skriver `https://DIN-URL` – bytt inn din faktiske.

## 4. Miljøvariabler i Vercel

Project → **Settings → Environment Variables**. Legg inn alle under, for **Production** (og gjerne Preview). Verdiene er de du har lokalt, unntatt de tre markert «ny/endret».

| Variabel | Verdi | Kilde |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qqbbpuazrvdajqtqciqw.supabase.co` | `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (fra `.env.local`) | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | (fra `.env.local`) | samme sted – **hemmelig, kun server** |
| `FIKEN_CLIENT_ID` | (fra `.env`) | Fiken-appen |
| `FIKEN_CLIENT_SECRET` | (fra `.env`) | Fiken-appen |
| `FIKEN_REDIRECT_URI` | **`https://DIN-URL/api/fiken/oauth/callback`** ← endret | må matche Fiken (steg 5) |
| `ANTHROPIC_API_KEY` | (fra `.env.local`) | console.anthropic.com |
| `RESEND_API_KEY` | (fra Resend – se steg 8) ← ny | Resend-dashbordet |
| `REMINDER_FROM_EMAIL` | `varsel@notisen.no` (eller `onboarding@resend.dev` for test) | – |
| `APP_URL` | **`https://DIN-URL`** ← ny | brukes til lenker i e-post |
| `CRON_SECRET` | (fra `.env.local` – eller generer en ny lang tilfeldig streng) | Vercel sender den som `Authorization: Bearer …` til cron-rutene |
| `TOKEN_ENC_KEY` | (fra `.env.local`) ← ny | krypterer Fiken-tokens i databasen – se under |

Merk:
- `NEXT_PUBLIC_`-variablene bakes inn i klient-bundlen – det er OK, de er offentlige by design (RLS beskytter data).
- `SUPABASE_SERVICE_ROLE_KEY`, `FIKEN_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `TOKEN_ENC_KEY` er hemmelige – aldri `NEXT_PUBLIC_`.
- **`TOKEN_ENC_KEY`:** `openssl rand -base64 32`. Sett SAMME verdi på **både Production og Preview** (Preview deler prod-databasen). **Ta backup i en passordmanager** – mister du den, må alle brukere koble til Fiken på nytt. Etter første deploy: kjør `npm run encrypt-tokens:migrate` lokalt (med prod-verdier i `.env.local`) for å kryptere eksisterende rader, og koble til Fiken på nytt én gang så gamle klartekst-tokens i databasebackups blir verdiløse.

## 5. Fiken: registrer prod-callback

I Fiken-appen «Notisen» → legg til i listen over godkjente redirect-URIer:

```
https://DIN-URL/api/fiken/oauth/callback
```

(Behold `http://localhost:3000/api/fiken/oauth/callback` for lokal utvikling.) `FIKEN_REDIRECT_URI` i Vercel må være nøyaktig lik den nye.

## 6. Supabase: tillat prod-URL

Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://DIN-URL`
- **Redirect URLs:** legg til `https://DIN-URL/**` (beholder `http://localhost:3000/**` for lokal dev).

Uten dette kan innlogging/sesjon oppføre seg rart på prod-domenet.

## 7. Deploy

Trykk **Deploy** i Vercel. Første build tar et par minutter. Følg loggen – den kjører `next build` (samme som `npm run build` lokalt, som er grønn).

Feiler den: nesten alltid en manglende/feilstavet env-variabel. Feilmeldingen sier hvilken (`Mangler miljøvariabel: …`).

## 8. Resend (e-postvarslene)

Cron-en kjører uansett, men uten dette sender den ingenting (logger `failed`).

1. Opprett konto på <https://resend.com>.
2. **Rask test uten DNS:** sett `REMINDER_FROM_EMAIL=onboarding@resend.dev` i Vercel. Da kan Resend kun sende til din egen konto-e-post (`theo1358@gmail.com`) – nok til å teste at røret virker.
3. **Ekte oppsett:** Resend → **Domains** → legg til `notisen.no` → sett DNS-recordene Resend oppgir (DKIM `resend._domainkey` TXT, en `send`-subdomene med MX + SPF TXT, valgfri DMARC) hos domeneleverandøren din. Når domenet er «Verified», bytt `REMINDER_FROM_EMAIL` tilbake til `varsel@notisen.no`.
4. **API-nøkkel:** Resend → API Keys → opprett → lim inn som `RESEND_API_KEY` i Vercel. Sett gjerne en **sending-grense** samme sted.
5. Redeploy (Vercel → Deployments → ⋯ → Redeploy) så den nye nøkkelen tas i bruk.

## 9. (Valgfritt) Eget domene

Project → **Settings → Domains** → legg til `notisen.no` → følg DNS-instruksjonene (en `A`- eller `CNAME`-record). Når det er aktivt: oppdater `APP_URL`, `FIKEN_REDIRECT_URI` (+ Fiken-appen) og Supabase Site URL til `https://notisen.no`, og redeploy.

## 10. Verifiser etter deploy

1. **Åpne `https://DIN-URL`** – landingssiden laster.
2. **Signup → dashboard → Koble til Fiken → last opp en kontrakt → kjør uttrekk → bekreft.** Samme flyt som lokalt.
3. **Test cron manuelt** (fra din maskin – bruk `CRON_SECRET`-verdien):
   ```bash
   curl -s -H "Authorization: Bearer DIN_CRON_SECRET" https://DIN-URL/api/cron/reminders
   curl -s -H "Authorization: Bearer DIN_CRON_SECRET" https://DIN-URL/api/cron/maintenance
   ```
   Begge skal svare `200 {"ok":true,...}`. Uten header → `401`.
4. **Cron-schedule:** Vercel → Project → **Cron Jobs** – skal vise `/api/cron/reminders` (07:00 UTC) og `/api/cron/maintenance` (04:00 UTC). Vercel Hobby kjører kun daglig – det er akkurat det disse er satt til.
5. **Etter første nattlige kjøring:** Vercel → **Logs** → filtrer på `/api/cron/reminders`. Det er eneste sted `failed > 0` (f.eks. Resend-domene ikke verifisert) blir synlig.

## 11. Videre – hver senere endring

`git push` til `main` → Vercel bygger og deployer automatisk. Pull requests får en egen preview-URL. Env-endringer krever en manuell redeploy for å tre i kraft.

## Kjente ting

- `.nvmrc` sier Node `20` – Vercel bruker den. Fungerer fint; bump til `22` hvis du vil matche lokal versjon.
- Bruker-trigget PDF-uttrekk har `maxDuration = 300`, men Vercel Hobby klamper til 60s. En stor/treg PDF kan da timeoute – brukeren får «Prøv igjen»-knappen etter 5 min. Pro-plan ($20/mnd) fjerner klampingen.
- Roll-forward av `next_deadline` er ikke bygget ennå: varsler stopper etter første fornyelse. OK for din egen testbedrift det første året (se `docs/PLAN-reminders-og-opprydding.md`).
