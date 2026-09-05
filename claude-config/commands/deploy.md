# /deploy — Push sécurisé en production

Workflow de déploiement vers `main` (Vercel auto-deploy).
Exécuter dans l'ordre exact, sans sauter d'étape.

---

## Prérequis — `/deploy` ne tourne que depuis `main`

Vérifier que la branche courante est `main` :

```bash
git rev-parse --abbrev-ref HEAD
```

- Si la branche **n'est pas** `main` : **stopper immédiatement**, afficher :
  ```
  ✗ /deploy ne se lance que depuis main (branche courante : <branche>).
    Workflow : /sdd-run-ticket code sur une branche → /send l'intègre sur main → /deploy pousse depuis main.
    Pour envoyer le travail d'une branche, lance /send d'abord.
  ```

Garde **symétrique** de celle de `/send` (qui refuse, lui, de tourner *depuis*
`main`). Le checkout `main` est partagé entre 10-15 sessions/worktrees : une
session voisine peut l'avoir laissé sur une branche `claude/…` étrangère en plein
milieu d'une série de commits inachevée. Sans cette garde, l'Étape 4.1
(`git push origin HEAD:main`) pousserait ce HEAD mi-fini en prod (incident
2026-07-23). Pour déployer le travail d'une branche, on l'intègre d'abord sur
`main` via `/send`, puis on lance `/deploy` depuis `main`.

---

## Étape 0 — Détection de la configuration

Lire `.claude/deploy.md` s'il existe dans le projet courant pour récupérer la commande E2E.

Format reconnu dans `.claude/deploy.md` :
```markdown
## Tests E2E
npm run test:e2e     ← commande à exécuter
```
ou
```markdown
## Tests E2E
none                 ← désactive explicitement les tests E2E
```

Si `.claude/deploy.md` est absent ou ne contient pas de section `## Tests E2E` :
→ auto-détecter via `package.json` :
```bash
node -e "const p=require('./package.json'); process.exit(p.scripts?.['test:e2e'] ? 0 : 1)"
```
- Si le script `test:e2e` existe : commande E2E = `npm run test:e2e`
- Sinon : pas de tests E2E

---

## Étape 0.1 — Mode de déploiement du projet

Tous les projets n'ont pas une prod derrière `main`. Chacun déclare son mode **en
donnée**, dans la section `## Deploy` de son `.claude/deploy.md` — on ne forke
jamais cette commande par projet, on étend la config qu'elle lit.

| `## Deploy` | Signification | Effet sur `/deploy` |
|---|---|---|
| *(section absente)* | Prod derrière `main` (défaut historique, ex. Vercel) | Pipeline complet — continuer à 0.4 |
| `none` | Aucune cible de déploiement (app locale, outil, lib) | No-op, la livraison est faite par `/send` |
| `push` | Pas de prod ; le remote est un **backup**, la livraison **est** le push | Sauter 0.4 → 3, aller directement à l'étape 4 |

Les deux écritures sont acceptées, sur la ligne du titre ou en dessous :

```markdown
## Deploy: push          ## Deploy
                         push
```

Lecture de la valeur (affiche la valeur en minuscules, chaîne vide si absente) :

```bash
node -e "const fs=require('fs');let v='';try{const t=fs.readFileSync('.claude/deploy.md','utf8').split(/\r?\n/);let i=false;for(const l of t){const m=/^##\s*Deploy\b\s*:?\s*(.*)/i.exec(l);if(m){if(m[1].trim()){v=m[1].trim();break}i=true;continue}if(i){if(/^##\s/.test(l))break;if(l.trim()){v=l.trim();break}}}}catch{}console.log(v.toLowerCase())"
```

Ne pas « simplifier » ce parseur : `split(/\r?\n/)` gère les fichiers CRLF (Windows),
`\b` évite de matcher `## Deployment notes`, et la capture inline évite de lire vide
sur `## Deploy: push` — un vide serait interprété comme « pipeline complet », donc
une erreur **silencieuse**.

Selon la valeur :

- **`none`** → afficher
  `⚠ Projet sans déploiement (## Deploy: none) — la livraison se fait via /send. /deploy est un no-op ici.`
  puis **s'arrêter**. Sur ces projets, le passage du cycle backlog à `shipped` est
  posé par `/send` (voir /send Étape 4.6).
