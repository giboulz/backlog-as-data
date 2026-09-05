# /sync — Mettre à jour le worktree avec main

Récupère les derniers commits de `main` et rebase la branche courante dessus.
Exécuter dans l'ordre exact, sans sauter d'étape.

---

## Prérequis

Vérifier que la branche courante n'est pas `main` :

```bash
git rev-parse --abbrev-ref HEAD
```

- Si la branche est `main` : **stopper immédiatement**, afficher une erreur.

Vérifier que le working tree est propre :

```bash
git status --porcelain
```

- Si des modifications non committées existent : **stopper immédiatement**, afficher :
  ```
  ✗ Working tree non propre. Committe ou stash avant de sync.
  ```

---

## Étape 1 — Mettre à jour main

**Substitutions utilisées dans ce skill** : `<chemin_main>` — le chemin du
worktree principal (celui dont la branche est `main`), résolu ci-dessous et
réutilisé tel quel, jamais retapé.

Trouver le chemin du worktree principal :

```bash
git worktree list
```

Puis mettre à jour `main` depuis l'origin :

```bash
git -C <chemin_main> pull origin main
```

- Si l'exit code est non-zéro : **stopper immédiatement**, afficher l'erreur.

---

## Étape 2 — Rebase sur main

```bash
git rebase main
```

- Si l'exit code est non-zéro (conflits) : **stopper immédiatement**, afficher :
  ```
  ✗ Conflits de rebase. Résoudre manuellement, puis `git rebase --continue`.
  ```

---

## Étape 3 — Confirmation

Afficher :

```
✓ <branche> rebasée sur main.
  <N> commits locaux au-dessus de main.
```

Calculer N avec `git rev-list main..HEAD --count`.

---

## Règles strictes

- Ne **jamais** pousser (`git push`).
- Ne **jamais** modifier `lib/changelog.ts`.
- Exit code non-zéro à n'importe quelle étape → stopper, expliquer, ne pas continuer.
