# Instructions globales — tous les projets

## Comportement — séquences d'instructions convenues

Quand l'utilisateur donne une **suite d'instructions**, elle doit être respectée
**exactement comme convenu**.

- **Challenger, oui — mais EN AMONT.** Le moment de discuter, objecter ou proposer une
  alternative, c'est **avant** d'accepter la séquence. Une fois qu'on est d'accord sur
  la suite d'actions, on l'exécute **précisément**, sans dévier ni ajouter d'étapes
  non demandées.
- **Une étape « attendre » veut dire attendre.** Ne pas la court-circuiter pour
  « faire avancer » ou « prouver » quelque chose.
- **Ne pas fabriquer d'urgence.** Une inquiétude, une question ou un doute exprimé par
  l'utilisateur n'est **pas** un ordre d'agir vite. Rien n'est urgent tant qu'il ne
  l'a pas dit. La bonne réponse à une inquiétude, c'est **des mots** — pas une action
  qui prend la main sur ce qu'il s'était réservé de décider.

## Workflow obligatoire (SDD)

1. **Spec** — écrire / mettre à jour le fichier de spec concerné
2. **Tests** — écrire ou mettre à jour les tests (ils doivent rater)
3. **Implémentation** — coder jusqu'à ce que les tests passent
4. **Vérification** — lancer le build ou la suite de tests complète

Ne jamais sauter une étape. Ne jamais écrire du code sans spec d'abord.

### Maturation — la méthode vit dans une règle, pas ici

