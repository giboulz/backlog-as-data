# /deploywithchangelog — Push en production avec mise à jour automatique du changelog

Workflow de déploiement vers `main` (Vercel auto-deploy), avec bump automatique du changelog.
Exécuter dans l'ordre exact, sans sauter d'étape. Aucune intervention utilisateur requise.

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

## Étape 4 — Détection du fichier changelog et lecture

Auto-détecter le fichier changelog du projet :
```bash
CHANGELOG_FILE=$(git ls-files | grep -E "changelog\.[tj]s$" | grep -v "node_modules" | head -1)
```
- Si vide → **stopper** avec `❌ Fichier changelog introuvable dans ce dépôt.`

Lire `$CHANGELOG_FILE` pour obtenir :
- `CURRENT_VERSION` (constante exportée)
- La structure des entrées (champ `items`, `changes`, ou autre selon le projet)

Récupérer les commits depuis la dernière modification de ce fichier :
```bash
git log --oneline $(git log --diff-filter=M --follow --format="%H" -- $CHANGELOG_FILE | head -1)..HEAD -- .
```
Si aucun commit n'existe depuis la dernière maj → afficher un avertissement et passer à l'étape 5 sans modifier le changelog.

## Étape 5 — Bump automatique de la version

Analyser les messages de commit collectés :
- Au moins un commit `feat(...)` ou `feat!` → bump **minor** (X.Y+1.0)
- Au moins un commit `BREAKING CHANGE` ou `!:` → bump **major** (X+1.0.0)
- Sinon (fix, chore, refactor, style…) → bump **patch** (X.Y.Z+1)

## Étape 6 — Mise à jour du changelog

Modifier `$CHANGELOG_FILE` en respectant la structure existante du fichier :
- Bumper `CURRENT_VERSION` selon la règle de l'étape 5.
- Ajouter une nouvelle entrée en tête du tableau, en reproduisant le format des entrées existantes (champs, types de changements, etc.).
- Pour les projets qui utilisent `items: [{type, label}]` : mapper `feat` → `'new'`, `fix` → `'fix'`, `refactor`/`improvement`/`chore` → `'improvement'`.

Ne jamais supprimer ni modifier les entrées existantes.

Afficher un résumé de ce qui a été ajouté :
```
✓ Changelog mis à jour : X.Y.Z → A.B.C
  - N entrées ajoutées
```

## Étape 7 — Commit du changelog

```bash
git add $CHANGELOG_FILE
git commit -m "chore: bump changelog to vA.B.C"
```

## Étape 8 — Push

```bash
git push origin HEAD:main
```

⚠️ `HEAD:main`, **jamais** `git push origin main` : depuis un worktree, cette
dernière forme pousse la branche `main` **locale** du dépôt parent, pas le HEAD
courant — les commits qu'on vient de faire (dont le bump de changelog de l'étape 7)
ne partent pas, silencieusement : le push réussit, il pousse juste autre chose.
Incident 2026-06-22 : worktree `claude/cool-curie-975f3e`, commits `e5116dcd` +
`7f56270e` écartés du push, CI rouge sur le test de cohérence H3. Depuis `main`,
`HEAD:main` est strictement équivalent — d'où la forme unique, sans condition
sur la branche.

Après le push, afficher :
```
✓ Poussé sur main. Deploy déclenché.
```

---

## Règles strictes

- Exit code non-zéro à n'importe quelle étape → stopper, expliquer, ne pas continuer.
- Ne jamais demander de confirmation à l'utilisateur — tout est automatique.
- Ne jamais supprimer d'entrées existantes dans le fichier changelog.
- Ne jamais remplacer `git push origin HEAD:main` par `git push origin main`, même
  si la permission de ce dernier est déjà accordée : voir l'avertissement Étape 8.
- La permission `Bash(git push origin HEAD:main)` doit être accordée dans le
  `.claude/settings.json` du projet (sinon simple prompt de permission, pas un échec).
