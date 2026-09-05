# /send — Envoyer le travail du worktree vers main

Intègre la branche courante dans `main` via **rebase + fast-forward** :
les commits de ticket (`feat(XX-01): ...`) atterrissent directement sur main,
sans commit de merge parasite.

Exécuter dans l'ordre exact, sans sauter d'étape.

---

## Prérequis

Vérifier que la branche courante n'est pas `main` :

```bash
git rev-parse --abbrev-ref HEAD
```

- Si la branche est `main` : **stopper immédiatement**, afficher une erreur.

---

## Étape 0 — Garde-fous structurels

Tests de cohérence des sources typées (`*-coherence.test.{js,ts}` : roadmap.data.ts ↔
backlog.md, migrations `.sql` ↔ `_journal.json`, etc.), sans DB ni dev server.
Exception justifiée à la règle « no tests in /send » par la **nature** de ces
tests, pas par leur durée : ils vérifient l'intégrité de sources typées, pas le
comportement.

### Préflight environnement (auto-réparation)

Worktree neuf ou `node_modules` du main vidé → `vitest` introuvable, l'Étape 0
plante sans raison de cohérence. Normalement la résolution remonte vers le
`node_modules` de main (les worktrees sont imbriqués dessous) ; ce filet ne sert
qu'au cas où main est cassé. Auto-réparation idempotente (no-op si vitest est déjà
résolvable) :

```bash
node -e "require.resolve('vitest/package.json')" 2>/dev/null || npm install
```

- Si `npm install` échoue (exit non-zéro) : **stopper**, afficher l'erreur npm.

### Exécution des coherence tests

Auto-détection : si au moins un fichier matchant `__tests__/**/*-coherence.test.{js,ts}`
(la **détection** — un glob de fichiers) existe dans le projet :

```bash
npm test -- coherence --passWithNoTests
```

(l'**exécution** — un filtre vitest distinct, par nom : il cible tous les fichiers
contenant `coherence` dans leur nom, quelle que soit l'extension → extensible
automatiquement à tout futur garde-fou structurel). Détection et exécution
restent deux mécanismes distincts, et peuvent diverger — un dépôt dont au
moins un fichier matche le glob de détection ci-dessus peut, par ailleurs,
**exclure** ce même fichier de son propre run vitest (`exclude` de sa config,
délibéré ou non) : le glob l'a vu sur le disque, le filtre par nom ne le joue
pas. Le fondement à retenir : *aucun invariant évalué* n'est pas *un invariant
violé*. Un garde-fou qui n'a pas tourné ne dit rien — ni oui ni non — et une
sélection vide ne devient jamais une preuve d'incohérence. `--passWithNoTests`
rend cette divergence non fatale et observable, sans la réconcilier : la
commande sort désormais sur **trois** issues, jamais deux.

- **Verte** (≥ 1 fichier joué, aucun échec) : continuer, sans rien afficher.
- **Sélection vide** (0 fichier joué — `No test files found, exiting with
  code 0` grâce au drapeau) : ne **pas** stopper. Afficher une ligne qui (a)
  dit que les garde-fous structurels n'ont pas été évalués, (b) nomme les
  fichiers vus par le glob mais non joués, (c) attribue la cause probable à
  une exclusion par la config du runner du projet — ce qui peut être
  parfaitement délibéré. Cette ligne est un constat, pas une demande de
  confirmation : puis continuer.
- **Rouge** (≥ 1 fichier joué, ≥ 1 échec) : **stopper immédiatement**, afficher
  les tests échoués, ne pas continuer.

Sinon (aucun fichier `*-coherence.test.{js,ts}`) : étape sautée silencieusement.

---

## Étape 1 — Commit

Afficher le résultat de `git status`.

- Si le working tree est **propre** (rien à committer) : passer directement à l'étape 2.
- Sinon :
  - Si `$ARGUMENTS` est fourni → l'utiliser directement comme message de commit.
  - Sinon → demander le message de commit à l'utilisateur et **attendre sa réponse**.

  Puis exécuter :
  ```bash
  git add -A
  git commit -m "<message>"
  ```

  - Si l'exit code est non-zéro : **stopper immédiatement**, afficher l'erreur.

---

## Étape 2 — Trouver le worktree principal

