# Deploy – helt konkret, steg for steg

For deg som ikke har gjort dette før. Følg i rekkefølge. Der det står «skriv» mener jeg lim inn i Terminal og trykk Enter.

---

# DEL 1 – Få koden opp på GitHub

Du har laget et tomt repo `Theosalv-Notisen/notisen`. Nå skal koden din dit.

## 1.1 Lag en tilgangsnøkkel (Personal Access Token)

GitHub godtar ikke passord i Terminal – du trenger en «token» i stedet.

1. Åpne <https://github.com/settings/tokens> i nettleseren (logg inn som Theosalv-Notisen).
2. Klikk **Generate new token** → **Generate new token (classic)**.
3. **Note:** skriv `notisen-deploy`.
4. **Expiration:** velg `90 days`.
5. Under **Select scopes**, huk av den øverste boksen **`repo`** (da hukes alle under den av automatisk).
6. Rull ned, klikk **Generate token**.
7. Nå vises en lang streng som starter med `ghp_`. **Kopier den nå** – du ser den kun én gang. Lim den midlertidig inn i Notes eller et tomt tekstdokument.

## 1.2 Koble repoet til GitHub og push

Åpne Terminal, og skriv én linje av gangen:

```bash
cd ~/code/notisen
```

```bash
git remote add origin https://github.com/Theosalv-Notisen/notisen.git
```

```bash
git push -u origin main
```

Nå spør den om innlogging:
- **Username for 'https://github.com':** skriv `Theosalv-Notisen` og Enter.
- **Password for '...':** lim inn `ghp_...`-tokenen (den vises ikke mens du limer – det er normalt) og Enter.

Det laster opp. Når det står `branch 'main' set up to track 'origin/main'` er du ferdig.

## 1.3 Sjekk at hemmeligheter IKKE ble lastet opp

```bash
git ls-files | grep -i env
```

Svaret skal være **nøyaktig**:
```
.env.example
lib/env.ts
```

Ser du `.env` eller `.env.local` i lista – STOPP og si fra. (Det skal ikke skje, de er git-ignorert.)

Gå til <https://github.com/Theosalv-Notisen/notisen> – du skal se alle mappene (`app`, `lib`, `docs` …).

---

# DEL 2 – Koble til Vercel

## 2.1 Logg inn

1. Åpne <https://vercel.com/signup>.
2. Klikk **Continue with GitHub**. Logg inn, klikk **Authorize Vercel**.
3. Hvis den spør om plan: velg **Hobby** (gratis).

## 2.2 Importer prosjektet

1. Du havner på **Vercel-dashbordet**. Klikk **Add New…** (øverst til høyre) → **Project**.
2. Under **Import Git Repository** ser du `Theosalv-Notisen/notisen`. Klikk **Import** ved siden av den.
   - Ser du den ikke: klikk **Adjust GitHub App Permissions** / **Configure GitHub App**, velg repoet `notisen`, lagre, gå tilbake.
3. Nå er du på **«Configure Project»**-siden.
   - **Framework Preset:** skal si `Next.js` automatisk. Ikke rør.
   - **Root Directory:** `./` – ikke rør.
   - **Build and Output Settings:** ikke rør.
4. **IKKE klikk Deploy ennå.** Først: miljøvariabler (neste steg).

## 2.3 Legg inn miljøvariabler

Fortsatt på «Configure Project»-siden, klikk for å utvide **Environment Variables**.

Du legger inn **11 variabler**, én av gangen: skriv navnet i **Key**-feltet, verdien i **Value**-feltet, klikk **Add**.

Verdiene ligger i to filer på maskinen din. Åpne dem i tekstredigering med:

```bash
open -e ~/code/notisen/.env
open -e ~/code/notisen/.env.local
```

### Disse limer du inn akkurat som de står i filene:

| Key | Value = linja i filen |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | fra `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | fra `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | fra `.env.local` |
| `FIKEN_CLIENT_ID` | fra `.env` |
| `FIKEN_CLIENT_SECRET` | fra `.env` |
| `ANTHROPIC_API_KEY` | fra `.env.local` |
| `CRON_SECRET` | fra `.env.local` |

(Kopier alt etter `=`-tegnet på hver linje. Ikke ta med `NAVN=`-delen.)

### Disse skriver du inn manuelt:

| Key | Value |
|---|---|
| `REMINDER_FROM_EMAIL` | `onboarding@resend.dev` |
| `FIKEN_REDIRECT_URI` | `https://notisen.vercel.app/api/fiken/oauth/callback` |
| `APP_URL` | `https://notisen.vercel.app` |
| `RESEND_API_KEY` | `placeholder` (fikser vi i Del 4) |

> **OBS om URL-en:** Jeg gjetter at appen din blir `https://notisen.vercel.app`. Du får se den faktiske adressen rett etter deploy (Del 3). Er den en annen (f.eks. `notisen-abc123.vercel.app`), må du rette `FIKEN_REDIRECT_URI` og `APP_URL` etterpå – jeg viser hvordan i Del 3.5.

## 2.4 Deploy

