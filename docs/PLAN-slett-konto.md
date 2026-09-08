# Byggeplan: «Slett konto»-flyt

Laget av architect-agenten. Følges av coder → tester → manager.

## Hvorfor
GDPR (rett til sletting) før ekte kunde. Cascade fra `auth.users` fjerner alle DB-rader (`fiken_connection`, `supplier`, `contract`, `reminder_log`) men **ikke** PDF-ene i Storage — de må ryddes eksplisitt.

## Beslutninger

| Spørsmål | Valg |
|---|---|
| Rekkefølge | Storage FØRST, så `auth.admin.deleteUser(userId)` (cascader all DB) |
| Delvis storage-feil | **AVBRYT** — kast før `deleteUser`, la brukeren prøve igjen. Er brukeren først slettet kan hen aldri retrye. |
| Bekreftelses-UX | Skriv inn din egen e-postadresse; knapp `disabled` til den matcher. + `window.confirm` på toppen. |
| `auth.admin.deleteUser` | `deleteUser(id)` — default = hard delete = GDPR-riktig. `@supabase/supabase-js@^2.48.1`. |
| Schema-endring | Ingen. Cascade finnes allerede. |
| Orphan-sveipen | Behold logg-only. Abort-på-feil gjør sletteflyten selv pålitelig. |
| Fiken revoke | Ingen endpoint. Gjenbruk «fjern Notisens tilgang inne i Fiken selv»-teksten. |

## Fase 1 — `lib/delete-account.ts` (ny, server-only-fri, testbar)

`deleteAccountData(admin: SupabaseClient, userId: string): Promise<DeleteAccountResult>`
`DeleteAccountResult = { storageFilesFound, storageFilesDeleted, storageErrors: string[], userDeleted: boolean }`

1. List alle objekter under `<userId>/` i bøtta `contracts` — `admin.storage.from("contracts").list(userId, { limit: 1000, offset, sortBy })` i **løkke til returnert lengde < 1000**. Samle stier `` `${userId}/${entry.name}` ``. `entry.id === null` (mappe — skal ikke forekomme) → `storageErrors` + hopp over.
2. Slett i batcher à 100 med `.remove(batch)`. Samle `error.message` per batch. Tell faktisk slettede.
3. **`storageErrors.length > 0` → `throw`** med oppsummering. IKKE kall `deleteUser`.
4. `await admin.auth.admin.deleteUser(userId)` (hard delete). `error` → kast. `userDeleted = true`.
5. Retur.

Edge case «id finnes ikke»: `list` → `[]`, `deleteUser` → error «User not found» → kast med lesbar melding (eller returner `{ userDeleted: false }` — Coder avgjør, kast er OK). All DB-sletting via cascade — funksjonen rører aldri de fire tabellene eksplisitt.

## Fase 2 — `app/(app)/settings/actions.ts` (ny, `"use server"`)

`deleteAccount(formData)`:
1. `createClient()` (bruker-scoped), `getUser()`. `!user` → `redirect("/login?next=/settings")`.
2. `formData.get("bekreftelse")` vs `user.email` (trim, lowercase). Mismatch → `redirect("/settings?slett_feil=bekreftelse")`.
3. `createAdminClient()`.
4. `try { await deleteAccountData(admin, user.id) } catch { redirect("/settings?slett_feil=1") }` — **alltid `user.id` fra sesjonen, aldri fra `formData`.**
5. `await supabase.auth.signOut()`.
6. `redirect("/login?slettet=1")`.

Ingen `revalidatePath`. CSRF: Next sin innebygde server-action-origin-sjekk holder.

## Fase 3 — `app/(app)/settings/delete-account-form.tsx` (ny, `"use client"`)

Mønster fra `kontrakter/[id]/delete-button.tsx` + input-gate:
- Prop `email: string`. `useState` for feltverdi. Knapp `disabled={value.trim().toLowerCase() !== email.toLowerCase()}`.
- `<form action={deleteAccount}>` med controlled `<input name="bekreftelse">` + rød knapp «Slett kontoen min permanent».
- `onSubmit` → `window.confirm("Dette sletter kontoen din, alle kontrakter og alle PDF-er permanent. Kan ikke angres.")`, `e.preventDefault()` ved avbryt.
- Rød styling som `delete-button.tsx`.

## Fase 4 — `app/(app)/settings/page.tsx`