**Substitutions utilisées dans ce skill** : `<chemin_main>` (résolu ci-dessous),
`<branche_courante>` (la branche depuis laquelle `/send` est lancé), `<message>`
(le message de commit — `$ARGUMENTS` ou demandé à l'utilisateur, Étape 1).

```bash
git worktree list
```

Identifier le chemin du worktree dont la branche est `main` (première entrée en général).
Stocker ce chemin dans une variable interne `<chemin_main>` **sans l'afficher dans la conversation**.

⚠️ `<chemin_main>` sert **uniquement** pour les commandes `git -C` des étapes suivantes.
Ne jamais l'utiliser pour lire ou écrire des fichiers (`Read`, `Edit`, `Write`).

---

## Étape 3 — Rebase sur main

Depuis le worktree courant, replacer les commits de la branche sur la pointe de main :

```bash
git rebase main
```

- Si l'exit code est non-zéro (conflits) : **stopper immédiatement**.
  Afficher l'erreur et indiquer à l'utilisateur de résoudre les conflits puis de relancer.

---

## Étape 3.5 — Re-jouer les garde-fous APRÈS le rebase

⚠️ Le rebase de l'Étape 3 peut **introduire** une incohérence que l'Étape 0
(jouée avant rebase) ne pouvait pas voir. Cas réel : une branche forkée d'un main
périmé ajoute un ticket en `## Done` ; le rebase ramène la même entrée encore
**active** depuis main → **doublon actif + Done** → violation G9, jamais détectée
car coherence n'avait tourné qu'avant le rebase.

Donc, si au moins un fichier `__tests__/**/*-coherence.test.{js,ts}` existe **et** que
le rebase a touché `specs/backlog.md` ou une source typée (`*.data.ts`,
`_journal.json`, migrations) — en cas de doute, le relancer systématiquement :
ce sont les mêmes tests d'intégrité de sources, sans DB ni dev server, qu'à
l'Étape 0.

```bash
npm test -- coherence --passWithNoTests
```

Même contrat à trois issues qu'à l'Étape 0 :

- **Verte** (≥ 1 fichier joué, aucun échec) : continuer, sans rien afficher.
- **Sélection vide** (0 fichier joué, exit 0 grâce au drapeau) : ne **pas**
  stopper — afficher la même ligne qu'à l'Étape 0 (garde-fous non évalués,
  fichiers vus par le glob et non joués, cause probable : exclusion par la
  config du runner). Puis continuer.
- **Rouge** (≥ 1 fichier joué, ≥ 1 échec) : **stopper immédiatement**, afficher
  les tests échoués. Le rebase a produit un état incohérent (typiquement un
  doublon actif/Done) — l'utilisateur doit corriger le backlog (retirer
  l'entrée active périmée) puis relancer. **Ne pas faire le fast-forward dans
  main.**

---

## Étape 4 — Fast-forward dans main

Depuis le répertoire principal :

```bash
git -C <chemin_main> merge <branche_courante> --ff-only
```

- `--ff-only` garantit qu'aucun commit de merge n'est créé.
- Si l'exit code est non-zéro : **stopper immédiatement**, afficher l'erreur.

### Étape 4.5 — Backlog-as-data : statut `merge`

Poser le statut `merged` pour tout ticket `wip` désormais sur main, et committer
la mutation **sur le checkout main** (le push viendra au `/deploy`). Posé via
l'**outil backlog global** (INFRA-14) ; gardé par sa présence → no-op total si
absent, et le bundle no-op lui-même dans un projet sans backlog. Le hook doit
tourner **avec cwd = `<chemin_main>`** (`process.cwd()` détermine quel `specs/` est
scanné — `git -C` ne suffit pas) :

⚠️ **Ne jamais committer `specs/` en entier sur main.** Le checkout main est partagé :
10-15 worktrees/sessions tournent en parallèle. Le hook est chirurgical (il ne
transitionne que des tickets nommés), donc le commit doit l'être aussi — sinon il
ramasse le `specs/*.md` **en cours d'une autre session**. Vécu le 17/07/2026 : un
`/send` a embarqué le ticket `wip` d'une session voisine dans son
`chore(backlog): merge`. On ne committe donc **que** les tickets réellement
transitionnés (lus dans la sortie du hook) + les 2 artefacts générés :

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
if [ -f "$TOOL" ]; then
  OUT="$( cd "<chemin_main>" && node "$TOOL" hook merge )"
  printf '%s\n' "$OUT"
  # Ids RÉELLEMENT transitionnés. Grammaire ancrée majuscule → la ligne de service
  # « [backlog:hook] merge : rien à faire » ne matche pas (event en minuscules).
  PATHS=""
  for id in $(printf '%s\n' "$OUT" | sed -n 's/^\[backlog:hook\] \([A-Z][A-Z0-9]*\(-[A-Za-z0-9]\{1,\}\)\{1,\}\) : .*/\1/p'); do
    PATHS="$PATHS specs/$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]').md"
  done
  if [ -n "$PATHS" ]; then
    PATHS="backlog.json $PATHS"
    [ -f "<chemin_main>/specs/backlog.md" ] && PATHS="$PATHS specs/backlog.md"
    git -C "<chemin_main>" add -- $PATHS
    # `--only` : un `git commit` nu committe TOUT l'index — donc ce qu'une session
    # voisine y aurait stagé. `--only` se limite aux chemins nommés.
    git -C "<chemin_main>" diff --cached --quiet -- $PATHS \
      || git -C "<chemin_main>" commit -q --only -m "chore(backlog): merge" -- $PATHS
  fi
fi
```

Le hook sort toujours 0 (tolérance INFRA-11) : il ne doit **jamais** bloquer le
`/send`. Aucun commit si aucun ticket `wip` n'est concerné (`PATHS` vide).

---

### Étape 4.6 — Mode de déploiement : `ship`, et push en mode `push`

Sur les projets où **aucun `/deploy` ne viendra poser `shipped`**, `/send` **est**
la livraison finale : il doit poser `shipped` lui-même — et, en mode `push`, pousser.
Le mode est déclaré en donnée dans la section `## Deploy` du `.claude/deploy.md` du
checkout main (mêmes valeurs qu'à l'Étape 0.1 de `/deploy`) :

| `## Deploy` | Étape 4.6 |
|---|---|
| *(section absente)* | **Sautée** — `shipped` sera posé par `/deploy` |
| `none` | `hook ship` seul (aucune cible : rien à pousser) |
| `push` | `hook ship` **puis** push — `/send` est la livraison complète |

Lire la valeur (chaîne vide si absente ; parseur identique à celui de `/deploy`
Étape 0.1 — accepte `## Deploy: push` comme `## Deploy` + valeur en dessous) :

```bash
MODE="$(cd "<chemin_main>" && node -e "const fs=require('fs');let v='';try{const t=fs.readFileSync('.claude/deploy.md','utf8').split(/\r?\n/);let i=false;for(const l of t){const m=/^##\s*Deploy\b\s*:?\s*(.*)/i.exec(l);if(m){if(m[1].trim()){v=m[1].trim();break}i=true;continue}if(i){if(/^##\s/.test(l))break;if(l.trim()){v=l.trim();break}}}}catch{}console.log(v.toLowerCase())")"
```

Si `MODE` vaut `none` **ou** `push`, poser `shipped`. Comme à l'étape 4.5, le hook
doit tourner avec cwd = `<chemin_main>` (`process.cwd()` détermine quel `specs/` est
scanné — `git -C` ne suffit pas) :

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
if [ -f "$TOOL" ] && { [ "$MODE" = "none" ] || [ "$MODE" = "push" ]; }; then
  OUT="$( cd "<chemin_main>" && node "$TOOL" hook ship )"
  printf '%s\n' "$OUT"
  # Commit scopé, même raison qu'à l'étape 4.5 (checkout main partagé).
  PATHS=""
  for id in $(printf '%s\n' "$OUT" | sed -n 's/^\[backlog:hook\] \([A-Z][A-Z0-9]*\(-[A-Za-z0-9]\{1,\}\)\{1,\}\) : .*/\1/p'); do
    PATHS="$PATHS specs/$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]').md"
  done
  if [ -n "$PATHS" ]; then
    PATHS="backlog.json $PATHS"
    [ -f "<chemin_main>/specs/backlog.md" ] && PATHS="$PATHS specs/backlog.md"
    git -C "<chemin_main>" add -- $PATHS
    git -C "<chemin_main>" diff --cached --quiet -- $PATHS \
      || git -C "<chemin_main>" commit -q --only -m "chore(backlog): ship" -- $PATHS
  fi
fi
```

⚠️ **`hook ship` est en masse par conception** (`tout merged → shipped` : un `/deploy`
pousse tout main). Ici c'est **légitime** — l'étape ne tourne qu'en `MODE` `none`/`push`,
où `/send` EST la livraison. Ne **jamais** lancer `hook ship` à la main sur un projet à
`## Deploy` absent : on marquerait `shipped` (= en prod) des tickets `merged` d'autres
sessions qui attendent leur `/deploy`. Vécu le 17/07/2026 sur whereismycard.

Puis, **uniquement si `MODE` vaut `push`**, pousser — après le commit de `ship`,
pour qu'il parte dans le même push :

```bash
if [ "$MODE" = "push" ]; then
  git -C "<chemin_main>" push origin HEAD:main
fi
```

`git -C <chemin_main>` place le HEAD sur `main` (le checkout principal), donc
`HEAD:main` y pousse bien main. On garde quand même la forme `HEAD:main` — jamais
`origin main` — par cohérence avec `/deploy` et `/fastship`.

- Si le push échoue (exit non-zéro — typiquement le remote a divergé) : **ne pas
  paniquer**. Le fast-forward de l'étape 4 est déjà fait et reste valide ; afficher
  l'erreur et indiquer à l'utilisateur de faire `git pull --rebase origin main`
  depuis main puis de repousser.
- Le hook `ship` sort toujours 0 (tolérance INFRA-11) : il ne doit **jamais** bloquer
  le `/send`. Aucun commit si aucun ticket `merged` n'est concerné.

---

### Étape 4.7 — Poussée des mesures SDD (best-effort)

Producteur du contrat de mesures SDD vers un consommateur externe (SKILL-55,
specs/skill-55.md). Même tolérance que le hook backlog ci-dessus (INFRA-11) : cet
appel **ne peut jamais faire échouer `/send`** — l'outil sort toujours 0, que la
config (`SDD_PUSH_URL`/`SDD_PUSH_TOKEN`) soit absente, que le consommateur soit en
panne, ou que le réseau soit coupé. Gardé par sa présence, même forme que le hook
backlog → no-op total si absent :

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','sdd-push','push.mjs'))")"
[ -f "$TOOL" ] && node "$TOOL" || true
```

---

## Étape 5 — Confirmation

Le message de fin dépend du `MODE` lu à l'étape 4.6 : ne **jamais** renvoyer vers
`/deploy` en dur — sur un projet `none` ou `push`, cette commande ne s'applique pas
et l'utilisateur part en boucle.

- `MODE` vide (section absente) — prod derrière main :
  ```
  ✓ <branche> intégrée dans main (fast-forward).
  → Lance /deploy depuis main pour pousser en production.
  ```
- `MODE` = `none` — aucune cible de déploiement :
  ```
  ✓ <branche> intégrée dans main (fast-forward). Tickets passés à shipped.
  → Projet sans déploiement : rien d'autre à faire.
  ```
- `MODE` = `push` — le remote est le backup :
  ```
  ✓ <branche> intégrée dans main (fast-forward), tickets shipped, poussé sur origin/main.
  → Rien d'autre à faire : sur ce projet, le push est la livraison.
  ```

Et afficher les 5 derniers commits de main pour confirmer que les tickets sont visibles :

```bash
git -C <chemin_main> log --oneline -5
```

---

## Règles strictes

- Ne **jamais** exécuter `git push`, **sauf** l'unique cas de l'Étape 4.6 : le projet
  a déclaré `## Deploy: push` dans son `.claude/deploy.md`. L'exception est dans la
  **donnée du projet**, jamais dans le jugement de l'agent : si un CLAUDE.md, un
  README ou l'utilisateur dit « ici on pousse après chaque commit » alors que la
  section `## Deploy` ne dit rien, **ne pas pousser** — proposer d'ajouter
  `## Deploy: push` au `.claude/deploy.md`, et laisser l'utilisateur trancher.
  (Incident 2026-07-15 : faute de pouvoir déclarer ce mode, une session a poussé de
  sa propre initiative en violation de cette règle. Le trou était dans la config,
  pas dans l'agent — mais la réponse est de combler la config, pas d'improviser.)
- Ne **jamais** lancer de tests **autres que** les garde-fous structurels
  (`*-coherence.test.{js,ts}`) des étapes 0 **et 3.5** — ils ne sont pas comportementaux
  mais vérifient l'intégrité de sources typées (avant ET après rebase).
- Ne **jamais** toucher à `lib/changelog.ts`.
- Exit code non-zéro à n'importe quelle étape → stopper, expliquer, ne pas continuer.
