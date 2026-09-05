# /fastship — Commit et push rapide en production

Workflow allégé : tests unitaires → commit → push. Sans E2E, sans changelog.
Exécuter dans l'ordre exact, sans sauter d'étape.

---

## Étape 1 — Tests unitaires

```bash
npm test
```

- Si l'exit code est non-zéro : **stopper immédiatement**.
- Afficher quels tests ont échoué.
- Ne pas continuer vers l'étape 2.

## Étape 2 — Bilan des tests

Afficher :
```
✓ Tests unitaires : N/N passés
```

## Étape 3 — Commit

**Substitutions utilisées dans ce skill** : `<message>` — le message de commit
($ARGUMENTS ou demandé à l'utilisateur ci-dessous), jamais une valeur fixe.

Afficher le résultat de `git status`.

- Si `$ARGUMENTS` est fourni → l'utiliser directement comme message de commit.
- Sinon → demander le message de commit à l'utilisateur et **attendre sa réponse**.

Puis exécuter :
```bash
git add -A
git commit -m "<message>"
```

- Si l'exit code est non-zéro (ex : rien à committer, hook échoué) : **stopper immédiatement**.
- Afficher l'erreur et ne pas continuer.

## Étape 4 — Push

```bash
git push origin HEAD:main
```

⚠️ `HEAD:main`, **jamais** `git push origin main` : depuis un worktree, cette
dernière forme pousse la branche `main` **locale** du dépôt parent, pas le HEAD
courant — les commits qu'on vient de faire ne partent pas, silencieusement (le
push réussit, il pousse juste autre chose). Incident 2026-06-22 : worktree
`claude/cool-curie-975f3e`, commits `e5116dcd` + `7f56270e` écartés du push,
CI rouge sur le test de cohérence H3. Depuis `main`, `HEAD:main` est strictement
équivalent — d'où la forme unique, sans condition sur la branche.

Après le push, afficher :
```
✓ Poussé sur main. Deploy déclenché.
```

---

## Règles strictes

- Ne jamais toucher à `lib/changelog.ts`.
- Ne jamais lancer `npm run test:e2e`.
- Exit code non-zéro à n'importe quelle étape → stopper, expliquer, ne pas continuer.
- Ne jamais remplacer `git push origin HEAD:main` par `git push origin main`, même
  si la permission de ce dernier est déjà accordée : voir l'avertissement Étape 4.
- La permission `Bash(git push origin HEAD:main)` doit être accordée dans le
  `.claude/settings.json` du projet (sinon simple prompt de permission, pas un échec).
