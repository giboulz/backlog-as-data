# /backlog — Muter le backlog-as-data en conversation (INFRA-08 / INFRA-11 / INFRA-14)

Wrapper d'instructions **mince** sur l'**outil backlog global** (INFRA-14) :
`node "$TOOL" <cmd>` où `$TOOL = ~/.claude/tools/backlog/backlog.mjs` (bundle
autonome, opère sur le projet courant). Toutes les mutations passent par le CLI →
**déterministes**, jamais d'édition de `.md`/JSON à la main. La moitié-arrière du
cycle (`wip → merged → shipped`) est posée **automatiquement** par la sous-commande
`hook` (cf. `/send`, `/deploy`, `/sdd-run-ticket`) ; ce skill couvre la
**moitié-avant** conversationnelle.

> **Résolution de `$TOOL`** (en tête de chaque commande bash de ce skill) :
> ```bash
> TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
> ```
> Le bundle opère sur `process.cwd()` et **no-op de lui-même** dans un projet sans
> `backlog.json`/`specs/` (exit 0, message). **Aucun `npm run backlog` requis** : un
> projet n'a besoin que de ses `specs/*.md` + `backlog.json` en git. whereismycard
> garde `npm run backlog` (TS local) en équivalent.

---

## Argument

Texte libre décrivant la mutation voulue. Mapper vers **une** commande CLI.

---

## Étape 0 — Résoudre l'outil global