- **`push`** → afficher
  `⚠ Projet en mode push (## Deploy: push) — pas de pipeline de vérification, le push est la livraison.`
  puis **sauter les étapes 0.4 à 3** (ni préflight, ni `tsc`, ni `drizzle-kit check`,
  ni tests unitaires, ni E2E) et aller directement à l'**étape 4**. Ces projets
  assument l'absence de garde-fous ici : leurs vérifications sont celles de `/send`
  (tests de cohérence) et de `/fastship` (tests unitaires) quand l'utilisateur les
  lance. Ne pas rajouter de vérification « au cas où » — le mode `push` est un choix
  explicite, pas un oubli.
- **valeur vide (section absente) ou toute autre valeur** → déploiement normal,
  continuer à 0.4. Un projet sans `.claude/deploy.md` est donc inchangé.

---

## Étape 0.4 — Préflight environnement (auto-réparation)

Deux corruptions d'environnement récurrentes quand plusieurs sessions/dev
servers tournent dans le même répertoire. Ce préflight les neutralise de
façon déterministe **avant** le check TypeScript. Les deux commandes sont
idempotentes et sans effet si le problème n'existe pas.

```bash
# 1. node_modules : typescript peut "disparaître" si un autre process a lancé
#    npm install en parallèle (arbre de deps dans un état transitoire).
node -e "require.resolve('typescript')" 2>/dev/null || npm install

# 2. .next/dev/types/routes.d.ts (types Turbopack dev) est réécrit en continu
#    par `next dev` et peut être lu à mi-écriture (corrompu) → tsc parse-error.
#    next-env.d.ts force son import, donc include/exclude tsconfig n'y peut rien.
#    Le supprimer est sûr : absent, tsc passe clean (résolution `bundler`) ;
#    next dev le régénère au prochain lancement.
rm -rf .next/dev/types
```

- Si `npm install` échoue (exit non-zéro) : **stopper**, afficher l'erreur npm.
- Ces commandes ne s'appliquent qu'aux projets Node/Next ; sur un autre type
  de projet elles sont des no-op (dossier/dep absents).

---

## Étape 0.5 — Vérification TypeScript

```bash
npx tsc --noEmit
```

- Si l'exit code est non-zéro : **stopper immédiatement**.
- Afficher les erreurs TypeScript.
- Ne pas continuer vers l'étape 1.

---

## Étape 0.6 — Cohérence migrations Drizzle (si applicable)

Auto-détection : si `drizzle.config.ts` existe à la racine du projet,
lancer la commande de cohérence Drizzle :

```bash
npx drizzle-kit check
```

Sinon (pas de Drizzle dans le projet) : **étape sautée silencieusement**.

- Si l'exit code est non-zéro : **stopper immédiatement**.
- Afficher l'erreur Drizzle (snapshots manquants, journal incohérent, etc.).
- Ne pas continuer vers l'étape 1.

**Pourquoi cette étape ?** Une migration `.sql` créée manuellement sans entrée
journal correspondante est silencieusement ignorée par `drizzle-kit migrate`
→ la modification de schéma n'est jamais appliquée sur la DB prod →
régression à retardement quand une requête tape la colonne manquante.
Anti-pattern documenté : `whereismycard` commit 28308c2 (DECK-IMPROVE-05B)
qui a cassé `/api/magic/prices` en prod pendant plusieurs heures.

---

## Étape 1 — Tests unitaires

```bash
npm test
```

- Si l'exit code est non-zéro : **stopper immédiatement**.
- Afficher quels tests ont échoué.
- Ne pas continuer vers l'étape 2.

## Étape 2 — Tests E2E

Si aucune commande E2E n'est configurée (détectée à l'étape 0) :
→ Afficher `⚠ Pas de tests E2E configurés — étape ignorée.` et passer à l'étape 3.

Sinon, exécuter la commande E2E configurée.

- Si l'exit code est non-zéro : **stopper immédiatement**.
- Afficher le résumé des tests échoués (spec files, erreurs Playwright).
- Ne pas continuer vers l'étape 3.

## Étape 3 — Bilan des tests

Afficher :
```
✓ Tests unitaires : N/N passés
✓ Tests E2E : M/M passés     ← omettre cette ligne si E2E non configuré
```

## Étape 4 — Push