Le geste de **maturer** un ticket (rédiger § Portée, § Tests, § Vérification —
l'étape 1 ci-dessus) obéit à `rules/maturation.md`, dans le dépôt de config
globale : elle porte **tout** ce qu'exige ce geste, et rien d'autre — les
contrôles ci-dessous n'en sont qu'une part. Le **texte** de la méthode n'a
qu'un domicile — `rules/maturation.md` ; les **titres** ci-dessous en sont un
rappel, projeté ici et vérifié identique par un test.

1. Grep le nom, pas seulement ses porteurs connus.
2. Dérouler l'effet de bord du geste prescrit.
3. Énumérer les branches et les régimes du mécanisme touché.
4. Relire ses propres clauses les unes contre les autres.
5. Ouvrir le dépôt que la spec vise.
6. Ne jamais figer une valeur allouée en premier-arrivé.
7. Une clause qui énonce un fait constatable — état du dépôt ou
   comportement d'une dépendance tierce — cite le moyen de le constater.

⛔ **Cette règle ne s'auto-charge pas toujours ; ne le présume jamais.** Elle
s'injecte à la lecture d'un fichier qui matche `specs/**/*.md` **relativement au
répertoire d'où la session a été lancée**. Donc pas pour la spec d'un **autre
dépôt** (le chemin relatif remonte en `..`, que le client rejette — or c'est le
cas nominal de la maturation cross-repo) ; pas pour un projet qui range ses
specs ailleurs (`spec/`, `docs/spec/`…) ; pas depuis une session lancée
au-dessus du projet. **Si tu ne la vois pas dans ton contexte, ouvre-la
toi-même** avant de maturer — son chemin se résout par :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','rules','maturation.md'))"
```

## Backlog

Sur un projet **doté** d'un `backlog.json` et d'un dossier `specs/` (adoption par
la commande `init` du CLI global), le backlog est **de la donnée git**, pas un
document qu'on rédige :

- **Source de vérité** : le frontmatter des fichiers `specs/*.md` (`type: ticket`),
  un fichier par ticket.
- **Artefacts générés** : `backlog.json` et `specs/backlog.md` — cette vue porte un
  sentinel « NE PAS ÉDITER À LA MAIN » en tête. Ne jamais les éditer : le prochain
  `snapshot` écrase silencieusement toute retouche.
- **Muter exclusivement par l'outil** — le CLI global, installé en
  `~/.claude/tools/backlog/backlog.mjs`, verbes `new|mature|set|snapshot`.
  L'invoquer par le skill `/backlog`, par `npm run backlog -- …` là où le projet
  expose ce script, ou en direct depuis le dossier du projet. ⚠️ Sous PowerShell,
  `~` n'est **pas** expansé dans les arguments d'un exécutable : `node ~/.claude/…`
  échoue en `MODULE_NOT_FOUND`. Faire `cd ~/.claude` d'abord, ou passer le chemin
  absolu du home. `help` rappelle les commandes.

Le statut d'un ticket est un **champ**, jamais un emplacement dans un fichier :
« déplacer un item en Done » n'existe pas.

Deux axes orthogonaux, à ne pas confondre :

- **Engagement** — `priority: must|should|could` (MoSCoW : on a choisi de le faire) ·
  `status: parked` (on se pose encore la question) · `status: wont` (on a décidé de
  ne pas le faire).
- **Cycle** — `maturing → todo → wip → merged → shipped`. `new` crée en `maturing` ;
  `mature` pose le triplet model/effort/review et fait passer en `todo`. La moitié
  arrière (`wip`, `merged`, `shipped`) est posée par les hooks de
  `/sdd-run-ticket`, `/send` et `/deploy` — ne pas la poser à la main **par
  routine**. Correction explicite exceptée : les hooks se chaînent
  (`merge` ne promeut que ce qui est déjà `wip`), donc un ticket codé **sans**
  `/sdd-run-ticket` reste bloqué en `todo` et son `set <ID> status=…` manuel est
  légitime pour le remettre sur les rails.

Attention : « pas encore maturé » ≠ « parked ». Un ticket qu'on **sait** vouloir
faire mais qui n'a pas son triplet → `status: maturing` + une `priority`.

Sur un projet **sans** backlog-as-data, ne rien prescrire de ce qui précède : s'en
tenir au fichier de priorisation que ce projet utilise déjà (son `CLAUDE.md` local
le dit), et ne pas y amorcer l'outillage backlog (`init`, `backlog.json`) sans que
l'utilisateur ait demandé l'adoption. Cela ne dispense **pas** de l'étape 1 du SDD :
la spec s'écrit là où ce projet range ses specs.

## Identifiants de tickets

Chaque fonctionnalité ou correctif reçoit un identifiant court : `SCOPE-NN`.

- `SCOPE` = préfixe du module en majuscules (ex : `AUTH`, `RISQUE`, `COCKPIT`, `INFRA`)
- `NN` = numéro séquentiel dans le scope (01, 02, 03…)

Utiliser cet identifiant :
- dans le message de commit : `feat(RISQUE-11): description`
- dans le nom de branche si applicable : `claude/risque-11-description`
- dans le backlog pour tracer le lien entre ticket et implémentation

Quand un nouveau travail commence, attribuer le prochain numéro disponible dans le scope concerné.

### Où ouvrir le ticket — le critère est **où vit l'artefact**

Pas qui l'écrit, ni qui s'en sert : le repo propriétaire est celui où le livrable
est versionné.

| Artefact livré | Repo propriétaire | Scope |
|---|---|---|
| Code, specs et config d'un projet | le repo de ce projet | scope du module (`AUTH`, `INFRA`…) |
| Skills globaux (`~/.claude/commands/*.md`), ce `CLAUDE.md` global, config de `~/.claude` | `claude-config` (= `~/.claude`) | `SKILL-NN` |

Conséquence : un ticket dont le livrable est un skill global s'ouvre **dans
`~/.claude`**, quel que soit le repo depuis lequel on travaille :

```
cd ~/.claude
node tools/backlog/backlog.mjs new SKILL-NN --title "…" --priority should
```

Ouvrir un tel ticket dans le repo du projet courant produit un **ticket sans
domicile** : aucun commit `feat(SKILL-NN)` n'atterrira jamais sur le main de ce
repo, les hooks ne le promouvront donc jamais, et sa spec vivra loin de son
artefact.

## Changelog (pas dans le SDD)

Le changelog n'est **pas** mis à jour automatiquement en fin de cycle SDD. C'est l'utilisateur qui décide quand bumper la version.

Rôle de Claude :
- Accumuler les évolutions livrées depuis la dernière mise à jour (le ticket + le commit suffisent comme trace).
- Quand l'utilisateur demande explicitement « mets à jour le changelog » ou « sors une version » → compiler toutes les évolutions depuis la dernière entrée `version` présente dans `changelog.ts`, bumper la version, et seulement à ce moment-là toucher le fichier.
- Sinon : ne pas toucher à `changelog.ts` ni à `CURRENT_VERSION`.

Exception : corriger une entrée existante (faute, formulation publique inadaptée) est éditorial, pas un bump de version — c'est autorisé sans demande explicite.

## Mémoire — palier « candidat » et routage projet/global

La mémoire durable a **4 types de faits distillés** (`user` / `feedback` / `project`
/ `reference`), un fichier chacun, indexés dans `MEMORY.md`. On n'y touche pas :
ce sont des règles déjà mûres.

**5ᵉ type — `candidate`** (`metadata.type: candidate`) : une observation de friction
**brute**, capturée en fin de chunk de travail, pas encore une règle. Corps = une
ligne « ce qui a lutté / ce que l'utilisateur a corrigé / ce que la gate a rattrapé »
+ un tag de portée. Éphémère : `/reflect` (SKILL-18) mine les candidats
périodiquement — **promeut** le récurrent (≥2) en `feedback`/`project`, **jette** le
bruit n=1. Un candidat vit jusqu'à la prochaine passe de mine.

**Routage à la capture — taguer chaque candidat `project` ou `global`** :

- `project` → mémoire du **projet courant** (`~/.claude/projects/<projet>/memory/`).
  Friction sur le code ou les specs de CE projet.
- `global` → **pool unique**, à un **chemin absolu** indépendant de la session :
  `$HOME/.claude/memory/candidates/`. Friction sur *la façon de bosser partout* (un
  skill global, un workflow, une convention) : les candidats globaux s'accumulent au
  même endroit, donc le seuil ≥2 peut se déclencher (le scan cross-projet est
  SKILL-20, v2).

Heuristique de classement : « cette friction parle-t-elle du code/des specs de CE
projet, ou de la façon de bosser ? ». `/reflect` peut **re-router** après coup un
candidat « projet » qui se répète ailleurs.

## Règles de test (non-négociables)

### lib/ et db/repo/ — test obligatoire dans le même commit
Tout nouveau fichier dans `lib/` ou `db/repo/` doit avoir un fichier
`__tests__/**/*.test.ts` correspondant livré dans le **même commit**.

Une spec qui ne liste pas l'orchestrateur dans sa section Tests est une omission
de spec, pas une exception valide : elle doit **lister explicitement** les cas de
test pour chaque fonction exportée, y compris les orchestrateurs, helpers et
scripts CLI.

### Routes API — test unitaire obligatoire
Chaque `app/api/**/route.ts` doit avoir au minimum un test couvrant :
- le happy path (200/201)
- l'auth manquante (401)
- un cas d'erreur métier (400/404/422)

Les tests E2E Playwright ne remplacent **pas** les tests unitaires de route.

### Fichier > 800 lignes à découper avant d'y ajouter
Tout fichier `db/repo/*.ts`, `lib/**/*.ts` ou `components/**/*.tsx` qui
dépasse **800 lignes** doit être découpé **avant** d'y ajouter de nouvelles
fonctions.

Raison : seuil ergonomique pour l'agent. L'agent lit jusqu'à ~2000 lignes
en un appel, mais navigue mal au-delà de 800 (offset/limit ciblés, repères
perdus). Ne pas splitter prématurément un fichier cohérent sous 800 — le
coût (commit, redistribution des tests, refonte des imports) dépasse le
bénéfice.

### Environnement de test — `node_modules`, vérifier avant de présumer

Un worktree ne résout pas toujours le `node_modules` de main : hors de
l'arborescence du projet, et avec `node_modules/` gitignoré, `npm test` y échoue
tant qu'un `npm install` n'a pas tourné dans CE worktree. Ni présumer résolu, ni
installer à l'aveugle — **constater** :

```bash
node -e "console.log(require.resolve('vitest/package.json'))"
```

**Ce dépôt-ci (`claude-config`, `~/.claude`) en relève**, et c'est la
confirmation que `prompts/impl-same.md` exige avant d'installer : ses worktrees
vivent en `<home>/claude-config-wt/<nom>`, hors de son arborescence, et
`node_modules/` y est gitignoré → `npm install` dans le worktree y est un
**préalable explicite** à `npm test`, pas un no-op.

Le mode d'emploi opératoire (quoi faire de chaque issue) vit dans
`prompts/impl-same.md` et `prompts/impl-cross.md`, § « Étape 0.5 — Environnement
(node_modules) », depuis SKILL-25 — pas ici.

## Migrations Drizzle (tout projet utilisant Drizzle)

Règles non-négociables, tout projet avec un `drizzle.config.ts` :

1. **Jamais de `db/migrations/*.sql` écrit à la main sans son entrée dans
   `db/migrations/meta/_journal.json`.** Sans elle, `drizzle-kit migrate` ignore
   le fichier en silence : le schéma n'est jamais appliqué, et rien ne le dit
   avant le premier `SELECT` sur la colonne manquante.
2. **`db:generate` n'est sûr QUE si l'historique de snapshots
   (`meta/*_snapshot.json`) est maintenu en continu** — il crée alors `.sql`,
   entrée de journal et snapshot atomiquement. Dès qu'un repo a divergé (des
   `.sql` écrits à la main), il diffe contre le dernier snapshot intact et part
   en prompt de rename interactif qui **gèle en non-interactif** : là,
   migrations à la main + entrée de journal, `db:generate` proscrit. Vérifier
   que le dernier `_snapshot.json` correspond au dernier `.sql` avant de le
   lancer ; en cas de doute, écrire à la main. Chaque projet déclare son mode
   dans son `CLAUDE.md`.
3. `/deploy` détecte `drizzle.config.ts` et lance `npx drizzle-kit check`
   (étape 0.6) : check en échec → push bloqué.
