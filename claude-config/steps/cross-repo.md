## Étape 4.5 — Chemin du worktree cible : lu du JSON (CROSS-REPO uniquement)

⛔ **Mode `same-repo` : saute cette étape** — le harnais attribue le worktree, et
`worktreePath`/`branch` du JSON valent `null`.

Cette étape ne **crée** rien : elle **lit** un chemin déjà dérivé et contrôlé par
l'outil de l'Étape 1, pour que le récap de l'Étape 5 puisse l'afficher **avant**
toute confirmation. La création vient après (Étape 5.7).

**Substitutions résolues à cette étape** : `<chemin_worktree>` — le champ
`worktreePath` du JSON (chemin absolu), utilisé tel quel jusqu'à la fin du cycle ;
`<branche_cible>` — le champ `branch` du JSON (`claude/` + ID minuscule).

**Assertions lues des garde-fous** — le chemin dérivé n'est pas cru sur parole :

- `guards.worktreeUnderTarget` vaut `true` → **REFUS** : la dérivation tombe sous le
  repo cible. **Stopper** et signaler, avant même le récap.
- `guards.worktreePathFree` vaut `false` → **REFUS** : le chemin est déjà occupé —
  probablement le worktree d'une session voisine sur le même ticket (l'Étape 1.5
  aurait dû le voir en `wip`). **Stopper** ; ne « trouve » pas un autre chemin
  toi-même.
- `guards.branchFree` vaut `false` → **REFUS** : `refs/heads/<branche_cible>` n'est
  pas créable dans le repo cible. **Stopper** avant le récap. Nomme la branche et
  l'oracle qui montre TOUTES les références en conflit — homonyme ou conflit D/F
  (une branche **nue**, ex. `claude`, bloque `claude/foo-01` sans jamais matcher un
  glob `claude/*`) :

  ```bash
  git -C "<racine_cible>" for-each-ref --format='%(refname)' refs/heads/
  ```

  ⚠️ Pas `git branch --list 'claude/*'` : sur le conflit D/F, la branche en
  conflit ne porte pas ce préfixe et l'oracle sortirait **muet**, exit 0 — un faux
  négatif qui ferait conclure à tort que le garde-fou s'est trompé. Pas
  `git worktree list` non plus — sur le cas fondateur (branche survivant à un
  `worktree remove`), il n'affiche rien qui concerne la branche ; il ne sert que
  pour la seconde lecture (« la branche est checkoutée ailleurs »). Deux lectures
  possibles : un cycle voisin travaille dessus (l'Étape 1.5 aurait dû le voir en
  `wip`), ou c'est une référence orpheline laissée par un `worktree remove` — dans
  ce second cas, nomme le remède sans le jouer, sur la référence **exacte** listée
  par l'oracle ci-dessus (`<branche_cible>` dans le cas homonyme, le préfixe nu
  affiché — ex. `claude` — dans le cas conflit D/F) :
  `git -C "<racine_cible>" branch -D "<référence-en-conflit>"`.
  ⛔ **Aucune réparation automatique** : ne supprime pas la référence, ne dérive
  pas un autre nom, ne passe pas en `--force`.

---

> ⛔ **Tu lis les deux étapes d'un coup ; tu ne les joues pas d'un coup.** La
> section ci-dessous (Étape 5.7) **crée** le worktree — celle ci-dessus vient de
> dire qu'elle-même ne crée rien. Elle ne s'exécute qu'à son tour : après le
> récap de l'Étape 5, la réponse de l'utilisateur, et le hook `start` de l'Étape
> 5.5. Lancer son `git worktree add` en lisant l'Étape 4.5 monterait une branche
> pour un cycle que l'utilisateur peut encore refuser, et le prochain essai
> buterait sur un chemin devenu occupé.

## Étape 5.7 — Monter le worktree cible (mode CROSS-REPO uniquement)

⛔ **En mode « même repo », saute entièrement cette étape** : `isolation: "worktree"`
fait le travail, et monter un worktree en double ne servirait qu'à en abandonner un.

Procédure — celle appliquée à la main six fois le 2026-07-21, sans incident. Le
chemin, lui, a déjà été dérivé et contrôlé à l'Étape 4.5 : il ne reste ici que la
**création**.

Création, puis **assertion de branche** :

```bash
git -C "<racine_cible>" worktree add "<chemin_worktree>" -b "<branche_cible>" main
git -C "<chemin_worktree>" rev-parse --abbrev-ref HEAD
git -C "<chemin_worktree>" log --oneline -1
```

- Le `main` final de `worktree add` est **obligatoire** : sans lui, le worktree part
  du `HEAD` courant du checkout cible, qui peut être n'importe quoi. C'est aussi ce
  qui remplit le point 2 de la procédure (synchronisation sur `main`) — un worktree
  créé depuis `main` **est** à jour, il n'y a rien à rebaser derrière.
- La branche affichée doit être `<branche_cible>`, jamais `main` : sinon **stopper**,
  et retirer le worktree (`git -C "<racine_cible>" worktree remove "<chemin_worktree>"`)
  avant de rendre la main.
- Le contrôle « chemin libre » de l'Étape 4.5 date d'avant la confirmation de
  l'utilisateur : une session voisine a pu prendre le chemin entre-temps. Pas besoin
  de le refaire — `worktree add` échoue de lui-même sur un chemin **ou une branche**
  déjà pris. **Ne force pas** ce refus et ne dérive pas un chemin de rechange :
  stoppe et signale.

---

### Variante cross-repo (ticket d'un autre repo)

```
[utilisateur] /sdd-run-ticket SKILL-09
[skill]      → introuvable dans le repo de la session (Étape 1)
             → trouvé dans $HOME/.claude (Étape 1.1) — bascule en cross-repo
             Lancement de SKILL-09 en SDD :
             Repo      : /c/Users/moi/.claude   ⚠️ CROSS-REPO
             Spec      : specs/skill-09.md (relatif au repo ci-dessus)
             Isolation : cross-repo — worktree monté par moi dans
                         /c/Users/moi/claude-config-wt/skill-09, agent SANS isolation
             Procéder ? (oui / non)
[utilisateur] oui
[skill]      ✓ worktree monté sur la branche claude/skill-09 (depuis main du repo cible)
             ✓ hook start posé sur le checkout main du repo CIBLE
             ✓ agent lancé sans isolation, prompt d'appel APPEL:impl-cross (pointe
               vers prompts/impl-cross.md — rien n'est amendé, rien n'est recopié)
             ...
[skill]      ✓ SKILL-09 livré. Repo : /c/Users/moi/.claude
             (worktree conservé — à retirer quand tu n'en as plus besoin)
```

---

## Substitutions déjà résolues à l'entrée de ce fichier

Une valeur utilisée par les commandes ci-dessus sans y être résolue : elle l'est
plus tôt dans le cycle et arrive ici telle quelle, jamais redéduite. Déclarée ici
pour que ce fichier se lise seul.

**Substitutions** : `<racine_cible>` — la racine du repo **qui possède le
ticket**, champ `targetRoot` du JSON de l'Étape 1 (chemin absolu). Toute commande
`git` de ce fichier la vise, jamais le repo de la session.