### Étape 4.0 — Backlog-as-data : statut `ship` (AVANT le push)

Poser le statut `shipped` **avant** le push pour qu'il parte dans ce même push.
Posé via l'**outil backlog global** (INFRA-14) ; gardé par sa présence → no-op
total si absent, et le bundle no-op lui-même dans un projet sans backlog. `/deploy`
tourne déjà sur le checkout `main`, donc cwd = `.` :

Le `ship` en masse (`tout merged → shipped`) est **correct ici** : le push envoie tout
main en prod, donc tout ticket `merged` y arrive. Mais le **commit** doit rester scopé :
le checkout main est partagé (10-15 worktrees/sessions en parallèle), et committer
`specs/` en entier ramasserait le `specs/*.md` **en cours d'une autre session** — vécu
le 17/07/2026. On ne committe que les tickets réellement transitionnés + les artefacts :

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
if [ -f "$TOOL" ]; then
  OUT="$(node "$TOOL" hook ship)"
  printf '%s\n' "$OUT"
  # Ids RÉELLEMENT transitionnés. Grammaire ancrée majuscule → la ligne de service
  # « [backlog:hook] ship : rien à faire » ne matche pas (event en minuscules).
  PATHS=""
  for id in $(printf '%s\n' "$OUT" | sed -n 's/^\[backlog:hook\] \([A-Z][A-Z0-9]*\(-[A-Za-z0-9]\{1,\}\)\{1,\}\) : .*/\1/p'); do
    PATHS="$PATHS specs/$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]').md"
  done
  if [ -n "$PATHS" ]; then
    PATHS="backlog.json $PATHS"
    [ -f specs/backlog.md ] && PATHS="$PATHS specs/backlog.md"
    git add -- $PATHS
    # `--only` : un `git commit` nu committe TOUT l'index — donc ce qu'une session
    # voisine y aurait stagé. `--only` se limite aux chemins nommés.
    git diff --cached --quiet -- $PATHS \
      || git commit -q --only -m "chore(backlog): ship" -- $PATHS
  fi
fi
```

Le hook sort toujours 0 et n'émet que des `warn` (tolérance INFRA-11) : il ne doit
**jamais** bloquer le deploy. Aucun commit si aucun ticket `merged` n'est concerné
(`PATHS` vide).

### Étape 4.1 — Push

```bash
git pull --rebase origin main
git push origin HEAD:main
```

⚠️ `HEAD:main`, **jamais** `git push origin main`. Le Prérequis garantit qu'on est
sur `main`, donc `HEAD:main` ≡ `main:main` — on garde la forme `HEAD:main` par
cohérence avec `/send` (mode `push`) et `/fastship`, qui poussent la même forme.
La forme `git push origin main` reste **proscrite** : elle pousse la branche
`main` **locale** telle quelle, et si la garde du Prérequis était un jour
contournée, elle pousserait silencieusement autre chose que le HEAD courant — le
push réussirait en poussant du mauvais contenu (incident 2026-06-22 : commits
`e5116dcd` + `7f56270e` écartés d'un push, CI rouge sur le test de cohérence H3).
(Le `pull --rebase`, lui, s'applique bien au HEAD courant : il reste correct tel
quel.)

Puis, en best-effort — producteur du contrat de mesures SDD vers un consommateur
externe (SKILL-55, specs/skill-55.md), même tolérance que le hook backlog ci-dessus
(INFRA-11) : cet appel **ne peut jamais faire échouer `/deploy`**, config absente ou
consommateur en panne y compris. Gardé par sa présence → no-op total si absent :

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','sdd-push','push.mjs'))")"
[ -f "$TOOL" ] && node "$TOOL" || true
```

Après le push, afficher :
```
✓ Poussé sur main. Deploy déclenché.
```

---

## Règles strictes

- Exit code non-zéro à n'importe quelle étape → stopper, expliquer, ne pas continuer.
- Ne jamais modifier `lib/changelog.ts`.
- Ne jamais remplacer `git push origin HEAD:main` par `git push origin main`, même
  si la permission de ce dernier est déjà accordée : voir l'avertissement Étape 4.1.
- La permission `Bash(git push origin HEAD:main)` doit être accordée dans le
  `.claude/settings.json` du projet (sinon simple prompt de permission, pas un échec).