**Substitutions utilisées dans ce skill** : `<repo>` — le chemin local du
checkout `whereismycard` (source du bundle, convention déjà utilisée par
`tools/backlog/README.md` et le propre message `self-update` du CLI).

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
[ -f "$TOOL" ] || echo "✗ outil backlog absent — installe-le (INFRA-14 : node <repo>/dist-backlog/backlog.mjs self-update)"
```

- Si `$TOOL` absent : **stopper**, afficher le message d'install ci-dessus.
- Sinon : le bundle gère lui-même le cas « projet sans backlog » (no-op signalé).

---

## Étape 1 — Mapper l'intention vers le CLI

| Intention | Commande |
|---|---|
| Créer un ticket | `node "$TOOL" new <ID> [--title <t>] [--epic <e>] [--priority <must\|should\|could>]` |
| Maturer (→ `todo`) | `node "$TOOL" mature <ID> --model <fable\|opus\|sonnet> --effort <low\|medium\|high\|xhigh\|max> --review <none\|light\|deep> --date <YYYY-MM-DD>` |
| Parquer | `node "$TOOL" set <ID> status=parked` |
| Abandonner | `node "$TOOL" set <ID> status=wont` |
| Changer le statut | `node "$TOOL" set <ID> status=<status>` |
| Régénérer `backlog.json` | `node "$TOOL" snapshot` |
| Voir l'état (terminal) | `node "$TOOL" list` |
| Amorcer un nouveau projet | `node "$TOOL" init` |

Statuts valides : `parked maturing todo wip merged shipped wont`.

**Règles importantes :**

- **Date jamais inventée par le CLI.** Pour `mature`, passer explicitement la date
  du jour (tu la connais via le contexte `currentDate`) en `--date YYYY-MM-DD`.
- **Valeur qui commence par `/` — préfixer `MSYS_NO_PATHCONV=1`.** Sous Git Bash /
  MSYS2 (Windows), un argument commençant par une barre est converti en chemin
  Windows AVANT d'atteindre le CLI : `--title "/reflect mode global"` arrive comme
  `C:/Program Files/Git/reflect mode global`. Succès silencieux, exit 0, titre
  faux — et **irréparable**, l'outil n'ayant pas de verbe pour corriger un titre
  (BLG-05, non livré). Écrire :
  `MSYS_NO_PATHCONV=1 node "$TOOL" new SKILL-NN --title "/reflect mode global"`.
  Même famille que la règle du tiret (`--flag=valeur`), mais celle-ci ne produit
  aucune erreur : c'est pourquoi elle s'écrit.
- **`--review` est requis à la maturation** (INFRA-32), au même titre que `--model`
  et `--effort` : maturer, c'est décider du **triplet** model/effort/review. Il fixe
  le dosage de la gate de revue de `/sdd-run-ticket` — `none` (aucune revue),
  `light` (1 relecteur vierge), `deep` (3 relecteurs vierges en parallèle, chacun
  sur les 4 axes). Si l'utilisateur ne le précise pas, **le lui demander** plutôt
  que de choisir à sa place : c'est une décision de maturation, pas un détail
  d'exécution.
- **Quand choisir `deep`.** `light` est le défaut. `deep` s'achète quand **rater un
  défaut coûte cher** : un relecteur unique a une **variance élevée**, et on paie
  trois échantillons pour la réduire. Critère décisif — *si ce défaut passait,
  serait-il détecté ensuite ?* Un défaut qu'aucun test ne rattraperait, ou qui
  deviendrait publiquement visible, justifie `deep`. Un défaut qui pétera au
  prochain usage ne le justifie pas.
  Ne justifient **pas** `deep` : la taille du ticket, la longueur de la spec, le
  nombre de fichiers touchés.
- **Choix du modèle (`--model`).** Échelle écrite dans `rules/maturation.md` (dépôt
  de config globale — même `homedir()` que `$TOOL` ci-dessus, dossier `rules`),
  section « Choix du modèle à la maturation » (table à 3 cas) — mêmes principes que
  le dosage de revue : tu lis les signaux, tu proposes, l'utilisateur override. La
  cohérence `effort ⇒ model` est tenue par l'outil lui-même (`mature` la refuse,
  `--override-coherence` fait le geste).
- **Écartée : l'idée d'un `--review-why` obligatoire.** Ne pas la re-proposer.
  Demander à un modèle de justifier son choix produit une **rationalisation a
  posteriori**, pas une délibération. Preuve empirique : sur un ticket réel, l'agent
  de maturation a choisi `deep` et **avait raison**, tandis qu'un second avis
  argumenté a dit `light` et **avait tort** — une justification écrite n'aurait
  distingué aucun des deux.
- **Invariant `exec`.** `exec` est requis ssi le statut ∈ `{todo,wip,merged,shipped}`.
  `set` vers un statut non-maturé (`parked`/`wont`/`maturing`) **retire `exec`
  automatiquement** (dématuration) ; `set` vers `todo`+ sans `exec` est **refusé**
  (maturer d'abord).
- **`priority` n'est PAS mutable via `set`** (le CLI ne mute que `status`). La
  priorité se fixe à la création (`new --priority`). La changer ensuite nécessite
  une extension CLI (hors scope INFRA-11) — le signaler plutôt que d'éditer le
  `.md` à la main.
- **Moitié-arrière = automatique.** Ne pose pas `wip`/`merged`/`shipped` à la main
  sauf correction explicite : ces transitions sont du ressort du hook
  (`/sdd-run-ticket` → `wip`, `/send` → `merged`, `/deploy` → `shipped`).

---

## Étape 2 — Exécuter et rendre compte

Lancer la commande, afficher son `stdout`/`stderr`. En cas d'exit non-zéro,
afficher l'erreur du CLI telle quelle (messages déjà clairs) et **ne pas**
contourner en éditant les fichiers à la main.

Le CLI régénère `backlog.json` à chaque mutation → cohérence garantie (test H3).
Après la mutation, rappeler que le commit du `.md` + `backlog.json` reste à faire
(via le cycle SDD normal) si la mutation doit atteindre main/prod.

---

## Exemples

```
[utilisateur] /backlog crée RISQUE-04 dans l'épic cockpit, priorité should
[skill]       node "$TOOL" new RISQUE-04 --epic cockpit --priority should
              ✓ créé specs/risque-04.md (maturing)

[utilisateur] /backlog mature RISQUE-04 en opus high
[skill]       Quel dosage de revue ? none / light / deep
[utilisateur] light
[skill]       node "$TOOL" mature RISQUE-04 --model opus --effort high --review light --date 2026-06-09
              ✓ maturé RISQUE-04 → todo

[utilisateur] /backlog parque RISQUE-04
[skill]       node "$TOOL" set RISQUE-04 status=parked
              ✓ RISQUE-04 → parked (exec retiré : dématuration)
```