Klikk den store **Deploy**-knappen. Vent 2–4 minutter. Du ser en byggelogg rulle.

- **Grønt / konfetti:** 🎉 gå til Del 3.
- **Rødt / «Build Failed»:** rull opp i loggen til den første røde linja. Står det `Mangler miljøvariabel: X` – da mangler eller er feilstavet variabel `X`. Fiks i **Settings → Environment Variables**, så **Deployments → ⋯ (tre prikker) → Redeploy**.

---

# DEL 3 – Etter første deploy

## 3.1 Finn adressen din

På prosjektsiden i Vercel, under **Domains**, står adressen – f.eks. `notisen.vercel.app`. Klikk på den, appen åpnes. Du skal se «Notisen»-forsiden.

## 3.2 Rett URL-ene hvis de ikke stemte

Hvis adressen **ikke** er `notisen.vercel.app`:

1. Vercel → **Settings → Environment Variables**.
2. Finn `APP_URL`, klikk **Edit** (blyanten), sett verdien til `https://DIN-FAKTISKE-ADRESSE`, **Save**.
3. Samme for `FIKEN_REDIRECT_URI` → `https://DIN-FAKTISKE-ADRESSE/api/fiken/oauth/callback`.
4. **Deployments → ⋯ → Redeploy.**

## 3.3 Fortell Fiken om den nye adressen

1. Åpne Fiken-appen «Notisen» (der du laget Client ID/Secret).
2. I feltet for **godkjente redirect-URIer / endepunkter**, legg til en ny linje:
   ```
   https://DIN-ADRESSE/api/fiken/oauth/callback
   ```
   (Behold `http://localhost:3000/...`-linja.)
3. Lagre. Denne må være **nøyaktig lik** `FIKEN_REDIRECT_URI` i Vercel.

## 3.4 Fortell Supabase om den nye adressen

1. Supabase → prosjektet ditt → **Authentication** (venstremeny) → **URL Configuration**.
2. **Site URL:** `https://DIN-ADRESSE`
3. **Redirect URLs:** klikk **Add URL**, skriv `https://DIN-ADRESSE/**` (med to stjerner). Behold `http://localhost:3000/**`.
4. **Save.**

## 3.5 Prøv appen

Åpne `https://DIN-ADRESSE` i en vanlig nettleser:
1. **Registrer deg** med en ekte e-post + passord.
2. **Innstillinger → Koble til Fiken** → logg inn i Fiken → **Godkjenn**.
3. Du skal komme tilbake til Notisen med «Koblet til Fiken».
4. **Oversikt** viser leverandørene. **Last opp kontrakt** på en av dem, velg en PDF, **Kjør uttrekk**, **Bekreft**.

Funker dette, er selve appen live. Mangler bare e-post (Del 4).

---

# DEL 4 – E-postvarsler (Resend)

Uten dette gjør appen alt annet, men sender ingen varsel-e-post.

## 4.1 Lag Resend-konto og nøkkel

1. <https://resend.com/signup> → registrer (bruk `theo1358@gmail.com`).
2. Venstremeny → **API Keys** → **Create API Key**.
   - **Name:** `notisen`
   - **Permission:** `Sending access`
   - **Create** → kopier `re_...`-strengen.
3. Vercel → **Settings → Environment Variables** → finn `RESEND_API_KEY` → **Edit** → lim inn `re_...` → **Save**.
4. **Deployments → ⋯ → Redeploy.**

Nå kan appen sende – men bare til `theo1358@gmail.com` (din egen konto-adresse), siden `REMINDER_FROM_EMAIL` er `onboarding@resend.dev`. Det holder for å teste at det virker.

## 4.2 (Senere) Ekte avsenderadresse

For å sende til andre enn deg selv må domenet `notisen.no` verifiseres:
1. Resend → **Domains** → **Add Domain** → `notisen.no`.
2. Resend viser noen DNS-oppføringer (DKIM, SPF). Legg dem inn hos den du kjøpte `notisen.no` av.
3. Når status blir **Verified**: Vercel → sett `REMINDER_FROM_EMAIL` = `varsel@notisen.no` → Redeploy.

## 4.3 Test at cron-en virker

I Terminal (bytt inn din adresse og din `CRON_SECRET`-verdi fra `.env.local`):

```bash
curl -s -H "Authorization: Bearer DIN_CRON_SECRET" https://DIN-ADRESSE/api/cron/reminders
```

Svar `{"ok":true,"processed":0,...}` = alt virker (0 fordi ingen frist er innen 90 dager ennå).
Svar `Unauthorized` = feil eller manglende `CRON_SECRET`.

De to nattlige jobbene ser du under Vercel → prosjektet → **Cron Jobs** (`reminders` 07:00 UTC, `maintenance` 04:00 UTC).

---

# Hver gang du endrer koden senere

```bash
cd ~/code/notisen
git add -A
git commit -m "beskrivelse av endringen"
git push
```

Vercel bygger og legger ut automatisk innen et par minutter.

Endrer du en miljøvariabel i Vercel: den trer i kraft først etter en **Redeploy** (Deployments → ⋯ → Redeploy).