1. `const user = await requireUser("/settings")` (fang returverdien for `user.email`).
2. Utvid `searchParams` med `slett_feil?: string`.
3. Ny `<section>` nederst, «Faresone»-mønster fra `kontrakter/[id]/page.tsx` (`border-t border-red-500/20`, rød overskrift, forklarende `<p className="text-xs opacity-60">`, så `<DeleteAccountForm email={user.email!} />`).
4. Feilbanner øverst: `slett_feil === "bekreftelse"` → «E-posten du skrev inn stemmer ikke.»; annen → «Klarte ikke slette kontoen nå. Ingenting er slettet – prøv igjen om litt.»

## Fase 5 — `app/(auth)/login/page.tsx`

1. Utvid `searchParams` med `slettet?: string`.
2. `slettet` satt → grønt banner: «Kontoen din er slettet. All data og alle opplastede filer er fjernet permanent.» + «Husk at du også må fjerne Notisens tilgang inne i Fiken hvis du vil trekke den helt tilbake.»
3. Ingen endring i `app/(auth)/actions.ts`.

## Fase 6 — `scripts/delete-account-test.ts` (ny) + `package.json` `"delete-account:test"`

Mal `scripts/delete-contract-test.ts` (check-helper, nonce, PASS/FAIL, `finally`-opprydding, `admin` + to brukere A/B, ekte PDF-fixture, mot prod-Supabase — advar i toppkommentar).

1. Seed bruker A (via anon-klient som A → RLS + storage-policyer treffer): PDF på `<A.id>/<contractId>.pdf`, `supplier`, `contract` (`confirmed`, framtidig `next_deadline`), `reminder_log`. Seed bruker B med sitt eget sett.
2. Seed A en `fiken_connection`-rad via `admin` (dummy-tekst i token-kolonnene holder).
3. `deleteAccountData(admin, A.id)` → assert `storageFilesDeleted >= 1`, `storageErrors` tom, `userDeleted === true`.
4. Verifiser som service role for A: 0 rader i alle fire tabeller, 0 objekter under `<A.id>/`, `getUserById(A.id)` → feil/ingen.
5. Verifiser B HELT urørt: rad-tellinger uendret, `<B.id>/`-PDF finnes, B i `auth.users`.
6. `deleteAccountData(admin, <tilfeldig ny uuid>)` → ikke ukontrollert krasj; fornuftig retur eller fanget Error.
7. `finally`: fjern gjenværende testfiler, `deleteUser` A + B (best effort).

## Byggerekkefølge

Fase 1 → 2 → 3 → 4 → 5 → 6.

## Theodor gjør selv

- Ingenting i Supabase-konsollen (ingen schema-/policy-endring).
- `npm run delete-account:test` mot prod etter coder (lager/sletter egne testbrukere, men treffer ekte prosjekt).
- `npm run build` + deploy.
- Manuell røyktest: throwaway-konto → last opp PDF → slett konto → bekreft `/login?slettet=1` + PDF borte i Storage-browseren.

## Risikoer / åpne spørsmål

1. **Permanent fastlåst fil blokkerer sletting for alltid** (abort-på-feil). Lav sannsynlighet. Mitigasjon: manuell sletting via service role — dokumentér som kjent prosedyre.
2. **`storage.objects.owner`-cascade** varierer mellom Supabase-versjoner. Vi sidesteper ved å slette storage eksplisitt først — testen (punkt 4) verifiserer 0 objekter gjenstår.
3. **Sesjons-JWT gyldig ~1t etter sletting.** `signOut()` tømmer cookien. En kopiert token mot Supabase REST i resten av timen får 0 rader (alt slettet) + 0 filer (policyer). Akseptabel restrisiko.
4. **`auth.audit_log_entries`** kan beholde bruker-id i JSON (ikke cascadet). Sannsynligvis innenfor GDPR (teknisk logg), bekreft mot Supabase-DPA før ekte kunde.
5. **Paginering i `list`-løkka MÅ være korrekt** (fortsett til `< limit`), ellers etterlates filer > 1000 stille. Testen dekker ikke det volumet — Coder må være nøye.
6. **`createAdminClient()` i en brukerforespørsel** — forsvarlig her fordi `user.id` kun kommer fra `getUser()` og operasjonen er scoped til den id-en. Ingen `formData`-verdi må nå fram til `deleteAccountData`/`deleteUser`.
7. **`user.email` kan være `undefined`** for OAuth-brukere uten e-post. Notisen bruker kun e-post/passord i dag → alltid satt. Endrer det seg: fall tilbake til å skrive «SLETT».
