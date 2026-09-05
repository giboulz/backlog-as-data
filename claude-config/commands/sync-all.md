# /sync-all — Synchroniser tous les worktrees avec main

À lancer depuis `main`. Tire les derniers commits et les applique sur chaque worktree actif via rebase.
Exécuter dans l'ordre exact, sans sauter d'étape.

---

## Prérequis

Vérifier qu'on est sur `main` :

```bash
git rev-parse --abbrev-ref HEAD
```

- Si la branche n'est pas `main` : **stopper immédiatement**, afficher une erreur.

---

## Étape 1 — Mettre à jour main

```bash
git pull origin main
```

- Si l'exit code est non-zéro : **stopper immédiatement**, afficher l'erreur.

---

## Étape 2 — Lister les worktrees

```bash
git worktree list
```

Extraire tous les worktrees **sauf main**. Si aucun worktree lié n'existe : afficher `Aucun worktree actif.` et stopper.

---

## Étape 3 — Rebase de chaque worktree

**Substitutions utilisées dans ce skill** : `<chemin>` — le chemin disque du
worktree en cours de traitement à cette itération (une valeur différente par
worktree, jamais une valeur fixe).

Pour chaque worktree `<chemin>` / `<branche>` :

**3a — Vérifier que le working tree est propre :**

```bash
git -C <chemin> status --porcelain
```

- Si des modifications non committées existent → **skippé**, noter :
  ```
  ⚠ <branche> — skippé (modifications non committées)
  ```

**3b — Rebase sur main :**

```bash
git -C <chemin> rebase main
```

- Si succès → noter : `✓ <branche> — rebasée`
- Si conflit (exit code non-zéro) :
  ```bash
  git -C <chemin> rebase --abort
  ```
  Noter : `✗ <branche> — conflit, rebase annulé → à résoudre dans la session worktree`

---

## Étape 4 — Rapport final

Afficher le tableau de synthèse :

```
Résultat /sync-all
──────────────────
✓ <branche-1> — rebasée (N commits au-dessus de main)
✓ <branche-2> — rebasée (N commits au-dessus de main)
⚠ <branche-3> — skippé (modifications non committées)
✗ <branche-4> — conflit → résoudre dans la session worktree
```

Pour chaque `✓`, calculer N avec `git -C <chemin> rev-list main..HEAD --count`.

Pour chaque `✗`, donner le nom du fichier conflictuel si visible dans l'output du rebase.

---

## Règles strictes

- Ne **jamais** pousser (`git push`).
- Ne **jamais** toucher à `lib/changelog.ts`.
- Un conflit = `rebase --abort` immédiat, jamais de résolution silencieuse.
- Ne **jamais** skippé un worktree sans l'expliquer dans le rapport.
