# TUBy

Des guides pas à pas « comme une recette de cuisine ». L'admin crée les guides et les attribue ; chaque élève avance dans un tube : **une seule étape à l'écran, une seule action à la fois**. Quand l'élève bloque, il le dit, et l'admin lui ajoute des étapes intermédiaires.

- **Élève** : `/` — connexion par prénom + code à 6 caractères.
- **Admin** : `/admin` — connexion par mot de passe.

Tout tourne sur le plan gratuit de Cloudflare : **Pages** (site), **Pages Functions** (API `/api/*`) et **D1** (base `tuby`). Aucun autre service.

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `src/` | Interface (Vite + React + TypeScript + Tailwind). `src/student` = le tube, `src/admin` = l'admin. |
| `shared/tube.ts` | Les règles du tube (étape suivante, choix, boucles, pause, aide). Utilisées par l'API et par l'aperçu élève. |
| `functions/api/` + `server/` | L'API. Chaque route vérifie la session ; requêtes SQL préparées uniquement. |
| `migrations/` | Schéma de la base D1, versionné. |
| `seed/` + `scripts/seed.mjs` | Guide de départ (YAML) et son import. |
| `tests/` | Tests des règles du tube (`npm test`) et parcours complet en navigateur (`npm run test:e2e`). |

## Lancer en local

```bash
npm install
npm run db:migrate:local                               # crée la base locale
npm run db:seed:local                                  # importe le guide de départ et l'élève Alessio
node scripts/admin-password.mjs --local "mot-de-passe-de-test"   # écrit .dev.vars (jamais commité)
npm run dev                                            # http://localhost:8788
```

`npm run dev` construit le site puis le sert avec `wrangler pages dev` (API et base D1 locales comprises). Pour travailler l'interface avec rechargement à chaud : garde `npm run dev` ouvert et lance `npm run dev:ui` dans un second terminal.

Tests : `npm test` (règles du tube) et, serveur local lancé, `npm run test:e2e` (tous les critères d'acceptation dans un vrai navigateur).

## Appliquer une migration

1. Ajoute un fichier `migrations/0002_ce_que_ca_change.sql` (numéro suivant).
2. Teste : `npm run db:migrate:local`.
3. Applique en production : `npm run db:migrate`.

## Changer le mot de passe admin

```bash
npm run admin:password                      # en génère un fort et l'affiche une seule fois
npm run admin:password -- "ma phrase secrète à moi"   # ou choisis-le (12 caractères minimum)
```

Seul le hash (PBKDF2) part dans les variables secrètes Cloudflare. Il devient actif au **prochain déploiement** : pousse un commit, ou relance le dernier déploiement dans Cloudflare (Workers & Pages → tuby → Deployments → ⋯ → Retry deployment). Les sessions admin ouvertes sont alors fermées.

## Sauvegarder la base

```bash
npm run db:export        # écrit sauvegarde-tuby.sql (ignoré par git)
```

Pour restaurer dans une base vide : `npx wrangler d1 execute tuby --remote --file sauvegarde-tuby.sql`.

## Mise en ligne

Le projet Cloudflare Pages `tuby` est relié à ce dépôt : chaque push sur `main` déclenche un déploiement (commande `npm run build`, dossier `dist`). Le binding D1 `DB` est déclaré dans `wrangler.toml`.

Deux variables secrètes, posées avec `wrangler pages secret put <NOM> --project-name tuby` :

- `ADMIN_PASSWORD_HASH` — hash du mot de passe admin (voir ci-dessus).
- `SESSION_SECRET` — clé de signature. **Ne la change pas** : tous les codes élèves et les sessions admin deviendraient invalides (il faudrait régénérer chaque code).

## Sécurité, en bref

- Sessions par cookies `HttpOnly`, `Secure`, `SameSite=Lax` ; les écritures exigent du JSON de même origine.
- Codes élèves et jetons de session stockés hachés ; 5 erreurs de connexion → blocage 10 minutes.
- Un élève ne lit et ne modifie que ses propres attributions ; sans session, toute route `/api/*` (hors connexion) répond 401.
- Chaque appel d'API regroupe ses lectures (quelques requêtes D1, toujours moins de 50). L'écran d'attente de l'élève et le tableau de bord admin interrogent l'API toutes les 20 secondes.

## Écrire une étape

Dans « Quoi faire » : une ligne = un paragraphe ; une ligne qui commence par `[À COPIER]` devient un bloc avec bouton Copier ; un lien s'écrit `[texte](https://…)`.

| Type | Ce que voit l'élève | Pour avancer |
|---|---|---|
| Prérequis | Cases à cocher | Toutes cochées → « C'est parti » |
| Action | Titre, objectif, quoi faire | Oui / Pause / À l'aide ! |
| Vérification | Une question | Oui → suite ; Non → consigne de rattrapage puis « C'est fait » |
| Choix | Une question, 2 à 4 boutons | Chaque bouton envoie vers l'étape choisie |
| Récap | Liste de ce qui vient d'être fait | « Chapitre suivant » ou « Terminé » |
