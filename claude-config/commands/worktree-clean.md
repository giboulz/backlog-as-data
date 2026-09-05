# /worktree-clean — Audit et nettoyage des worktrees

Inspecte tous les worktrees, identifie ceux qui peuvent être supprimés, demande confirmation par nom.
Exécuter dans l'ordre exact, sans sauter d'étape.

---

## Étape 1 — Lister les worktrees git

```bash
git worktree list
```

Extraire tous les worktrees **sauf main**.

---

## Étape 1bis — Détecter les dossiers orphelins

Scanner le dossier `.claude/worktrees/` sur le disque :

```bash
ls .claude/worktrees/
```

Comparer avec la liste git. Tout dossier présent sur le disque mais **absent de la liste git** = **ORPHELIN** (session fermée sans `remove` propre, git ne le connaît plus).

Si ni worktrees git ni dossiers orphelins : afficher `Aucun worktree actif.` et stopper.

---

## Étape 2 — Analyser chaque worktree git

**Substitutions utilisées dans ce skill** : `<chemin>` — le chemin disque du
worktree en cours d'analyse ou de suppression (une valeur différente à chaque
itération de la boucle « pour chaque worktree »), jamais une valeur fixe.

Pour chaque worktree `<chemin>` / `<branche>` (hors main) :

```bash
git -C <chemin> status --porcelain          # modifications non committées
git -C <chemin> rev-list main..HEAD --count  # commits pas encore dans main
```

Classer dans l'une des catégories :

| Catégorie | Condition |
|---|---|
| `PROPRE` | 0 commit devant main **et** working tree vide |
| `NON MERGÉ` | ≥ 1 commit devant main (working tree propre ou non) |
| `TRAVAIL EN COURS` | Working tree non propre (avec ou sans commits devant main) |

---

## Étape 3 — Afficher le tableau d'audit

Inclure à la fois les worktrees git et les dossiers orphelins :

```
Audit worktrees
───────────────────────────────────────────────
✓ PROPRE       <branche-1>   — 0 commit, rien en attente
◈ NON MERGÉ   <branche-2>   — 3 commits à envoyer sur main
⚠ EN COURS     <branche-3>   — modifications non committées
🗑 ORPHELIN    <dossier-4>   — dossier sur disque, git ne le connaît plus
```

---

## Étape 4 — Proposer la suppression des worktrees PROPRES et ORPHELINS

Si aucun worktree `PROPRE` ni `ORPHELIN` : afficher `Rien à nettoyer.` et stopper.

Sinon, afficher pour chaque PROPRE ou ORPHELIN, **un par un** :

```
Supprimer <branche-ou-dossier> (<chemin>) ? [oui/non]
```

**Attendre la réponse de l'utilisateur pour chacun avant de continuer.**

---

## Étape 5 — Supprimer les worktrees confirmés

### ⚠️ Étape 5.0 — Retirer la jonction `node_modules` AVANT toute suppression (CRITIQUE)

Les worktrees créés par `/sdd-run-ticket` (et les worktrees de session où l'on a
fait `mklink /J` à la main) ont un `node_modules` qui est une **jonction** pointant
vers le `node_modules` du worktree principal. Le coupable précis (vérifié
empiriquement 2026-06-12) est **`git worktree remove` lui-même** (Étape 5.1) : il
**descend DANS la jonction et vide le contenu réel du `node_modules` de main** →
main vidé, `build`/`test`/`tsc`/`npm run *` cassés « sans raison ». ⚠️ Contrairement
à une croyance répandue, `rm -rf`, `Remove-Item -Recurse`, Node `fs.rm`, `cmd rmdir`
et `.NET Directory.Delete(true)` **ne suivent PAS** la jonction — **seul
`git worktree remove` la suit**.

**Donc, pour CHAQUE worktree à supprimer (PROPRE ou ORPHELIN), retirer la jonction
AVANT le `git worktree remove` de l'Étape 5.1 — `rmdir` supprime le lien SANS suivre
la cible :**

```bash
cmd //c "rmdir \"<chemin>\node_modules\"" 2>/dev/null || true
```

`rmdir` (cmd) sur une jonction ne touche **jamais** la cible. `2>/dev/null || true`
rend l'opération idempotente (no-op si pas de `node_modules`, ou si c'est un vrai
dossier — auquel cas `rmdir` non-vide échoue et le `git worktree remove` suivant
s'en charge). Cette Étape 5.0 est ce qui rend `/worktree-clean` sûr ; les chemins
NON gardés qui restent dangereux = l'**auto-clean du harness** (worktrees d'agents
`isolation: worktree`), la **suppression via l'UI FleetView**, et tout
`git worktree remove` tapé à la main sur un worktree encore jonctionné.

### Étape 5.1 — Suppression

**Pour un worktree PROPRE (connu de git) :**

```bash
git worktree remove "<chemin>"
```

- Si succès → afficher : `✓ <branche> supprimé.`
- Si erreur (ex : Permission denied) → tenter (la jonction ayant déjà été retirée
  à l'Étape 5.0, ce `rm -rf` ne peut plus atteindre le `node_modules` de main) :
  ```bash
  rm -rf "<chemin>"
  git worktree prune
  ```
  Afficher le résultat.

**Pour un dossier ORPHELIN (inconnu de git) :**

```bash
rm -rf "<chemin>"
```

- Si succès → afficher : `✓ <dossier> supprimé (orphelin).`
- Si erreur → afficher l'erreur, ne pas continuer sur les suivants.

Après toutes les suppressions, nettoyer les références stales :

```bash
git worktree prune
```

---

## Étape 6 — Résumé final

```
Nettoyage terminé
─────────────────
✓ Supprimés  : <branche-1>, <dossier-4>
◈ Conservés  : <branche-2> (NON MERGÉ), <branche-3> (travail en cours), <branche-5> (refus)
```

---

## Règles strictes

- Ne **jamais** supprimer un worktree sans confirmation explicite par nom.
- Ne **jamais** supprimer un worktree `NON MERGÉ` ou `EN COURS`, même si l'utilisateur le demande — signaler le risque et refuser.
- Les ORPHELINS peuvent être supprimés (git ne les connaît plus) mais toujours avec confirmation.
- Ne **jamais** pousser (`git push`).
