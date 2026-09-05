# /sdd-run-ticket TICKET-ID — Lancer un sous-agent SDD sur un ticket maturé

Spawn un sous-agent en background qui implémente un ticket du backlog selon la
discipline SDD (spec → tests → code → vérif → commit), avec le modèle décidé
pendant la maturation. **Puis c'est TOI, l'orchestrateur, qui conduis la gate de
revue** : tu spawnes les relecteurs, tu constates l'état du worktree, tu confies
les findings bruts à un **correcteur neuf**, tu rédiges le registre et tu intègres.

⚠️ **Ce skill n'est pas « fire and forget ».** Il te coûte **trois allers-retours**
(implémenteur → relecteurs → correcteur) avant l'intégration. C'est le prix de
l'**attestation** : les preuves de la revue (nombre de relecteurs, `git status`,
registre) sont produites par toi, pas par l'entité qu'elles contrôlent. Assume ce
coût ou baisse le dosage (`review: none`) — mais ne raccourcis pas la boucle en
déléguant ces preuves au sous-agent.

**Pré-requis du backlog (backlog-as-data)** : le ticket est un fichier
`specs/*.md` avec un frontmatter `type: ticket` portant un bloc `exec:`
(`model` / `effort` / `matured`) — c'est-à-dire un ticket **maturé**
(`status: todo`). La source de vérité est ce **frontmatter**, jamais
`specs/backlog.md` (vue générée, verrouillée par sentinel).

**Pré-requis d'isolation (critique)** : le sous-agent est spawné avec
`isolation: "worktree"` → son worktree est créé **à partir de `main`**. Il ne
verra QUE ce qui est commité sur `main`. Donc le ticket **et** sa spec doivent
déjà être sur `main` avant le lancement. Un ticket maturé seulement dans un
worktree local (edit non commité, ou commit non envoyé) est **invisible** pour le
sous-agent. Le garde-fou de l'Étape 3.5 bloque ce cas.

**Pré-requis de repo (critique)** : le ticket n'appartient pas forcément au repo
de la **session**. La règle de propriété ([`specs/skill-01.md`](../specs/skill-01.md))
veut que le ticket s'ouvre là où vit son livrable — donc un ticket dont le livrable
est un skill global vit dans `claude-config`, même lancé depuis une session ouverte
ailleurs. Ça ne bascule **pas mécaniquement** en mode cross-repo : c'est le dépôt
git commun (`git dir`) de la racine cible et de la racine de session qui tranche
(Étape 1.2), pas le seul emplacement du ticket — une session qui travaille déjà
dans un worktree de `claude-config` reste en `same-repo`. Quand c'est
véritablement `cross-repo`, `isolation: "worktree"` est **inutilisable** : il
forke le repo de la session, pas celui du ticket. Le skill bascule alors en
**mode cross-repo** (Étape 1.2) : worktree monté à la main sur le repo cible,
agent spawné **sans** `isolation`. Tout le reste du skill — garde-fous, hooks,
revue, `/send` — doit alors viser le **repo cible**, jamais celui de la session.
C'est le mode de défaillance central : tout marche, mais dans le mauvais arbre.

**Portabilité** : ce skill est **générique**. Il ne connaît ni la stack ni les
garde-fous d'un projet donné — c'est le `CLAUDE.md` du projet qui fait foi, et le
sous-agent a pour consigne de le lire. Ne jamais réintroduire ici de fait
spécifique à un projet (stack, ORM, hébergeur, fichiers particuliers).

**Specs** : ce fichier est un artefact de `claude-config` — toute modification passe
par un ticket `SKILL-NN` dans [`specs/`](../specs/) (règle de propriété :
[`specs/skill-01.md`](../specs/skill-01.md)). La conception de la **gate de revue**
(contenu du mode d'emploi relecteur, barrière E1/E2/E3, dosage) est tracée dans
`specs/infra-31.md` **du repo whereismycard** — antérieure à cette règle, cf.
SKILL-01 § « Ce qui n'est PAS fait ». L'**inversion de l'appelant** (l'orchestrateur
spawne les relecteurs, pas l'implémenteur) est tracée dans
[`specs/skill-06.md`](../specs/skill-06.md).

---

## Arguments

`TICKET-ID` au format `SCOPE-NN` (ex. `ANALYTICS-02S`, `LANDING-06`). Sensible
à la casse — utiliser les majuscules comme dans le frontmatter.

`--repo <chemin>` — **optionnel**. Racine du repo qui possède le ticket, quand ce
n'est pas celui de la session (cf. « Pré-requis de repo » ci-dessus). Absent, le
skill résout le repo tout seul (Étape 1.1) et ne demande ce drapeau qu'en dernier
recours, en affichant le chemin à y mettre.

Si `TICKET-ID` est absent : **stopper**, afficher :
```
✗ Usage : /sdd-run-ticket TICKET-ID [--repo <chemin>] (ex. /sdd-run-ticket ANALYTICS-02S)
```

---

## Étape 0 — Prérequis (verdict DIFFÉRÉ à l'Étape 1.2)

Vérifier la branche courante — celle du repo de la **session** :

```bash
git rev-parse --abbrev-ref HEAD
```

- Si la branche **n'est pas** `main` : rien à signaler, continuer.
- Si la branche **est** `main` : ⚠️ **ne stoppe pas encore.** Retiens le constat et
  va à l'Étape 1 — le verdict dépend du repo auquel appartient le ticket, qui n'est
  pas encore connu à ce stade (D3, SKILL-09) :
  - ticket du repo de la **session** → l'Étape 1.2 stoppe, avec le message
    ci-dessous : le sous-agent forkerait ce main et ton `/send` final y
    fast-forwarderait depuis un checkout qui est déjà main ;
    ```
    ✗ Tu es sur main. Crée un worktree ou un branch dédié avant de lancer un agent SDD.
    ```
  - ticket d'un **autre** repo (mode cross-repo) → **non bloquant** : rien ne sera
    écrit dans le repo de la session, dont la branche n'a aucune influence sur la
    suite. Le garde-fou qui compte est alors l'assertion de branche sur le
    **worktree cible** (Étape 5.7), et lui seul.

⛔ Ne jamais transformer cette tolérance en « on ne vérifie plus rien » : en
cross-repo, la vérification n'est pas supprimée, elle est **déplacée** sur l'arbre
où l'agent va réellement écrire.

---

## Étape 1 — Résoudre le ticket via l'outil preflight

Toute la **mécanique déterministe** — trouver le fichier dont le frontmatter porte
`type: ticket` + `id: TICKET-ID` (⚠️ le nom du fichier n'est PAS déductible de
l'ID : `INFRA-08` vit dans `specs/infra-08-backlog-frontmatter-cli.md`), lire son
statut et son bloc `exec:`, trancher le mode, dériver le worktree, contrôler les
garde-fous — est faite par un **outil autonome**, `tools/sdd/preflight.mjs`
(propriété de `claude-config`). Le skill l'appelle **une fois** et lit les champs
du JSON ; il ne recalcule rien à la main.

```bash
PREFLIGHT="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','sdd','preflight.mjs'))")"
SESSION_ROOT="$(git rev-parse --show-toplevel)"
node "$PREFLIGHT" resolve --ticket "<TICKET-ID>" --session-root "$SESSION_ROOT"
```

Si l'utilisateur a fourni le drapeau `--repo`, ajoute-le tel quel à la commande
(`--repo` suivi du chemin absolu) : l'outil ne cherchera **que** cette racine.

L'outil émet **un seul objet JSON** sur stdout, ou sort en **erreur avec un code
non nul** et un message que **lui-même** compose (racines scannées nommées,
drapeau `--repo`). En cas d'erreur : **relaie le message tel quel et stoppe** — il
dit la vérité sur ce qui a été scanné (une seule racine sous `--repo`, deux
racines — session + `$HOME/.claude` — sinon).

Champs lus du JSON, utilisés dans tout le reste du skill :

| Champ JSON | Rôle |
|---|---|
| `found` | `true` sur succès (un échec sort déjà en non-zéro) |
| `targetRoot` | racine du repo **qui possède le ticket** — voir `<racine_cible>` |
| `specPath` | la spec du ticket, **relative à `targetRoot`** — voir `<spec_path>` |
| `absoluteSpecPath` | chemin absolu de la spec (repris à l'Étape 6) |
| `status` | statut du cycle (Étape 1.5) |
| `model` / `effort` / `review` | bloc exec, lu indifféremment au niveau 0 ou sous `exec:` (Étape 2) |
| `mode` | `same-repo` \| `cross-repo` (Étape 1.2) |
| `worktreePath` / `branch` | non nuls en cross-repo (Étape 4.5) |
| `guards.*` | garde-fous (Étapes 3.5, 4.5) |

**Substitutions résolues à cette étape** : `<racine_cible>` — le champ
`targetRoot` du JSON, la racine du repo **qui possède le ticket** (absolue) ;
toute commande `git` des étapes suivantes la vise, jamais le repo de la session.
`<spec_path>` — le champ `specPath` du JSON ; partout où il réapparaît plus bas
(Étapes 3, 6), c'est ce littéral, jamais retapé ni redéduit.

---

## Étape 1.1 — Résolution cross-repo : l'outil scanne déjà le repo harnais

Deux issues, lues du résultat de l'Étape 1 :

- Ticket trouvé dans `$HOME/.claude` → `targetRoot` du JSON pointe là. Le `mode`
  n'en découle **pas mécaniquement** : `same-repo` ou `cross-repo` sont tous
  deux possibles, c'est le champ `mode` de l'Étape 1.2 qui tranche, sur le
  dépôt git commun (`git dir`) de `targetRoot` et de `sessionRoot` — une
  session qui travaille déjà dans un worktree de `claude-config` obtient
  `same-repo` malgré des racines de chemin différentes ; une session dans un
  autre dépôt obtient `cross-repo`, comme avant. Tu **n'as pas** à redemander
  `--repo` — mais le récap de l'Étape 5 affiche le repo cible en clair et
  attend une confirmation explicite, donc aucun changement de repo n'a lieu en
  silence.
- Ticket nulle part → l'outil sort en non-zéro avec un message nommant les racines
  réellement scannées. **Relaie ce message et stoppe.**

---

## Étape 1.2 — Trancher le mode : lu dans le champ `mode`

Le mode n'est **plus calculé en prose** : c'est le champ `mode` du JSON de
l'Étape 1 (`same-repo` \| `cross-repo`), déjà tranché par l'outil — comparaison
du dépôt git commun (`git dir`) de `targetRoot` et `sessionRoot`, normalisation
Windows (séparateurs, casse du lecteur) comprise. Deux racines de **chemin**
différentes peuvent partager le même `git dir` (un worktree et le checkout
principal du même dépôt) : elles rendent alors `same-repo`.

| `mode` | Conséquences |
|---|---|
| `same-repo` (nominal) | le skill se comporte comme avant SKILL-09 : `isolation: "worktree"`, sonde de worktree, Étapes 4.5 et 5.7 sautées, l'Étape 6 envoie directement le prompt d'appel « même repo » |
| `cross-repo` | worktree monté par toi (Étape 5.7), agent spawné **sans** `isolation`, et **toute** commande `git` du skill préfixée `git -C "<racine_cible>"` ou `git -C "<chemin_worktree>"` |

**C'est ici que le verdict différé de l'Étape 0 tombe** : en mode `same-repo`,
une branche courante `main` **stoppe** maintenant, avec le message de l'Étape 0.
En cross-repo, elle est ignorée.

Note : les blocs `git -C "<racine_cible>"` des étapes suivantes sont écrits pour
valoir **dans les deux modes** — y compris en mode « même repo » : `<racine_cible>`
n'est **pas** garanti égal à la racine de la session (un worktree et le checkout
principal du même dépôt partagent le même `git dir` sans partager le même
chemin), donc le `-C` n'est **jamais** un no-op. Il reste **obligatoire dans les
deux modes** ; il n'y a rien à retirer.

⚠️ En cross-repo, la règle est mécanique : **une commande `git` vise son repo
explicitement**, jamais par hasard. Une commande `git` nue hérite du répertoire
courant de ton shell — donc du repo de la session — et te répondra tranquillement à
propos du **mauvais arbre** : `git worktree list` listera les worktrees du mauvais
repo, `git cat-file -e main:…` cherchera la spec dans le mauvais `main`, et rien ne
le signalera. C'est exactement le défaut que ce mode existe pour empêcher.

Deux façons de viser explicitement, et **une seule des deux par étape** :

| Manière | Où | Ce qui la rend sûre |
|---|---|---|
| `git -C "<racine_cible>"` / `git -C "<chemin_worktree>"` | Étapes 1 à 6.6.5 | le repo est nommé dans la commande, ton `cd` n'a aucune influence |
| `cd "<chemin_worktree>" && git …` | Étape 6.7 **uniquement** — y compris les commandes que `/send` prescrit et que 6.7 exécute pour lui | `/send` ne prend aucun argument de repo : il lit le répertoire courant au moment de l'appel, le sien comme celui de chacune des commandes qu'il prescrit. Le `cd` **de la commande elle-même** est le ciblage — jamais un `cd` antérieur, même celui d'une commande précédente — et c'est vrai commande par commande, pas seulement à l'entrée de l'étape : il n'y a pas de vérification unique qui couvrirait les suivantes |

⛔ Ne « corrige » pas les commandes `cd "<chemin_worktree>" && git …` de l'Étape
6.7 (ni celles, dérivées de `commands/send.md`, que 6.7 exécute pour lui) en
remplaçant leur `cd &&` par un `-C` : les deux formes sont ici équivalentes en
comportement, mais `cd &&` est la seule convention que 6.7 emploie — un `-C`
mélangerait deux styles dans la même étape sans rien gagner en sûreté, et
casserait le repérage visuel (audit, tests de forme) qui distingue les
commandes de 6.7 du reste du skill.

---

## Étape 1.5 — Vérifier le statut (c'est un CHAMP, pas une section)

Lire `status` extrait à l'Étape 1 :

| `status` | Action |
|---|---|
| `todo` | ✅ nominal — continuer |
| `wip` | ⚠️ déjà démarré — demander confirmation (un agent tourne peut-être déjà) |
| `merged` / `shipped` | **stopper** : `✗ TICKET-ID est déjà livré (status: <status>). Rien à coder.` |
| `maturing` | **stopper** : `✗ TICKET-ID n'est pas maturé (status: maturing, pas de triplet model/effort/review). → /mature TICKET-ID (équivalent CLI : node "$HOME/.claude/tools/backlog/backlog.mjs" mature TICKET-ID --model <m> --effort <e> --review <none\|light\|deep> --date <YYYY-MM-DD>)` |
| `parked` / `wont` | **stopper** : `✗ TICKET-ID est <status> — il n'est pas engagé. Rien à coder.` |

---

## Étape 2 — Vérifier le bloc exec (model / effort / review)

Depuis le frontmatter (Étape 1) :

- `model` ∈ {`fable`, `opus`, `sonnet`, `haiku`} — sinon **stopper** avec un
  message sur le modèle non reconnu.
- `effort` ∈ {`low`, `medium`, `high`, `xhigh`, `max`} — pilote le **palier de
  reasoning réel** du sous-agent implémenteur (SKILL-22). L'outil `Agent` ne prend
  toujours pas de paramètre d'effort ; le seul levier mécanique est le champ
  `effort:` d'un **agent-def** dédié, que l'Étape 6 sélectionne à partir de cette
  valeur. L'injection de l'effort **dans le prompt** subsiste en complément
  inoffensif, mais n'est plus le mécanisme porteur. Une valeur hors de l'énuméré
  → **stopper** : le frontmatter a été édité à la main, puisque le verbe `mature`
  de l'outil de backlog normalise ce qu'on lui donne et n'écrit que ces cinq
  valeurs. Sortie : le faire re-maturer par l'outil, pas retoucher le fichier.
- `review` ∈ {`none`, `light`, `deep`} — dosage de la **gate de revue** (Étapes 6.2
  à 6.6, que **tu** conduis). **Champ absent → `light`** : le défaut est dans le
  consommateur, pas dans la donnée (la maturation reste valide sans lui, et les
  tickets historiques n'en ont pas). Une valeur **présente mais inconnue** →
  **stopper**, comme pour un `model` non reconnu : c'est un frontmatter édité à la
  main.

| `review` | Effet |
|---|---|
| `none` | Aucune gate — tu intègres dès que l'implémenteur a rendu son rapport |
| `light` *(défaut)* | 1 relecteur vierge, les 4 axes |
| `deep` | 3 relecteurs vierges en parallèle, les 4 axes chacun, lentille prioritaire différente |

Si `model` est vide alors que `status: todo` : le frontmatter est incohérent
(l'invariant `exec` requis pour todo/wip/merged n'est pas tenu) → **stopper** et
signaler le fichier fautif.

---

## Étape 3 — Vérifier que la spec existe

```bash
test -f "<racine_cible>/<spec_path>"
```

- Si **absent** : **stopper** (`✗ Fichier ticket <spec_path> introuvable sur disque.`)

⚠️ `<spec_path>` est **relatif à `<racine_cible>`** (Étape 1). Le tester relativement
à ton répertoire courant testerait un fichier du repo de la session — qui n'est
**pas garanti être `<racine_cible>`, même en `same-repo`** (Étape 1.2) : il
n'existe pas, ou pire, existe et n'est pas le bon.

Note : le fichier ticket **est** la spec. Sur certains projets il contient la
conception en entier ; sur d'autres il pointe vers une spec domaine (ex.
`Voir [parse.md](parse.md)`). Le sous-agent a pour consigne de suivre ce lien.

---

## Étape 3.5 — Garde-fou : ticket + spec présents sur `main` (lu dans `guards.specOnMain`)

Le sous-agent travaille dans un worktree **créé à partir de `main`** → il ne verra
que ce qui est commité sur `main`. L'outil de l'Étape 1 a déjà vérifié, sur le
`main` du repo **cible** (`git -C targetRoot`), que la spec y existe **et** que son
statut y vaut `todo|wip`. Lis le résultat dans `guards.specOnMain` :

- `true` → la maturation est bien sur `main`, continuer.
- `false` → **stopper**, afficher :
  ```
  ✗ TICKET-ID (ou son statut maturé) n'est pas encore sur main.
    Le worktree du sous-agent part de main → il ne verrait pas le ticket.
    → Commit la maturation (specs/ + backlog.json) puis lance /send, et relance ce skill.
  ```

Note : ce garde-fou compare à `main`, pas au working tree courant. C'est
**volontaire** — l'Étape 1 trouve le ticket localement, mais c'est l'état de
`main` qui compte pour le sous-agent.

---

## Étape 4 — Vérifier les dépendances

Chercher dans le **corps** du fichier ticket les patterns de dépendance :
- `**Dépend de** : TICKET-X` / `Dépend de : TICKET-X` / `Dépend de TICKET-X`
- `⛔ **Bloqué** par TICKET-X`
- un champ frontmatter `blockedBy: TICKET-X, TICKET-Y`

Pour chaque ticket cité, résoudre son `status` **avec le même résolveur qu'à
l'Étape 1**, en commençant par `<racine_cible>`, et vérifier qu'il vaut `merged` ou
`shipped`.

⚠️ **Une dépendance peut vivre dans un AUTRE repo que le ticket qui la cite** — ce
skill en documente lui-même le cas (un ticket `SKILL-NN` renvoyant à une spec de
whereismycard). Le résolveur, lui, ne scanne qu'une racine à la fois : il te rendra
« introuvable », jamais « ailleurs ». Conduite prescrite, dans cet ordre :

1. non trouvée sur `<racine_cible>` → chercher aussi dans `$HOME/.claude` (le repo
   harnais scanné d'office par l'outil de l'Étape 1.1) : même mécanique, même
   absence de configuration ;
2. toujours introuvable → **ne l'ignore pas en silence** et ne présume pas qu'elle
   est livrée. Traite-la comme une dépendance **non résolue** et demande
   confirmation, en disant où tu as cherché :
   ```
   ⚠️ TICKET-ID dépend de TICKET-X, introuvable dans les racines scannées
      (<racine_cible> · $HOME/.claude) — statut inconnu, pas nécessairement non livré.
      Lancer quand même ? (oui / non)
   ```

Une dépendance dont le statut est **inconnu** n'est pas une dépendance **livrée** :
c'est le silence qui serait l'erreur, pas le fait de demander.

- Si **une dépendance non livrée** : **demander confirmation** :
  ```
  ⚠️ TICKET-ID dépend de TICKET-X (status: <status>, pas encore livré).
     Lancer quand même ? (oui / non)
  ```
  Si non → stopper. Si oui → continuer.

---

## Étape 4.5 — Chemin du worktree cible : lu du JSON (CROSS-REPO uniquement)

**Pointeur — lecture conditionnelle.** ⛔ **Mode `same-repo` : saute cette étape**
(le harnais attribue le worktree, et `worktreePath`/`branch` du JSON valent
`null`). **En mode `cross-repo`**, le corps de cette étape — et celui de l'Étape
5.7, et l'exemple de la Variante cross-repo — vit dans `steps/cross-repo.md`.
Résous son chemin, puis lis-le EN ENTIER avec l'outil `Read` :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','steps','cross-repo.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, **ARRÊTE-TOI et signale-le** — ne devine pas
ce qu'il contient, et ne saute pas l'étape en silence. ⛔ **N'exécute rien de
l'Étape 5.7 maintenant** : tu la lis ici, tu ne la joues qu'à son tour, après la
confirmation de l'Étape 5.

---

## Étape 5 — Récap avant lancement

```
Lancement de TICKET-ID en SDD :
  Modèle    : <model>
  Effort    : <effort>
  Revue     : <review> (<n> relecteur(s) vierge(s)) | none (aucune gate)
  Repo      : <racine_cible>   ← même repo que la session | ⚠️ CROSS-REPO
  Spec      : <spec_path> (relatif au repo ci-dessus)
  Isolation : worktree (le sous-agent travaille dans un worktree dédié)
            | cross-repo : worktree monté par moi dans <chemin_worktree>, agent SANS isolation
  Mode      : background (notification quand fini)

Le sous-agent va :
  1. Lire la spec
  2. Écrire les tests
  3. Coder jusqu'à passer les tests
  4. Vérifier (tests + typecheck)
  5. Commiter (feat/fix(TICKET-ID): …) puis s'ARRÊTER

Puis MOI (orchestrateur) :
  6. Spawner <n> relecteur(s) vierge(s) sur son commit  ← sauf review: none
  7. Constater le git status avant/après la revue
  8. Lancer un correcteur NEUF sur son worktree, avec les findings bruts ;
     il trie, corrige, relance les tests
  9. Rédiger le registre de revue et intégrer via /send

Le statut du backlog est posé automatiquement (wip ici, merged/shipped par /send) —
le sous-agent n'y touche jamais.

Procéder ? (oui / non — défaut oui)
```

Si l'utilisateur répond explicitement `non` ou `n` → arrêter. Sinon continuer.

⚠️ **La ligne `Repo` n'est pas cosmétique** : c'est le seul endroit où l'utilisateur
voit, AVANT tout effet de bord, dans quel arbre le cycle va se dérouler. Un
changement de repo décidé par l'Étape 1.1 doit donc **toujours** passer par cette
confirmation — ne saute jamais l'Étape 5 sous prétexte que le repo a été trouvé
automatiquement.

---

## Étape 5.5 — Backlog-as-data : statut `start` (AVANT de spawner)

Poser le statut `wip` sur le checkout `main` **avant** de spawner — pour que le
sous-agent, dont le worktree est forké de `main`, voie déjà le ticket en `wip`, et
pour que le `merge` du `/send` (qui ne promeut que les `wip`) ait de quoi
travailler. Posé via l'**outil backlog global** (INFRA-14) ; gardé par sa présence
→ no-op total si absent, et le bundle no-op lui-même dans un projet sans backlog.
Le hook tourne **avec cwd = checkout `main` DU REPO CIBLE** (1ʳᵉ entrée de
`git worktree list` **du repo cible**) :

⚠️ **Le `-C "<racine_cible>"` du calcul de `MAIN` est le point critique de cette
étape** (D3, SKILL-09). Sans lui, `git worktree list` répond pour le repo de la
session : le hook poserait `wip` — et **committerait** — dans le mauvais repo, où
l'id n'existe pas. Le hook sortant toujours 0, tu ne verrais rien ; le ticket
resterait `todo` côté cible et le `merge` du `/send`, qui ne promeut que les `wip`,
ne le promouvrait jamais.

⚠️ **Commit SCOPÉ au seul ticket lancé.** Le checkout main est partagé (10-15
worktrees/sessions en parallèle) : committer `specs/` en entier ramasserait le
`specs/*.md` **en cours d'une autre session** (vécu le 17/07/2026). `start` ne vise
qu'un id connu — on nomme donc exactement ses fichiers.

```bash
# ⛔ Ne JAMAIS écrire un dollar suivi d'un chiffre dans ce fichier.
# D'où `sed`, qui n'a besoin d'aucun placeholder positionnel — jamais `awk`.
MAIN=$(git -C "<racine_cible>" worktree list --porcelain | sed -n 's/^worktree //p' | head -1)
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
if [ -f "$TOOL" ]; then
  ( cd "$MAIN" && node "$TOOL" hook start "<TICKET-ID>" )
  PATHS="backlog.json specs/$(printf '%s' "<TICKET-ID>" | tr '[:upper:]' '[:lower:]').md"
  [ -f "$MAIN/specs/backlog.md" ] && PATHS="$PATHS specs/backlog.md"
  git -C "$MAIN" add -- $PATHS
  # `--only` : un `git commit` nu committe TOUT l'index — donc ce qu'une session
  # voisine y aurait stagé. `--only` se limite aux chemins nommés.
  git -C "$MAIN" diff --cached --quiet -- $PATHS \
    || git -C "$MAIN" commit -q --only -m "chore(backlog): start <TICKET-ID>" -- $PATHS
fi
```

Le hook sort toujours 0 (tolérance INFRA-11) : il ne doit **jamais** bloquer le
lancement. Aucun commit si le ticket n'est pas `todo` (déjà `wip`, ou legacy).

⚠️ **Le checkout `main` du repo cible peut être un checkout LIVE** — c'est le cas
de `claude-config`, dont le `main` **est** la configuration active de l'utilisateur
(`$HOME/.claude` : les skills et réglages que le harnais charge en direct). Deux
conséquences, à tenir ensemble :

- Cette étape et le `/send` final y écrivent **par construction** : poser un statut
  de backlog et intégrer dans `main`, c'est écrire dans `main`. On ne peut pas
  l'éviter — c'est la définition de « livrer ». Ce qui rend l'écriture acceptable
  ici est qu'elle est **chirurgicale et commitée** : uniquement les chemins nommés
  (`--only`), uniquement des artefacts de backlog, par toi et jamais par un agent.
- Tout le reste est **interdit** dans ce checkout : aucun `git checkout`, `reset`,
  `stash`, `clean`, aucune écriture de fichier de travail, aucun `npm install`. Un
  seul de ces gestes modifie l'environnement live de l'utilisateur pendant qu'il
  s'en sert. Si le hook échoue ou laisse l'arbre sale, **arrête et signale** — ne
  « répare » rien là-dedans.

---

## Étape 5.7 — Monter le worktree cible (mode CROSS-REPO uniquement)

**Pointeur — lecture conditionnelle.** ⛔ **En mode « même repo », saute
entièrement cette étape** : `isolation: "worktree"` fait le travail. **En mode
`cross-repo`**, le corps de cette étape est dans `steps/cross-repo.md` — **le
même fichier qu'à l'Étape 4.5** : si tu l'as déjà lu là-bas, tu l'as sous les
yeux, ne le relis pas. Sinon, résous son chemin et lis-le EN ENTIER avec l'outil
`Read` :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','steps','cross-repo.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, **ARRÊTE-TOI et signale-le** — ne devine pas
ce qu'il contient, et ne saute pas l'étape en silence.

---

## Étape 6 — Phase 1 : spawner l'implémenteur

**Résoudre le `subagent_type` — `exec.effort` → agent-def (SKILL-22).** L'`effort`
n'est plus décoratif : il choisit l'**agent-def** qui porte le reasoning réel du
sous-agent. Les cinq agent-defs portent le nom de leur palier, d'où une identité,
sans table intermédiaire :

> `subagent_type` = `sdd-impl-<effort>`

C'est le `<subagent_type>` des deux blocs ci-dessous. Un `effort` hors de l'énuméré
de l'Étape 2 → **stopper**, comme à l'Étape 2 : il produirait un `subagent_type`
qui n'existe pas.

⚠️ **`model` reste un override PAR APPEL**, à côté du `subagent_type` : la doc
officielle garantit que l'override `model` par appel « takes precedence over the
definition's model » — seul le `model` de l'agent-def est remplacé, son `effort`
**survit**. C'est cette composition qui rend le design à 5 fichiers suffisant (un
seul agent-def par palier, `model` libre par appel), sans matrice modèle×effort.
Le `subagent_type` porte l'effort ; le paramètre `model` porte le modèle.

Invoquer l'outil `Agent` avec les paramètres — **mode « même repo »** :

```
Agent({
  subagent_type: "<subagent_type>",
  model: "<model>",
  isolation: "worktree",
  run_in_background: true,
  description: "SDD <TICKET-ID>",
  prompt: <PROMPT_TEMPLATE>
})
```

**Mode cross-repo** : les mêmes paramètres **sans la ligne `isolation`**, et avec le
prompt d'appel **cross-repo** ci-dessous (au lieu de celui du mode « même repo »).

```
Agent({
  subagent_type: "<subagent_type>",
  model: "<model>",
  run_in_background: true,
  description: "SDD <TICKET-ID>",
  prompt: <PROMPT_TEMPLATE>
})
```

⛔ **Ne laisse surtout pas `isolation: "worktree"` en cross-repo** : il créerait un
worktree du repo de la **session**, l'agent y atterrirait, n'y trouverait pas la
spec — et, dans le pire des cas, coderait le ticket dans le mauvais dépôt. C'est
précisément l'incident qui a rendu ce mode nécessaire. Le worktree de l'Étape 5.7
est le seul endroit où il doit travailler, et il l'apprend par le prompt.

⚠️ **Garde le nom du mode d'emploi que tu viens de lui envoyer** (`impl-same.md`
ou `impl-cross.md`). Avec `<WORKTREE_IMPL>` (Étape 6.1), ce sont les deux valeurs
que le bloc `<!-- APPEL:impl-fix -->` de l'Étape 6.5 substitue. Tu ne reprends
PAS cet agent-ci : la correction est confiée à un correcteur **neuf**, lancé sur
le même worktree. Son identifiant ne te sert donc à rien.

Puis **attends sa notification de fin** avant de passer à l'Étape 6.1. Ne spawne
aucun relecteur tant que l'implémenteur n'a pas rendu son rapport : il n'aurait
pas de commit à relire.

### Deux prompts d'appel, choisis par le mode — le mode d'emploi est un FICHIER

Ce que tu envoies n'est plus un template à recopier : c'est un **pointeur** de
quelques lignes. Le mode d'emploi complet de l'implémenteur — SDD, garde-fous,
traitement des findings, format du rapport — vit dans `prompts/impl-same.md` et
`prompts/impl-cross.md`, que le sous-agent **lit lui-même** depuis le `.claude` de
la machine. Il n'y a donc plus rien à recopier, donc plus rien à rater : c'est tout
l'objet du dispositif.

⛔ **Ne recopie JAMAIS le contenu d'un mode d'emploi dans un prompt d'appel**, même
« pour que l'agent l'ait sous les yeux ». C'est précisément la recopie que ce
dispositif supprime — celle qui, passé le 10ᵉ lancement d'une session, perdait 30 %
de sa masse (dont la section « Si tu es repris avec des findings ») sans que rien
ne le signale.

**Mode « même repo »** → le bloc `<!-- APPEL:impl-same -->`. **Mode « cross-repo »**
→ le bloc `<!-- APPEL:impl-cross -->`. Chaque bloc est complet et autonome : tu n'y
substitues que des valeurs, tu n'en retires ni n'y ajoutes aucune ligne.

<!-- APPEL:impl-same -->
````
Tu implémentes un ticket en SDD. Voici tes variables :

Ticket : <TICKET-ID>
Spec (absolu) : <ABSOLUTE_SPEC_PATH>
Effort : <effort>

Ton mode d'emploi — SDD, garde-fous, traitement des findings, format du rapport —
est un FICHIER, hors de ton worktree. Résous son chemin, puis lis-le EN ENTIER
avec l'outil Read AVANT toute autre action :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','impl-same.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, ARRÊTE-TOI et signale-le. N'improvise pas la
suite et ne travaille pas de mémoire : tout ce que tu dois faire est écrit là.
````

**Substitutions de ce bloc — liste FERMÉE** : `<TICKET-ID>` (l'argument du skill) ·
`<ABSOLUTE_SPEC_PATH>` (le champ `absoluteSpecPath` de l'Étape 1 — **jamais** un
chemin relatif ni un chemin construit sur le repo de la session : `<racine_cible>`
n'est pas garanti égal à la racine de la session, même en `same-repo` (Étape 1.2)
— l'agent ne pourrait pas l'ouvrir, ou pire, ouvrirait un homonyme périmé) ·
`<effort>` (l'effort du frontmatter, Étape 2). Rien d'autre : une variable de
plus est un ticket, pas une improvisation de lancement.

<!-- APPEL:impl-cross -->
````
Tu implémentes un ticket en SDD. Voici tes variables :

Ticket : <TICKET-ID>
Spec (absolu) : <ABSOLUTE_SPEC_PATH>
Effort : <effort>
Worktree : <chemin_worktree>
Branche : <branche_cible>

Ton mode d'emploi — SDD, garde-fous, traitement des findings, format du rapport —
est un FICHIER, hors de ton worktree. Résous son chemin, puis lis-le EN ENTIER
avec l'outil Read AVANT toute autre action :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','impl-cross.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, ARRÊTE-TOI et signale-le. N'improvise pas la
suite et ne travaille pas de mémoire : tout ce que tu dois faire est écrit là.
````

**Substitutions de ce bloc — liste FERMÉE** : les trois du bloc précédent, plus
`<chemin_worktree>` et `<branche_cible>` — tous deux déjà résolus à l'Étape 4.5,
recopiés tels quels, jamais redéduits.

⚠️ **Le dosage de revue n'est PAS injecté dans ce prompt**, et c'est délibéré :
l'implémenteur ne doit connaître ni le nombre de relecteurs, ni le prompt qu'ils
reçoivent, ni même s'il y en aura. Il ne peut alors plus attester de ce qu'il n'a
pas fait — c'est tout l'objet de l'inversion.

---

## Étape 6.1 — Localiser le worktree de l'implémenteur et son SHA

Même principe qu'à l'Étape 1 : cette mécanique déterministe vit dans l'outil
`tools/sdd/preflight.mjs` (SKILL-13), qui porte désormais un second verbe,
`locate` (SKILL-14). Le skill l'appelle et lit les champs du JSON ; il ne
recalcule rien à la main.

⚠️ **Programmatiquement, jamais en recopiant** ce qu'a écrit l'implémenteur.
(Mode de défaillance réel qui a motivé cet outil : un SHA retranscrit à 39
caractères au lieu de 40, qui fait échouer l'assertion de localisation du
relecteur, Étape 6.3.)

```bash
PREFLIGHT="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','sdd','preflight.mjs'))")"
node "$PREFLIGHT" locate --ticket "<TICKET-ID>" --mode "<mode>" --session-root "<racine_cible>"
```

En mode `cross-repo`, ajoute `--worktree "<chemin_worktree>"` (déjà résolu à
l'Étape 4.5) à la commande ci-dessus : l'outil **vérifie** ce worktree précis au
lieu d'en chercher un — même raison qu'à l'Étape 1.2, une commande `git` vise
son repo explicitement. En cross-repo, un `git worktree list` nu énumérerait les
worktrees du repo de la **session**, où le commit de l'implémenteur n'existe
pas — tu conclurais « rien commité » sur un travail bien commité ailleurs.

**Substitutions résolues à cette étape** : `<mode>` — le champ `mode` du JSON de
l'Étape 1 (déjà tranché, Étape 1.2), recopié tel quel.

L'outil émet **un seul objet JSON** sur stdout :

```
{ "ticket": "...", "found": true, "worktree": "...", "sha": "...", "commitSubject": "..." }
```

- **`found: false`** (pas d'erreur de code) : **stopper**. Soit l'implémenteur
  n'a rien commité (rapport « completed » sans commit — cas vécu), soit son
  worktree a disparu. Ne spawne aucun relecteur, signale-le.
- **`found: true`** → `<WORKTREE_IMPL>` = le champ `worktree` du JSON,
  `<SHA_IMPL>` = le champ `sha` du JSON — tous deux repris **tels quels**,
  jamais retapés.

⚠️ La copie de `<SHA_IMPL>` vers le prompt du relecteur (Étape 6.3) reste
**manuelle**, hors de portée de l'outil : reprends-la **verbatim du champ JSON**,
jamais retapée de mémoire.

Ces deux valeurs, `<WORKTREE_IMPL>` et `<SHA_IMPL>`, servent pour tout le reste
de la gate (Étapes 6.2 à 6.8).

---

## Étape 6.2 — Gate de revue : dosage et état de départ

**Dosage : le `review` du frontmatter (Étape 2), `light` si le champ est absent.**

Si le dosage vaut `none` → **saute le reste de cette étape et les Étapes 6.3 à
6.6**. ⚠️ **Sauf l'Étape 6.6.5** : si l'implémenteur a déclaré une escalade de
spec dans son rapport de première passe (sa SECONDE source de déclenchement,
§ Étape 6.6.5), passe par 6.6.5 quand même avant de continuer — c'est le SEUL
cas où un dosage `none` lit encore une étape entre 6.2 et 6.7 : sans ce
détour, le signal se perdrait précisément dans le dosage qui n'a aucune gate
en aval pour le rattraper. Sinon, va directement à l'Étape 6.7 (intégration),
**puis à l'Étape 6.8** (mesure) : un cycle `none` produit lui aussi son
enregistrement, avec `reviewed: false`. Sans ce renvoi, les cycles sans revue
seraient les **seuls** à ne rien enregistrer — exactement la population qu'il
faut pouvoir compter. ⛔ **Ce détour reste borné à cette SECONDE source** : la
troisième — le constat d'Étape 6.6 (§ Étape 6.6.5) — n'y a **aucun objet**, un
dosage `none` n'exécutant pas l'Étape 6.6, il n'existe aucun registre d'où un
constat pourrait sortir.

Sinon, constate l'état de départ **toi-même** — c'est la moitié de la garantie
read-only de la revue :

```bash
git -C "<WORKTREE_IMPL>" status --porcelain
```

- Sortie **non vide** : **stopper**. L'implémenteur a laissé du travail non
  commité ; le diff relu ne serait pas celui de `<SHA_IMPL>`. Signale-le, ne
  spawne aucun relecteur.

---

## Étape 6.3 — Spawner les relecteurs (c'est TOI qui les spawnes)

**Résoudre le `subagent_type` — épinglé, PAS l'héritage de session (SKILL-23).**
Chaque relecteur spawne en `subagent_type: "sdd-reviewer"` — l'agent-def **généré**
par `tools/agent-defs/generate.mjs` (`agents/sdd-reviewer.md`, frontmatter
`model: opus`, `effort: high`, cohérence disque↔générateur verrouillée par
`__tests__/agent-defs-coherence.test.js`, même mécanisme que les paliers
`sdd-impl-*` de l'Étape 6). **Ne passe PAS de paramètre `model` à cet appel** :
contrairement à l'implémenteur (Étape 6), le réglage du relecteur est **fixe**,
porté par l'agent-def lui-même — le laisser hériter du modèle ou de l'effort de
la session orchestratrice est précisément le défaut que ce ticket ferme. La
**puissance** de la revue ne dépend donc plus de la session qui lance
`/sdd-run-ticket` ; seul le **nombre** de relecteurs (ci-dessous) reste un dosage.

**En dosage `deep` seulement**, calcule d'abord un chemin de rapport par relecteur,
`<CHEMIN_RAPPORT>` — **HORS de tout dépôt** (un répertoire temporaire, ex.
`<tmpdir>/sdd-review-<TICKET-ID>-<n>-<suffixe>.md`). Trois règles, toutes
nécessaires :

- **Un fichier par relecteur, jamais un fichier commun** : avec un fichier
  partagé, un relecteur lirait le rapport d'un autre et l'indépendance des
  tirages — toute la valeur du dosage `deep` — serait détruite.
- **`<suffixe>` est NEUF à chaque exécution de cette étape** (horodatage, PID, ou
  valeur aléatoire — jamais seulement `<TICKET-ID>-<n>`) : une reprise du même
  ticket après un arrêt (worktree sale à l'Étape 6.2, rapport irrecevable à
  l'Étape 6.4) ne doit **jamais** réutiliser un chemin d'une tentative
  précédente, sur lequel un fichier périmé pourrait encore traîner — l'agrégateur
  de l'Étape 6.4.5 n'a aucun moyen de distinguer un rapport frais d'un rapport
  d'un lancement antérieur au même chemin.
- **En dosage `light`, ne calcule RIEN** : aucun agrégateur ne lira jamais ce
  fichier (§ Étape 6.4.5), l'écrire serait un travail mort à chaque cycle.

Ce chemin sert de valeur à substituer dans le bloc `APPEL:reviewer-deep`
ci-dessous ; **conserve-le**, l'Étape 6.4.5 en a besoin.

Avec l'outil `Agent` :

- `subagent_type: "sdd-reviewer"`, `run_in_background: false`
- ⚠️ **SANS paramètre `isolation`** — le relecteur doit atterrir dans le worktree
  de l'implémenteur. Lui donner un worktree isolé le ferait relire un autre arbre.
- `prompt: <PROMPT_RELECTEUR>` — le **prompt d'appel** du dosage : le bloc
  `<!-- APPEL:reviewer-light -->` en `light`, le bloc
  `<!-- APPEL:reviewer-deep -->` en `deep`.
  **Substitutions de ce paramètre** : `<PROMPT_RELECTEUR>` → ce bloc, recopié en
  entier, ses propres placeholders déjà renseignés par tes soins.
- `light` → **1** relecteur, qui reçoit les 4 axes.
- `deep` → **3** relecteurs **en parallèle** (un seul message, 3 appels `Agent`).
  Chacun reçoit lui aussi **les 4 axes** — jamais un sous-ensemble — avec une
  **lentille prioritaire** différente (« commence par l'axe 1 », l'axe 2, l'axe 3).
  Les axes ne sont **pas** une partition : `deep` n'achète pas trois couvertures
  complémentaires, il achète **trois tirages décorrélés** sur le même diff, et
  c'est leur redondance qui rattrape les findings.

⛔ **Interdiction absolue de résumer, justifier ou commenter le travail de
l'implémenteur dans ce prompt.** Tu n'y substitues QUE des valeurs mécaniques. Le
relecteur doit arriver vierge sur le diff : ne lui dis pas qu'un agent a écrit ce
code, ne lui explique pas les choix faits, ne lui suggère pas où regarder. Toi non
plus tu n'as pas lu ce diff — c'est confortable, garde-le comme ça.

Conserve les rapports **bruts** : ce sont eux, et eux seuls, qui alimentent la
recevabilité de l'Étape 6.4 et, ensuite, l'Étape 6.4.5 — qui les relaie tels
quels en dosage `light` (rien à fusionner), ou les fait agréger par l'agrégateur
en dosage `deep` (§ Étape 6.4.5). Ce que reçoivent les Étapes 6.5 et 6.6 n'est
donc plus systématiquement le rapport brut lui-même : c'est `<FINDINGS_BRUTS>`,
défini à l'Étape 6.4.5.

### Les deux prompts d'appel du relecteur — son mode d'emploi est un FICHIER

Le mode d'emploi complet du relecteur — assertion de localisation, interdictions,
**les 4 axes** et le format de sortie — vit dans `prompts/reviewer.md`, que le
relecteur **lit lui-même**. Les axes ont cessé d'être une injection : ce sont
désormais des invariants du fichier, et aucun relecteur ne peut plus en recevoir
trois sur quatre parce qu'une recopie a fatigué.

⚠️ Ici, `<ABSOLUTE_SPEC_PATH>` est le `<spec_path>` **résolu dans
`<WORKTREE_IMPL>`**, pas dans ton propre checkout : l'étape 1 du SDD veut que la
spec ait pu être mise à jour dans le commit relu, et le relecteur juge le code
**contre le contrat livré**. Lui passer ta copie lui ferait relire une spec
périmée — voire un chemin inexistant si ton worktree n'a pas encore le ticket.

<!-- APPEL:reviewer-light -->
````
Tu es relecteur de code. Tu produis un rapport, rien d'autre. Voici tes variables :

Ticket : <TICKET-ID>
Spec de référence (contrat) : <ABSOLUTE_SPEC_PATH>
Répertoire de travail : <WORKTREE_IMPL>
Commit relu : <SHA_IMPL>

Ton mode d'emploi — assertion de localisation, interdictions, axes de relecture,
format de sortie — est un FICHIER, hors de ce worktree. Résous son chemin, puis
lis-le EN ENTIER avec l'outil Read AVANT toute autre action :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','reviewer.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, ARRÊTE-TOI et signale-le. N'improvise pas la
suite et ne relis rien de mémoire : tout ce que tu dois faire est écrit là.
````

**Substitutions de ce bloc — liste FERMÉE** : `<TICKET-ID>` ·
`<ABSOLUTE_SPEC_PATH>` (résolu dans le worktree relu, cf. ci-dessus) ·
`<WORKTREE_IMPL>` et `<SHA_IMPL>` (Étape 6.1, repris **verbatim** du JSON, jamais
retapés). **Pas de `<CHEMIN_RAPPORT>` en `light`** : aucun agrégateur ne spawne
pour un seul rapport (§ Étape 6.4.5), le fichier n'aurait aucun lecteur. Aucune
lentille n'est attribuée : le relecteur unique balaie les quatre axes à égalité.

<!-- APPEL:reviewer-deep -->
````
Tu es relecteur de code. Tu produis un rapport, rien d'autre. Voici tes variables :

Ticket : <TICKET-ID>
Spec de référence (contrat) : <ABSOLUTE_SPEC_PATH>
Répertoire de travail : <WORKTREE_IMPL>
Commit relu : <SHA_IMPL>
Lentille prioritaire : <AXE_PRIORITAIRE>
Chemin de dépôt du rapport : <CHEMIN_RAPPORT>

Ton mode d'emploi — assertion de localisation, interdictions, axes de relecture,
format de sortie — est un FICHIER, hors de ce worktree. Résous son chemin, puis
lis-le EN ENTIER avec l'outil Read AVANT toute autre action :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','reviewer.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, ARRÊTE-TOI et signale-le. N'improvise pas la
suite et ne relis rien de mémoire : tout ce que tu dois faire est écrit là.
````

**Substitutions de ce bloc — liste FERMÉE** : les quatre du bloc précédent, plus
`<AXE_PRIORITAIRE>` — le **numéro** de l'axe par lequel ce relecteur commence
(`1` pour le premier, `2` pour le deuxième, `3` pour le troisième) — et
`<CHEMIN_RAPPORT>`, **distinct pour chacun des trois appels** (un fichier par
relecteur, jamais un fichier commun, cf. ci-dessus). `<AXE_PRIORITAIRE>` est la
**seule** différence entre les trois appels qui portait déjà un sens avant ce
ticket ; sa raison d'être est celle énoncée plus haut, à la puce de dosage, et
n'est pas répétée ici.

---

## Étape 6.4 — Contrôle d'intégrité (c'est TOI qui constates)

Dès que les relecteurs ont rendu leurs rapports :

```bash
git -C "<WORKTREE_IMPL>" status --porcelain
git -C "<WORKTREE_IMPL>" rev-parse HEAD
```

Le relecteur est censé être en lecture seule mais **conserve techniquement**
Write/Edit : sa consigne est déclarative, ces deux commandes sont la seule
garantie réelle. **Les deux sont nécessaires** : `status` seul est vide après un
`git commit`, donc aveugle au relecteur qui aurait commité ou amendé par réflexe.
Si quoi que ce soit a bougé depuis l'Étape 6.2, ou si le HEAD n'est plus
`<SHA_IMPL>` : **STOP** — ne lance aucun correcteur (Étape 6.5), n'intègre pas,
signale « un relecteur a écrit » avec la sortie brute de ces commandes. Tu
publies quand même le registre de l'Étape 6.6, avec sa ligne
`Régime de correction : aucun — arrêt à l'Étape 6.4`.

**Recevabilité des rapports** (aussi importante que leur contenu) : un rapport
recevable se termine par sa ligne `TOTAL: <n> finding(s)`. Un rapport qui dit
`MISMATCH`, qui s'arrête sans `TOTAL:`, ou qui explique n'avoir rien pu lire,
**n'est pas un « 0 finding »** : c'est une relecture qui n'a pas eu lieu. Corrige
la cause (SHA tronqué, chemin de spec faux) et **respawne ce relecteur-là** — ce
n'est pas un second tour de revue, c'est le premier qui n'a pas eu lieu. Ne compte
jamais un tel rapport dans `R`.

---

## Étape 6.4.5 — Agrégation des findings (dosage `deep` uniquement)

**Pointeur — lecture conditionnelle.** **En dosage `light`, saute cette étape
entière** : un seul rapport, rien à fusionner — `R = U`, va directement à l'Étape
6.5 avec ce rapport comme `<FINDINGS_BRUTS>`. ⛔ Ce chemin-là ne lit pas le
fichier ci-dessous : il n'y a rien à y prendre.

**En dosage `deep`**, le corps de cette étape est dans `steps/review-deep.md`.
Résous son chemin, puis lis-le EN ENTIER avec l'outil `Read` :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','steps','review-deep.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, **ARRÊTE-TOI et signale-le** — ne devine pas
ce qu'il contient, et ne saute pas l'étape en silence. ⚠️ Le bloc d'appel
`<!-- APPEL:aggregator -->` ci-dessous, lui, **reste ici** : le corps se lit
là-bas, le bloc se recopie d'ici — l'aller-retour est voulu, et c'est cette phrase
qui l'annonce.

<!-- APPEL:aggregator -->
````
Ticket : <TICKET-ID>
Rapport 1 : <CHEMIN_RAPPORT_1>
Rapport 2 : <CHEMIN_RAPPORT_2>
Rapport 3 : <CHEMIN_RAPPORT_3>

Ton system prompt te pointe vers `prompts/reviewer.md` : ce pointeur NE S'APPLIQUE PAS
à ce lancement. Ta conduite est intégralement dans `prompts/aggregator.md`, hors de
ce worktree. Résous son chemin, puis lis-le EN ENTIER avec l'outil Read AVANT toute
autre action :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','aggregator.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, ARRÊTE-TOI et signale-le. N'improvise pas la
suite et ne relis rien de mémoire : tout ce que tu dois faire est écrit là.
````

**Substitutions de ce bloc — liste FERMÉE** : `<TICKET-ID>` ·
`<CHEMIN_RAPPORT_1>`, `<CHEMIN_RAPPORT_2>`, `<CHEMIN_RAPPORT_3>` — les trois
chemins calculés à l'Étape 6.3, dans l'ordre où les relecteurs ont été spawnés.

---

## Étape 6.5 — Correcteur neuf sur les findings bruts

**Lance un correcteur NEUF** sur le worktree de l'implémenteur. C'est le mode
nominal, et le seul : il n'y a pas de voie de repli, parce qu'une voie jamais
empruntée se dégrade sans témoin — le même argument qui interdit de recopier un
mode d'emploi dans un prompt d'appel (§ Étape 6). Le contexte de l'agent de
l'Étape 6 n'est pas ce qui manque à un correcteur neuf : son mode d'emploi, il le
relit EN ENTIER, et les motifs des choix conservatifs sont dans les messages de
commit, qu'il relit par `git log`.

Mêmes paramètres qu'à l'Étape 6 — `subagent_type` = `sdd-impl-<effort>`, `model`
du ticket — **sans la ligne `isolation`, dans les DEUX modes** :

```
Agent({
  subagent_type: "<subagent_type>",
  model: "<model>",
  run_in_background: true,
  description: "SDD <TICKET-ID> (correction)",
  prompt: <PROMPT_TEMPLATE>
})
```

⛔ **Pas d'`isolation` ici, même en mode « même repo »** : le worktree existe
déjà et porte le commit relu. Un `isolation` en créerait un second, vierge — le
correcteur y « corrigerait » un arbre sans le commit à corriger, et annoncerait
des SHA introuvables dans `<WORKTREE_IMPL>`.

⚠️ **Le suffixe `(correction)` de la `description` est un littéral, et il n'est
pas décoratif : il MARQUE ce lancement pour la mesure de l'Étape 6.8.** Sans
lui, l'implémenteur de l'Étape 6 et ce correcteur portent la même
`description` ; la mesure, qui retient le **dernier** lancement du ticket,
bascule sur le correcteur, et `spawnIndex`, `prompt` et `tokensAtSpawn`
désignent alors la correction au lieu du cycle — enregistrement plausible et
faux (SKILL-112). Et il ne casse rien : `TICKET_ID_FROM_DESCRIPTION_RE`
(`tools/review-log/baseline.mjs`) s'arrête au **premier blanc**, donc
`SDD <TICKET-ID> (correction)` rend exactement le même identifiant de ticket
que `SDD <TICKET-ID>`. ⛔ **Hors ce suffixe, la `description` reste mot pour mot
celle de l'Étape 6** — pas de description « parlante » : elle rendrait ce second
lancement **non attribué**, et l'Étape 6.8 compterait un cycle sans ticket.

<!-- APPEL:impl-fix -->
````
Tu reprends un ticket déjà implémenté : son diff a été relu, tu traites les findings.

Ticket : <TICKET-ID>
Spec (absolu) : <ABSOLUTE_SPEC_PATH>
Effort : <effort>
Worktree : <WORKTREE_IMPL>
Arbitrages délibérés de la première passe : <ARBITRAGES_PASSE_1>

Findings, verbatim :

<FINDINGS_BRUTS>

Ton mode d'emploi est un FICHIER, hors de ton worktree. Résous son chemin, lis-le
EN ENTIER avec l'outil Read AVANT toute autre action, puis applique la section
« Si tu es repris avec des findings » de ton mode d'emploi, régime « relancé à
neuf » : trie (E1/E2/E3), corrige, relance tests + typecheck, commite, rends ta
table de dispositions et ARRÊTE-TOI. ⛔ N'invoque ni /send ni /deploy.

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','<mode_emploi>'))"
```

⛔ Si tu ne peux pas lire ce fichier, ARRÊTE-TOI et signale-le. N'improvise pas la
suite et ne travaille pas de mémoire : tout ce que tu dois faire est écrit là.
````

**Substitutions de ce bloc — liste FERMÉE** : `<TICKET-ID>`,
`<ABSOLUTE_SPEC_PATH>` et `<effort>` — les trois du bloc de l'Étape 6, recopiés
tels quels · `<WORKTREE_IMPL>` (Étape 6.1, repris **verbatim** du JSON) ·
`<mode_emploi>` → le nom du fichier envoyé à l'Étape 6 (`impl-same.md` en mode
« même repo », `impl-cross.md` en cross-repo) — **le même**, jamais l'autre ·
`<ARBITRAGES_PASSE_1>` → la rubrique **Arbitrages délibérés** du rapport de
l'Étape 6, recopiée verbatim, ou `aucun` si ce rapport n'en portait pas — un
correcteur neuf est le seul lecteur qui reste à ce motif · `<FINDINGS_BRUTS>` →
les `U` findings uniques, numérotés, composés selon les règles ci-dessous — la
**liste agrégée** de l'Étape 6.4.5 en dosage `deep`, le rapport unique en dosage
`light` :

- **Verbatim.** Le texte de chaque finding est recopié tel quel. Tu ne le résumes
  pas, ne le reformules pas, ne le hiérarchises pas, n'en écartes aucun — tu n'as
  pas lu le diff, tu n'es pas en position de juger, et un finding écarté ici est un
  rejet silencieux dont personne ne verrait la trace.
- **Sans attribution ni comptage.** Aucune mention du relecteur qui l'a remonté, du
  nombre de relecteurs, du dosage, ni du nombre de rapports vides. Ces informations
  sont ta preuve, pas la sienne : les lui donner lui rendrait exactement la matière
  qu'il ne doit plus pouvoir attester. ⚠️ `<ARBITRAGES_PASSE_1>` n'y contrevient
  pas : cet interdit porte sur les **relecteurs**, et cette ligne vient du propre
  rapport de l'implémenteur — elle ne dit rien de la revue.
- Si `U` vaut **0**, ne lance aucun correcteur : il n'y a rien à corriger. Passe
  à l'Étape 6.6 avec un registre vide.

⏳ **Attends sa table de dispositions avant l'Étape 6.6**, exactement comme tu as
attendu la notification de fin de l'implémenteur à l'Étape 6. Il travaille en
background : enchaîner sans l'attendre te ferait publier un registre à
dispositions vides, et l'Étape 6.7 `/send`-erait un arbre qu'il est en train
d'éditer.

⛔ **Un seul tour.** Quand le correcteur a rendu ses dispositions, tu ne spawnes
pas de seconde vague de relecteurs, même si ses corrections sont substantielles.

---

## Étape 6.6 — Registre de revue (rédigé par TOI)

Tu as maintenant les deux colonnes : les findings **d'entrée** (tes rapports) et
les **dispositions** de sortie (la table de l'implémenteur). Croise-les et publie
le registre — c'est un **constat**, pas une déclaration recopiée :

```
Revue : <n> relecteur(s) · R remontées · U findings uniques après fusion
| # | Finding (titre court) | Relecteur | Disposition |
|---|---|---|---|
| 1 | …                     | A         | corrigé (<sha>) |
| 2 | …                     | A, C      | escaladé — E1 : <justification> |
| 3 | …                     | B         | ticket créé — E2 : <id> |
Contrôle : U uniques = U disposés ✓
Escalade de spec (première passe) : aucune | <résumé — hors équation, Étape 6.6.5>
Constat d'orchestrateur : aucun | <résumé — hors équation, Étape 6.6.5>
git status pendant la revue : propre | A ÉCRIT — <ce qui a bougé>
Régime de correction : correcteur neuf | aucun — U = 0 | aucun — arrêt à l'Étape 6.4
```

- **Deux compteurs distincts, pas un.** `R` = les **remontées brutes** (la somme
  des findings de tous les rapports, avant fusion des doublons). `U` = les
  findings **uniques après fusion**. Trois relecteurs qui remontent le même
  finding donnent `R=3, U=1`. Remplace `R` et `U` par les nombres réels.
- Un finding remonté par plusieurs relecteurs est **une seule ligne**, avec tous
  ses relecteurs dans la colonne « Relecteur » — c'est cette colonne, avec `R`,
  qui mesure la redondance entre dosages. **Source de cette attribution** :
  - En dosage `light` (relecteur unique, pas d'agrégateur) : tu as passé l'appel
    toi-même, l'attribution est directe (`A` pour tout finding).
  - En dosage `deep` : l'agrégateur t'a rendu une liste agrégée **sans**
    attribution (c'est l'objet de ce dispositif — l'implémenteur ne doit rien en
    savoir), mais **la correspondance de l'Étape 6.4.5 la reconstruit pour toi** :
    chaque ligne `Rapport → unique` te dit quel relecteur (1, 2 ou 3, dans l'ordre
    des chemins `<CHEMIN_RAPPORT_1..3>` que tu as toi-même attribués à l'Étape
    6.3) a remonté quel unique. Rapproche cette correspondance de la liste
    agrégée pour peupler la colonne « Relecteur » — ne la laisse jamais vide et
    ne l'improvise pas : elle est calculable, pas devinable.
- La ligne **Contrôle** est obligatoire et ne porte **que sur `U`** : autant de
  findings uniques que de lignes disposées. Ne mets jamais `R` dans cette
  équation — `R > U` est le cas **nominal** en `deep`, pas une anomalie, et
  l'équation ne bouclerait pas. Une **disposition manquante** est ici visible
  mécaniquement, puisque tu détiens la liste d'entrée : si les deux nombres
  diffèrent, ne publie pas un total faux — écris-le explicitement, dis quels
  numéros n'ont pas de disposition, et **n'intègre pas** avant de les avoir
  obtenus. Pour ça, et pour ça seulement, **rejoue le bloc
  `<!-- APPEL:impl-fix -->` de l'Étape 6.5** avec les seuls numéros restés sans
  disposition : c'est réclamer une réponse manquante, pas un second tour de revue
  — l'interdit « un seul tour » de l'Étape 6.5 porte sur les **relecteurs**.
- La ligne **`git status` pendant la revue** rapporte ton constat des Étapes 6.2
  et 6.4 — `propre`, ou le détail de ce qui a bougé, auquel cas tu t'es arrêté à
  l'Étape 6.4 et il n'y a ni corrections ni intégration.
- La ligne **`Régime de correction`** atteste par quel régime les findings ont
  été disposés. **Trois valeurs, et la liste est fermée** : `correcteur neuf` —
  le seul régime nominal depuis l'Étape 6.5 ; `aucun — U = 0` quand il n'y a rien
  eu à corriger ; et `aucun — arrêt à l'Étape 6.4` quand un relecteur a écrit,
  auquel cas `U > 0` sans qu'aucun correcteur ait été lancé — c'est le registre
  d'un arrêt, et les deux premières valeurs y seraient toutes deux fausses. C'est
  un **constat**, au même titre que la ligne `git status` ci-dessus : il n'entre
  pas dans l'équation `U uniques = U disposés`. Un second lancement du correcteur
  pour réclamer une disposition manquante (puce **Contrôle** ci-dessus) ne change
  pas cette valeur : le régime est le même, seul le nombre de lancements diffère.
  Sans cette ligne, l'inversion de l'Étape 6.5 ne laisserait aucune trace dans
  les artefacts du cycle — le défaut même qu'elle corrige, un dispositif qui
  tourne sans que ses propres artefacts le disent.
- ⛔ **Les DEUX lignes `Escalade de spec (première passe)` et
  `Constat d'orchestrateur` du gabarit ci-dessus, qui précèdent toutes deux
  `git status pendant la revue`, sont hors équation au même titre qu'elle** :
  une escalade déclarée en première passe n'est pas un finding, et un constat
  que tu formes toi-même à cette étape (§ Étape 6.6.5) n'en est pas un
  davantage — ni l'une ni l'autre ne rejoint l'équation
  `U uniques = U disposés`. Renseigne `aucune` et `aucun` par défaut. Chacune
  ne porte un résumé d'une ligne renvoyant à l'Étape 6.6.5 que sous SON propre
  déclencheur, jamais sous celui de l'autre : la première, **si le rapport de
  première passe de l'implémenteur en portait une** ; la seconde, **si TU as
  toi-même formé un constat** au sens des trois conditions du § Étape 6.6.5.
  Le défaut explicite est le garde-fou : il oblige à répondre, donc à ne pas
  inventer.
- **Vérifie les `corrigé (<sha>)` avant de les recopier.** C'est la seule colonne
  qui reste déclarée par l'implémenteur. Joue d'abord le **détecteur de mauvaise
  cible** ci-dessous : il n'aiguille rien, il t'arrête si tu interroges le mauvais
  arbre.

  ```bash
  # exit 128 = <SHA_IMPL> n'est un objet connu d'AUCUNE branche de CE dépôt —
  # STOP, voir l'avertissement ci-dessous.
  # exit 0 / exit 1 = simple DIAGNOSTIC (la branche a-t-elle été réécrite depuis
  # la revue ?). Aucune conduite n'en dépend : le contrôle qui suit est le même.
  git -C "<WORKTREE_IMPL>" merge-base --is-ancestor "<SHA_IMPL>" HEAD
  ```

  ⛔ **Exit 128 n'est PAS le régime « amendé ».** `merge-base --is-ancestor`
  sort en **128**, pas en 1, quand `<SHA_IMPL>` est inconnu de ce dépôt
  (`fatal: Not a valid commit name …`) — c'est le signe que `<WORKTREE_IMPL>`
  désigne le mauvais arbre (le voisin, ou le dépôt de session substitué au
  dépôt cible), pas que le commit a été amendé. Lire ce 128 comme « pas 0 »
  certifierait le `HEAD` d'un arbre étranger comme la correction annoncée :
  **arrête-toi et vérifie `<WORKTREE_IMPL>`** avant tout contrôle.

  L'ensemble des SHA légitimes, lui, ne dépend d'aucun code de sortie : ce sont
  les commits **propres à la branche du ticket**, calculés contre `main` — jamais
  contre `<SHA_IMPL>`, qu'un amend ou un rebase périme en silence.

  ```bash
  git -C "<WORKTREE_IMPL>" log --oneline main..HEAD       # l'ensemble légitime
  git -C "<WORKTREE_IMPL>" show --stat "<sha annoncé>"    # ce qu'il contient
  ```

  Le SHA annoncé doit **appartenir** à cette plage **et ne pas être `<SHA_IMPL>`** :
  deux bornes, dont aucune ne dépend d'un état de réécriture. Un SHA absent de la
  plage — trop ancien, donc déjà dans `main`, ou emprunté à la branche d'un voisin,
  qui n'est pas atteignable depuis `HEAD` — n'est pas une correction ; trois
  findings « corrigés » par le même commit d'une ligne non plus. Réclame-lui alors
  la vraie disposition avant d'intégrer.

  ⛔ **`<SHA_IMPL>` appartient à la plage, et n'est pourtant jamais une
  correction.** Tant que le commit relu reste atteignable — le cas ordinaire, celui
  où l'implémenteur AJOUTE son commit de correction plutôt que d'amender —
  `main..HEAD` le contient. Il n'est jamais une correction : c'est le **commit
  relu**, celui dont les findings sont sortis. Un implémenteur qui le réannonce n'a
  rien corrigé — c'est la disposition mensongère la plus facile à produire, et la
  seule que l'appartenance seule laisse passer.

  Le nombre de corrections que le
  commit annoncé contient se vérifie sur **son** `show --stat` et son message,
  jamais sur un compte de commits. ⛔ Ne le vérifie **pas sur la pointe** : elle ne
  porte le bon commit que par coïncidence — un `chore(backlog): new <id>` licite,
  commité après un amend au titre d'un finding E2, l'occupe, et le contrôle
  conclurait « zéro correction » sur un travail correct. Sans ce contrôle, le
  registre boucle sur des dispositions fausses — le contrôle sur `U` ne détecte
  qu'une ligne **manquante**, jamais une ligne **mensongère**.
- Chaque ligne a exactement une disposition, jamais vide : `corrigé (<sha>)`,
  `escaladé — E1 : <justification>` (ou E3), ou `ticket créé — E2 : <id>`. Les
  escalades sont ce que l'utilisateur doit arbitrer — le registre les expose,
  ne les enterre pas dans la prose.

  ⚠️ **Un finding levé malgré tout sur un geste de PORTÉE CONVENTIONNELLE se
  dispose `escaladé — E1`.** La règle projetée chez l'implémenteur et le
  relecteur (`rules/maturation.md`, dépôt `claude-config`) dit qu'un tel geste
  ne s'escalade pas **au titre de la portée** ; elle ne dit pas qu'un finding
  levé dessus n'aurait pas de disposition. Corriger supposerait de retirer un
  geste que le dépôt prescrit sans latitude, ou d'élargir le § Portée : deux
  décisions de *quoi*, ce qui est la définition même d'E1. ⛔ Pas `corrigé` :
  il n'y a rien à corriger, et un `corrigé` sans correction brouille la seule
  colonne que le registre existe pour porter. Le déclenchement de l'Étape
  6.6.5 qui s'ensuit est **voulu**, pas un effet de bord — « ce geste est-il
  vraiment conventionnel ? » est un arbitrage que l'utilisateur doit rendre
  une fois. La source applicable est « **registre** », avec ses cinq éléments,
  dont le troisième se lit ici « il n'y a rien à corriger : le dépôt prescrit
  ce geste sans latitude, et en décider autrement est une question de
  *quoi* ». Son cinquième — le diagnostic de méthode — est **omis**, sa
  condition n'étant pas remplie : la cause n'est pas une clause fausse de la
  spec.
- `0 finding` est une sortie parfaitement valide : registre vide,
  `Contrôle : 0 uniques = 0 disposés ✓`.

---

## Étape 6.6.5 — Escalades E1/E3 (écrites, pas seulement publiées)

⛔ **Ne s'exécute que si le registre de l'Étape 6.6 porte au moins
une disposition `escaladé — E1` ou `escaladé — E3`, ou si l'implémenteur a
déclaré une escalade de spec dans son rapport de première passe (§ « Escalade
de spec (première passe) » de son mode d'emploi, cas « spec contradictoire »
de la section « Si tu te trouves bloqué »), ou si TU as toi-même formé un
constat d'Étape 6.6 — la troisième source, bornée par les trois conditions
du paragraphe ⛔ ci-dessous.**
Aucune escalade → aucune section, aucun commit : une section vide dirait
qu'un arbitrage a été demandé alors que rien ne l'a été (même défaut qu'un
registre fabriqué en dosage `none`, § Étape 7). E2 n'est pas concernée :
son ticket créé est déjà sa trace durable.

⛔ **La troisième source — le constat que TU formes toi-même à l'Étape 6.6, en
croisant la matière du registre avec une clause de la spec — est bornée par
TROIS conditions cumulatives, et une condition qui manque la ferme : elle ne
l'assouplit pas.** (1) **Ancrage** — le constat naît d'un élément que le
registre porte **déjà** (un finding et sa disposition, ou un `corrigé (<sha>)`
que tu viens de vérifier), croisé avec une clause **nommée** de la spec
(fichier, section, citation) ; sans cet ancrage, ce n'est pas un constat mais
une **relecture** : tu n'es pas relecteur, et l'Étape 6.6 n'est pas une seconde
gate. (2) **Défaut d'autorité** — corriger la clause en cause serait
**décider** : elle est hors du § Portée du ticket, ou la corriger reviendrait à
réécrire le contrat en le mettant en œuvre. Ce n'est pas un défaut de
**capacité** : tu peux parfaitement écrire dans cette spec, c'est même ce que
cette étape te fait faire — la frontière est entre **écrire l'escalade**, donc
rendre l'arbitrage possible, et **trancher**, donc le prendre à la place de
l'utilisateur. (3) **Péremption** — sans l'écrire, l'information meurt avec la
session : elle n'a ni finding, ni disposition, ni ticket qui la porte. Un
défaut que l'implémenteur **pouvait** corriger, lui, est un finding que la gate
a manqué : ce n'est pas une escalade, et fabriquer une escalade pour le loger
est l'inverse exact de ce dispositif.

- **Où** : la spec du ticket (`<ABSOLUTE_SPEC_PATH>`), résolue dans
  `<WORKTREE_IMPL>` — jamais dans un checkout live. **En append dans le
  corps**, sous un titre `## Escalades (D10)` (une seule section pour tout
  le fichier ; si elle existe déjà d'un cycle précédent, ajoute une entrée
  dedans plutôt que d'en recréer une seconde), jamais dans le frontmatter :
  le frontmatter reste muté exclusivement par l'outil (Règles strictes du
  skill). **Chaque escalade est un titre de niveau 3 (`###`) sous ce
  conteneur** — jamais `##` (déjà pris par le conteneur), jamais `####` :
  `backlog escalations` (BLG-08) exige cette profondeur exacte.
- **Une escalade peut porter sur la spec elle-même, et c'est le cas
  nominal, pas une exception** : E1 signifie « il faut changer le *quoi* »,
  donc son objet le plus fréquent est un défaut **de la spec** — n'édulcore
  pas en « la spec devrait peut-être être revue », nomme le défaut constaté
  et cite ce qui le prouve. L'interdit qui borne E1 (« tu ne touches pas à
  la spec ») porte sur l'**implémenteur** ; toi, l'orchestrateur, es
  précisément celui qui écrit ici.
- **Comment** : un commit séparé, scopé à la seule spec —
  `docs(<TICKET-ID>): escalade E1` (ou `E3`, ou `E1/E3`) — jamais fondu dans le commit du ticket qui a traversé la gate : ce qui n'est pas du code relu
  doit rester visible comme tel. Ce commit précède le rebase du `/send` qui
  suit ; son SHA sera réécrit, sans conséquence — la trace est le contenu.

  ```bash
  git -C "<WORKTREE_IMPL>" add "<ABSOLUTE_SPEC_PATH>"
  git -C "<WORKTREE_IMPL>" commit -q --only -m "docs(<TICKET-ID>): escalade E1" -- "<ABSOLUTE_SPEC_PATH>"
  ```

  Comme pour toute commande de cette plage d'étapes (Étape 1.2), le repo est
  nommé **dans la commande elle-même** (`-C "<WORKTREE_IMPL>"`), jamais par
  un `cd` antérieur : une commande `git` nue commiterait dans le repo de ta
  session, pas dans le worktree relu.
- **Contenu requis, pas de gabarit littéral** à recopier au mot près (une
  formule verrouillée empêche sa propre correction si sa logique se révèle
  fausse) — **les éléments dépendent de LA SOURCE** qui a déclenché cette
  étape (§ ci-dessus) ; dans les trois cas, tu n'arbitres pas, tu rends
  l'arbitrage possible :
  - **Source « registre »** (une disposition `escaladé — E1`/`E3`) — cinq
    éléments : le **numéro du finding** dans le registre de l'Étape 6.6 et
    son type (E1 ou E3) ; **ce que la gate a trouvé**, avec ce qui le rend
    vrai (fichier, ligne, citation) ; **pourquoi l'implémenteur ne pouvait pas le corriger** ;
    **les issues possibles, non tranchées** ; et, quand la cause de l'escalade
    est une **clause fausse de la spec** (par opposition à une contestation de
    décision produit), le **diagnostic de méthode** que `rules/maturation.md`
    exige pour refermer une E1 — quel contrôle de la maturation aurait dû
    l'attraper : **un numéro (1 à 7)** ou **`aucun`**. ⛔ Tu écris la RÉPONSE,
    jamais le ticket : quand elle est `aucun`, `rules/maturation.md` fait de
    l'ouverture d'un `SKILL-NN` sur la méthode une condition de la **fermeture**
    de l'escalade (`backlog escalations close`), qui n'a pas lieu à cette étape
    et ne t'appartient pas — écris que cette fermeture l'exigera, et **n'invente
    aucun id** : un `SKILL-NN` littéral se lirait comme une référence réelle.
    L'ouverture, en cross-repo, viserait de toute façon le backlog d'un AUTRE
    dépôt (`~/.claude`, § « Où ouvrir le ticket » du `CLAUDE.md` global) — que
    cette étape ne t'autorise pas à muter.
  - **Source « première passe »** (la déclaration du rapport initial,
    hors registre) — trois éléments, PAS les cinq ci-dessus : cette source
    n'a ni numéro de finding (l'Étape 6.6 l'exclut explicitement de `U`) ni
    « ce que la gate a trouvé » (la gate n'a pas encore eu lieu au moment de
    la déclaration) — ne les invente pas. À la place : **la contradiction
    elle-même**, citant les deux clauses qui s'excluent (fichier, ligne) ;
    **le choix tranché par l'implémenteur**, et pourquoi il est le plus
    conservatif ; **les issues possibles, non tranchées**.
  - **Source « constat d'orchestrateur »** (le constat que tu as formé
    toi-même à l'Étape 6.6, sous les trois conditions du paragraphe ⛔
    ci-dessus) — sur le modèle de la source « registre », dont le **premier**
    et le **troisième** diffèrent, cinq éléments : l'**ancrage**, dit
    d'emblée — de quel élément du registre le constat est sorti, et le fait
    que ce n'est **pas** une disposition `escaladé` ; **ce que le constat a
    trouvé**, avec ce qui le rend vrai (fichier, section, citation, mesure
    rejouable) ; **pourquoi ni l'implémenteur ni toi n'aviez autorité pour le
    corriger** ; **les issues possibles, non tranchées** ; et, quand la cause
    est une **clause fausse de la spec**, le **diagnostic de méthode**, un
    numéro (1 à 7) ou `aucun`, avec le même interdit que la source
    « registre » : tu écris la réponse, jamais le ticket, et tu n'inventes
    aucun id.
- **Une seule contrainte de forme, sur le titre du `###`** — ce désaveu de
  gabarit porte sur les **trois** listes de contenu ci-dessus, pas de gabarit
  littéral non plus pour ce point, mais un préfixe verrouillé : le titre du
  `###` commence par son tag — `E1`, `E3` ou `E1/E3`, éventuellement suffixé
  (`E1-a`, `E1.b`, `E1 (finding 2)`) — suivi du reste du titre. Une escalade
  de source « première passe » est **toujours** taguée `E1` (elle conteste
  toujours le *quoi*, jamais un test) ; son suffixe nomme alors la
  déclaration plutôt qu'un finding absent, par exemple `E1 (déclaration
  première passe)`. Une escalade de source « constat d'orchestrateur » est
  elle aussi **toujours** taguée `E1` — un constat conteste le *quoi*, il n'a
  aucun test à faire rougir — et sa forme de suffixe déjà en usage dans le
  corpus est `E1 (constat d'Étape 6.6)`.
  Un lecteur mécanique (`backlog escalations`, BLG-08)
  reconnaît une escalade à ce préfixe ; ce que ce dépôt produit doit le
  garantir, pas le laisser à son inférence.

  ```
  ### E1 (finding 2) — la position du tag dans le titre
  ```

Le registre (6.6) et l'Étape 7 continuent de publier les escalades en
conversation : cette étape s'ajoute, elle ne les remplace pas.

---

## Étape 6.7 — Intégration

L'implémenteur n'invoque jamais `/send` : c'est toi qui intègres, une fois le
registre bouclé. Vérifie que son worktree est propre — **chaque** commande porte
son propre `cd` : le répertoire courant du shell n'est pas supposé persister
d'une commande à l'autre :

```bash
cd "<WORKTREE_IMPL>" && git status --porcelain
cd "<WORKTREE_IMPL>" && git rev-parse --abbrev-ref HEAD
```

- Sortie de `status` **non vide** : **stopper** — il reste du travail non commité,
  ce n'est pas à toi de le commiter.
- La branche doit être celle de l'implémenteur (`worktree-agent-*`), jamais `main`.

Puis exécuter `/send` (rebase + fast-forward, et hooks de backlog `merge`/`ship`).

⚠️ **`/send` n'est pas un sous-processus isolé : c'est toi qui exécutes, une par
une, les commandes qu'il prescrit** (`commands/send.md`) — dans le même régime
de shell que celles du bloc ci-dessus, donc avec le même cwd qui ne persiste
jamais d'une commande à l'autre. `/send` est hors-scope de ce ticket
(§ Hors-scope) : son texte continue de montrer ses `git` nus (il suppose un
`cd` d'état écrit une seule fois en Prérequis). Ça ne change rien à la règle
que tu leur appliques ici : **chaque commande `git` que tu exécutes en son
nom** — Prérequis, rebase, hooks — porte le même `cd "<WORKTREE_IMPL>" && `
que les commandes ci-dessus, même quand `send.md` la montre nue. Il n'y a
**pas de point unique** où « vérifier avant d'invoquer » : un `cd
"<WORKTREE_IMPL>"` isolé, exécuté juste avant, ne protégerait aucune des
commandes qui suivent — la garantie est ligne par ligne, jusqu'à la dernière
commande de `/send`.

- En cross-repo, le `main` dans lequel `/send` fast-forwarde est celui du repo
  cible — donc, quand la cible est `claude-config`, **le checkout live**. C'est
  voulu : c'est là que le livrable doit atterrir. Rien d'autre n'y est touché.
- **Aucun `cd` ne "reste" nulle part** : le cwd ne persistant jamais d'une
  commande à l'autre, il n'y a rien à reposer après `/send` — la commande
  suivante, où qu'elle soit écrite (un second ticket, une vérification, un
  autre `/send`), repart de la racine de la session comme toujours. Ne
  réintroduis pas un `cd` d'état pour « y revenir » : ce serait retomber sur la
  prémisse même que ce ticket corrige.

- ⛔ **Ne lance JAMAIS `/deploy`** : si le message de `/send` affiche
  « → Lance /deploy », c'est une suggestion pour l'utilisateur. Le deploy en prod
  est une décision humaine.
- **Conflit sur `specs/backlog.md` / `backlog.json` pendant le rebase** : personne
  n'est censé avoir touché ces fichiers. **Ne le résous pas à la main** : reprends
  la version de `main` (`git checkout --ours` est ambigu en rebase → utilise
  `git show main:<fichier> > <fichier>`), `git add` le fichier, puis
  `git rebase --continue`. Ces artefacts sont **régénérés** depuis le frontmatter —
  jamais édités. Si ça se reproduit, **arrête et signale**.

### Le `<sha_final>` se relève APRÈS le rebase de `/send`, jamais avant

⚠️ **Ne relève PAS `<sha_final>` avant d'exécuter `/send`.** Sa propre Étape 3
(le rebase sur main) **réécrit tous les commits de la branche** — un SHA relevé
juste avant est donc mort au moment où il serait affiché ou enregistré (constaté
à l'intégration de SKILL-28, le 2026-08-22 : `7c55bab` avant `/send` devenu
`891f064` après rebase). Le fast-forward de l'Étape 4 de `/send`, lui, ne réécrit
rien : c'est bien ce rebase qui compte.

Donc, **immédiatement après avoir exécuté l'Étape 3 de `/send`** (avant de
poursuivre à sa propre Étape 3.5), relève :

```bash
cd "<WORKTREE_IMPL>" && git rev-parse HEAD
```

⚠️ Ce relevé suppose que l'Étape 3 de `/send` a **réussi**. Si `/send` s'arrête
avant de l'atteindre (son Étape 0, garde-fous, en échec) ou pendant elle
(conflits de rebase non résolus), tu n'as **aucun** `<sha_final>` à relever —
et tu n'as rien à inventer : `/send` prescrit déjà l'arrêt immédiat dans ces
deux cas (`commands/send.md`, § Règles strictes : « Exit code non-zéro à
n'importe quelle étape → stopper, expliquer, ne pas continuer »). Tu t'arrêtes
donc là, **avant** ce relevé, l'Étape 6.8 et l'Étape 7 nominale.

C'est **ce** SHA — et lui seul — que tu afficheras à l'Étape 7 et passeras à
l'écrivain de l'Étape 6.8. Il diffère de `<SHA_IMPL>` dans **deux** cas, pas un
seul :
1. l'implémenteur a corrigé (commit `fix(…)` ajouté, ou commit amendé) ;
2. l'Étape 6.6.5 a ajouté son commit `docs(<TICKET-ID>): escalade` — **sans
   qu'aucune correction n'ait eu lieu**. `<SHA_IMPL>` n'est que l'ancre de la
   revue ; après un amend, un rebase, ou ce commit d'escalade, il ne désigne
   plus rien. Ni l'un ni l'autre n'est une anomalie : c'est le fonctionnement
   attendu de l'Étape 6.6.5 et du rebase de `/send`.

---

## Étape 6.8 — Mesure (écrite, pas publiée)

Le registre de l'Étape 6.6 est **publié en conversation, puis meurt avec la
session**. Cette étape en écrit la part durable : **un fichier JSON par cycle de
ticket** dans le dépôt de données `~/sdd-metrics`, produit par
l'écrivain `tools/review-log/write.mjs`. Tu ne rédiges rien — tu lui passes ce
que **tu** as calculé (les compteurs `R`/`U`, l'attribution par lentille, la
disposition de chaque finding) ; les tokens et le rang du lancement, eux, sont
**lus** dans le transcript, jamais déclarés.

⚠️ **C'est TOI qui lances cette commande, depuis ton propre outil shell.** Lancée
par un sous-agent, elle mesurerait le transcript **du sous-agent** — une autre
quantité, silencieusement.

```bash
WRITER="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','review-log','write.mjs'))")"
node "$WRITER" \
  --ticket "<TICKET-ID>" --project "<project>" --repo "<racine_cible>" --mode "<mode>" \
  --sha "<sha_final>" --date "<date>" \
  --model "<model>" --effort "<effort>" --review "<review>" \
  --dosage "<dosage>" --reviewers "<n_relecteurs>" --r "<R>" --u "<U>" \
  --finding '<finding>'
```

`--finding` est **répétable** : une occurrence par finding unique du registre de
l'Étape 6.6, champs séparés par une barre verticale, **le titre en dernier** pour
qu'un titre contenant une barre ne décale rien —
`<i>|<relecteurs>|<disposition>|<ref>|<titre court>`, par exemple
`2|A,C|corrigé|9f2c1ab|le SHA annoncé n’existe pas`. Le numéro est celui du
registre (**entier ≥ 1**, jamais vide) ; `disposition` est un énuméré fermé
(`corrigé` · `E1` · `E2` · `E3`) ; `ref` est le SHA (pour `corrigé`) ou
l'identifiant du ticket (pour `E2`), vide sinon. **Zéro finding unique → aucun
`--finding`**, ce qui est un constat parfaitement valide.

⚠️ **Le `ref` d'un finding est relevé AVANT le rebase de `/send`.** Il vient du
registre de l'Étape 6.6, donc d'avant l'intégration de l'Étape 6.7 — à la
différence de `<sha_final>`, toujours relevé APRÈS. Il peut donc ne plus
désigner le commit réellement livré (réécrit par le rebase, ou emprunté à une
autre branche) : c'est l'écrivain lui-même qui le constate, via
`shaReachableFromBranch` (SKILL-56, aux côtés de `refVerified`).

⚠️ **Guillemets SIMPLES autour de `--finding`, jamais doubles.** Le titre court
est du texte libre recopié d'un rapport de relecteur, et ces rapports citent le
code entre backquotes : sur les titres réellement produits par ce dispositif,
**près de la moitié en contiennent au moins une**, quelques-uns un guillemet
double ou un `$`. Entre guillemets doubles, le shell substituerait la backquote
et la parenthèse-dollar : le titre arriverait **amputé** — silencieusement, code
0, fichier écrit — et, avec un titre citant une commande, c'est cette commande
qui s'exécuterait dans ton shell. Entre guillemets simples, rien n'est
interprété. **Seule exception à traiter** : une apostrophe droite ne peut pas
figurer dans une chaîne entre guillemets simples — remplace-la, dans le titre
seulement, par l'apostrophe typographique `’`, et ne retouche rien d'autre.

En dosage `none`, les quatre derniers flags n'ont pas d'objet — personne n'a
cherché, et `0` serait une preuve inventée. La commande devient :

```bash
WRITER="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','review-log','write.mjs'))")"
node "$WRITER" \
  --ticket "<TICKET-ID>" --project "<project>" --repo "<racine_cible>" --mode "<mode>" \
  --sha "<sha_final>" --date "<date>" \
  --model "<model>" --effort "<effort>" --review "<review>" \
  --dosage "<dosage>"
```

**Substitutions de cette commande — liste fermée, rien d'autre** : `<TICKET-ID>` ·
`<project>` (le nom du projet cible — `claude-config` pour le repo harnais) ·
`<racine_cible>` et `<mode>` (Étape 1) · `<sha_final>` (le `git rev-parse HEAD`
de l'Étape 6.7, **repris verbatim**, jamais retapé) · `<date>` (la date du jour,
telle que le contexte `currentDate` te la donne — jamais déduite d'un horodatage
de commit, d'un nom de fichier ni du début de la session : la date ne s'invente
pas) · `<model>` et `<effort>` (le bloc exec de l'Étape 2, recopiés tels quels) ·
`<review>` (le champ `review` du frontmatter, Étape 2 — **si le frontmatter n'en
porte pas**, cas des tickets historiques, **omets le flag** : l'enregistrement
notera l'absence, il ne recopiera pas le défaut `light`) · `<dosage>` (le dosage
réellement appliqué, Étape 6.2 — il diffère de `<review>` quand le frontmatter
n'en portait pas) · `<n_relecteurs>` · `<R>` et `<U>` (les deux compteurs du
registre de l'Étape 6.6) · `<finding>` (une spec de finding, répétable).

⚠️ **En vague de plusieurs tickets, chacune de ces valeurs vient du ticket que tu
enregistres** — `<sha_final>`, `<R>`, `<U>`, `<n_relecteurs>` et chaque
`<finding>` compris. C'est la seule étape qui **persiste** ces valeurs sur
disque : un `<sha_final>` emprunté au ticket voisin passe tous les contrôles (les
deux SHA existent dans le même dépôt) et reste faux pour toujours dans un fichier
que plus personne ne relira.

**L'écrivain est `no-op` si le dépôt de données est absent** : quand
`~/sdd-metrics` n'existe pas, n'est pas un répertoire, ou ne porte pas
de `.git`, il n'écrit rien, dit pourquoi sur stderr et **sort en 0**. Un code 0
sans chemin sur stdout n'est donc **pas une panne** — c'est le motif qu'il faut
reporter à l'Étape 7. Il ne crée ni le dépôt ni son `.git`, et ⛔ **aucun
`backlog init` n'y est lancé, jamais** : ce dépôt n'a ni specs ni tickets.

Un transcript introuvable ou illisible **ne fait jamais échouer** l'écrivain : il
enregistre des `null` **avec leurs motifs**. L'absence de mesure est une mesure ;
l'absence de fichier n'en est pas une.

- ⛔ **Ne rédige jamais ce fichier à la main**, ni ne le corrige après coup : un
  enregistrement écrit de tête est le registre inventé que tout ce dispositif
  combat. Si la commande échoue (code 1), corrige **l'appel**, pas le fichier.
- ⛔ **Ne commite jamais dans le dépôt `~/sdd-metrics`**, et n'y lance aucun `git`
  mutant : 10 à 15 sessions tournent en parallèle, et des commits concurrents y
  rouvriraient, sous forme d'`index.lock`, la panne que « un fichier par cycle »
  ferme. Les enregistrements s'accumulent dans l'arbre de travail ; leur commit
  est un geste **groupé de l'utilisateur**.
- ⛔ **Ne saute pas cette étape en dosage `none`** : c'est justement le cycle qui
  doit produire un `reviewed: false`. L'y omettre biaiserait la population des
  mesures vers les seuls tickets relus.

---

## Étape 7 — Confirmation

Une fois le cycle terminé, afficher :

```
✓ TICKET-ID livré.
  Modèle     : <model>
  Effort     : <effort>
  Revue      : <review> (<n> relecteur(s) vierge(s), spawnés par l'orchestrateur)
  Repo       : <racine_cible>
  Commit     : <sha final, Étape 6.7>
  /send      : ✓ intégré dans main | <erreur>
  Mesure     : <chemin du fichier écrit, Étape 6.8> | <motif de non-écriture>
```

La ligne **Mesure** porte le chemin absolu rendu par l'écrivain, ou — quand rien
n'a été écrit — le **motif** qu'il a affiché sur stderr (dépôt de données absent,
par exemple). ⛔ Ne la laisse jamais vide et n'omets jamais le motif : un no-op
silencieux est indiscernable d'une mesure oubliée.

suivi du **registre de l'Étape 6.6** et des escalades éventuelles (E1/E3), qui sont
ce que l'utilisateur doit arbitrer — cf. Étape 6.6.5 pour leur écriture durable.

En dosage `none`, les Étapes 6.3 à 6.6 n'ont pas eu lieu : écris la ligne
`Revue : none — aucune gate, aucun relecteur spawné` et **ne publie aucun
registre**. ⛔ N'en fabrique surtout pas un vide : `Contrôle : 0 uniques = 0
disposés ✓` signifie « des relecteurs ont cherché et n'ont rien trouvé », et
serait ici une preuve inventée — le défaut même que ce dispositif combat.
L'Étape 6.6.5 a pu s'exécuter quand même (sa seconde source, § Étape 6.2) :
si c'est le cas, mentionne-le ici en une ligne, sans le compter dans un
registre qui n'existe pas.

⚠️ **Vérifier, ne pas croire** : un sous-agent peut retourner « completed » en
s'étant arrêté en plein milieu (tests à moitié écrits, aucun commit). Confirmer que
le commit `feat/fix(<TICKET-ID>):` est **réellement sur main** avant de croire un
rapport — et que le statut du ticket est bien passé `merged`/`shipped` :

```bash
git -C "<racine_cible>" log main --oneline -5
```

⚠️ Ce contrôle final est le dernier endroit où « tout marche, mais dans le mauvais
arbre » peut encore être attrapé — à condition de regarder le `main` du repo
**cible**. Sans `-C "<racine_cible>"`, tu constaterais l'absence du commit dans le
main de la session et conclurais à un échec, ou pire, tu verrais passer cinq commits
sans rapport et te déclarerais satisfait.

Enfin, en cross-repo, le worktree de l'Étape 5.7 t'appartient : il n'est **pas**
nettoyé par le harnais. Une fois le ticket livré, signale son chemin à
l'utilisateur (`git -C "<racine_cible>" worktree remove "<chemin_worktree>"` quand
il n'en a plus besoin) — ne le supprime pas de toi-même, les escalades E1/E3
peuvent encore avoir besoin de l'arbre.

---

## Règles strictes

- Ne **jamais** éditer `specs/backlog.md` / `backlog.json` / le frontmatter d'un
  ticket à la main — ni toi, ni le sous-agent. Le statut est posé par les hooks
  (`hook start` ici, `hook merge`/`ship` au `/send`). Toute mutation manuelle passe
  par l'outil global (`backlog set|mature|new`).
- Ne **jamais** réintroduire un fait spécifique à un projet dans ce skill (stack,
  ORM, hébergeur, nom de fichier). Le `CLAUDE.md` du projet fait foi.
- Ne **jamais** lancer plusieurs agents sur le **même ticket** (le statut `wip` de
  l'Étape 1.5 est ton signal).
- Ne **jamais** ignorer une dépendance non-livrée sans confirmation explicite de
  l'utilisateur (Étape 4).
- **Gate de revue — c'est TOI qui la conduis**, l'implémenteur n'en connaît que le
  tri des findings :
  - Le relecteur est spawné **sans `isolation`** et n'écrit **jamais dans le
    dépôt relu** — sa seule écriture licite est son propre rapport, dans
    `<CHEMIN_RAPPORT>` (Étape 6.3, dosage `deep` uniquement), un chemin **hors de
    tout dépôt**. Sa consigne read-only sur le dépôt est **déclarative** — il
    conserve techniquement Write/Edit — donc la garantie réelle est le
    `git status --porcelain` avant/après, **que tu constates toi-même** (Étapes
    6.2 et 6.4). Différence → STOP.
  - Le prompt du relecteur est **figé**. Ne jamais y laisser filtrer un résumé, une
    justification ou un commentaire sur le travail relu : ce serait injecter un
    biais dans un contexte vierge, et c'est le seul vrai vecteur de contamination.
  - Le SHA et le worktree passés au relecteur sont **lus programmatiquement**
    (Étape 6.1), jamais recopiés d'un rapport : une transcription à 39 caractères
    au lieu de 40 fait échouer l'assertion de localisation, et ça s'est produit.
  - Aucun finding n'est **rejeté en silence**, ni par toi en composant
    `<FINDINGS_BRUTS>`, ni par l'implémenteur en les triant : corrigé, ou escaladé
    avec justification. Personne ne juge la gravité — on classe (E1/E2/E3) ou on
    corrige.
  - **Un seul tour** de revue. Pas de boucle de polissage.
  - `review` **absent = `light`**. Ne jamais écrire de valeur par défaut dans le
    frontmatter : le défaut vit ici, dans le consommateur.
- Le `/send` est fait par **toi**, depuis le worktree de l'implémenteur (Étape 6.7),
  jamais par le sous-agent.
- **Repo cible — le repo de la session n'est qu'un défaut.** Le ticket appartient au
  repo où vit son livrable (`specs/skill-01.md`), pas à celui d'où on tape la
  commande. En mode cross-repo :
  - **jamais** `isolation: "worktree"` (il forkerait le repo de la session) ;
  - **jamais** une commande `git` sans `-C` : `git worktree list`, `cat-file`,
    `log main` répondent tous, sans broncher, à propos du repo de la session ;
  - le worktree se monte **hors** de l'arborescence du repo cible, et l'assertion
    « pas sous la racine cible » (Étape 4.5) est vérifiée avant le récap, donc
    avant création ;
  - le sous-agent verrouille son shell par **assertion de branche**, pas par la
    sonde de worktree du mode « même repo » — celle-ci ne sert qu'à découvrir un
    worktree attribué par le harnais, ce qui n'arrive pas ici.
- **Ne jamais écrire dans un checkout live.** Quand le `main` du repo cible est la
  configuration active de l'utilisateur, seules deux écritures y sont permises, par
  **toi** et jamais par un agent : le commit de backlog scopé (`--only`) de l'Étape
  5.5 et le fast-forward du `/send`. Aucun `checkout`, `reset`, `stash`, `clean`,
  aucune édition de fichier, aucun `npm install`. Le sous-agent, lui, n'y écrit rien
  du tout — son mode d'emploi (`prompts/impl-cross.md`) le lui interdit explicitement.
- **Exception au `--only` — le seul geste exempté est le dé-suivi d'un fichier.**
  `git commit --only <chemin>` rejoue le WORKING TREE des chemins nommés, pas
  l'INDEX : après un `git rm --cached <chemin>` — dont tout l'effet est dans
  l'index — `--only` efface cet effet et ressuivrait le fichier
  (specs/skill-66.md, § Problème). Le dé-suivi est le SEUL geste du régime live
  où working tree et index divergent par construction ; `--only` ne peut donc
  que l'effacer. La règle générale ci-dessus (`--only` du commit de backlog,
  Étape 5.5) reste entière, sans réserve — ceci n'ouvre PAS de licence « commit
  nu si prudent ». Le geste reste dans CE checkout live, jamais dans un
  worktree : mesuré (specs/skill-70.md, § Cause racine), un `merge --ff-only`
  de `/send` sur un live PROPRE **supprime le fichier du disque** — c'est ici,
  et seulement ici, que `rm --cached` retire l'entrée d'index sans que rien ne
  retire le fichier. Séquence prescrite, dans le checkout live, par **toi**
  uniquement :
  ```
  git -C "$MAIN" diff --cached --name-status        # 0. DOIT rendre VIDE — sinon un voisin travaille : arrête-toi, rien n'a encore bougé
  git -C "$MAIN" rm --cached <chemin>                # 1. la seule mutation d'index du geste
  git -C "$MAIN" diff --cached --name-status        # 2. DOIT rendre EXACTEMENT une ligne : D<TAB><chemin>
  git -C "$MAIN" commit -q -m "…"                    # 3. commit d'index, SANS pathspec, SANS --only
  ```
  Pourquoi la ligne 0 précède le `rm --cached` (specs/skill-66.md, § D3) :
  sans elle, seule la ligne 2 — jouée APRÈS la seule écriture du geste —
  détecterait un voisin, et l'opérateur qui s'arrête alors sur son échec a
  déjà sa propre suppression stagée dans l'index PARTAGÉ, sans aucun geste de
  réparation permis (interdits sans exception, bullet ci-dessus). La ligne 0,
  jouée avant toute écriture, détecte le même voisin dans l'état où rien n'a
  encore bougé : l'opérateur qui s'arrête sur elle n'a rien à défaire. La
  ligne 0 est **bloquante** : si l'index n'est pas vide, une session voisine
  travaille — **arrête-toi**, rien n'a encore bougé. La ligne 2 est **bloquante** : si
  la sortie n'est pas exactement une ligne `D` suivie d'une tabulation puis
  `<chemin>` (le format de `--name-status` — ne pas confondre avec les deux
  espaces de `git status --short`), **arrête-toi** —
  soit la suppression n'est pas stagée, soit une session voisine a stagé
  autre chose dans l'index, qu'un commit nu embarquerait. Cette assertion est
  un garde-fou PLUS fort que `--only`, pas plus faible : `--only` limite ce
  qui part sans jamais dire ce qui part ; l'assertion prouve les deux — que
  la suppression est bien là, et qu'il n'y a rien d'autre dans l'index.

  ⚠️ **Deux fenêtres résiduelles distinctes, assumées et écrites, pas
  fermées** (specs/skill-66.md, § D3) — aucune assertion ne peut les fermer
  sans assouplir l'interdit du bullet ci-dessus, écarté sans réserve par
  l'arbitrage du 2026-08-25 :
  1. **Entre la ligne 0 et la ligne 1.** Un voisin peut encore staguer dans
     cette fenêtre — elle passe de plusieurs secondes (l'ancienne séquence à
     trois lignes) à quelques millisecondes, mais elle n'est pas nulle. Si
     elle se réalise, c'est la ligne 2 qui l'attrape et l'opérateur
     **arrête-toi** — mais SANS geste de réparation, cet arrêt reproduit
     EXACTEMENT le symptôme d'origine (specs/skill-66.md, § Problème) : la
     suppression reste stagée dans l'index PARTAGÉ, indéfiniment, tant que
     personne ne la commite. **Ce ticket ne ferme pas ce cas — il en réduit
     seulement la fréquence.** L'issue de secours nommément envisagée
     (`git reset -- <chemin>` pour défaire le `rm --cached` d'une assertion
     en échec) a été **examinée et écartée** à l'arbitrage : elle rouvrirait
     une exception dans l'interdit posé par le bullet ci-dessus, et un
     interdit avec une exception se négocie ensuite.
  2. **Entre la ligne 2 et la ligne 3.** Une session voisine peut encore
     staguer entre le constat qui prouve « rien d'autre que la suppression »
     et le commit sans pathspec qui suit — aucune assertion ne rejoue après
     elle-même. Ce cas-ci reste **visible** avant tout dégât irréversible : le
     commit montrerait le fichier de trop, avant tout push, et se corrige par les
     moyens ordinaires d'un commit pas encore poussé (ex. l'amender pour en
     retirer ce fichier).
- Si une étape échoue (résolution, validation, lancement Agent) : **stopper**,
  expliquer ce qui a foiré, ne pas continuer.

---

## Cas d'usage typique

```
[utilisateur] /sdd-run-ticket ANALYTICS-02S
[skill]      Lancement de ANALYTICS-02S en SDD :
             Modèle    : sonnet
             Effort    : high
             Revue     : light (1 relecteur vierge)
             Repo      : /c/dev/monprojet   ← même repo que la session
             Spec      : specs/analytics-02s-batch-compute-if-null.md (relatif au repo ci-dessus)
             Isolation : worktree
             Mode      : background
             Procéder ? (oui / non)
[utilisateur] oui
[skill]      ✓ Agent SDD lancé sur ANALYTICS-02S.
             ...
[notif]      Agent "SDD ANALYTICS-02S" completed. Commit d1f1ef7, 8 tests verts.
[skill]      → worktree + SHA relus programmatiquement, git status propre
             → 1 relecteur spawné (light), 2 remontées
             → correcteur neuf lancé avec les 2 findings, dispositions rendues
[skill]      ✓ ANALYTICS-02S livré.
             Revue : 1 relecteur · 2 remontées · 2 findings uniques après fusion
             | # | Finding                      | Relecteur | Disposition |
             |---|------------------------------|-----------|-------------|
             | 1 | batch vide non géré          | A         | escaladé — E1 : la spec ne dit pas quoi faire |
             | 2 | compteur non réinitialisé    | A         | corrigé (a3c9b21) |
             Contrôle : 2 uniques = 2 disposés ✓
             Escalade de spec (première passe) : aucune
             Constat d'orchestrateur : aucun
             git status pendant la revue : propre
             Régime de correction : correcteur neuf
             /send: ✓ intégré dans main
```

### Variante cross-repo (ticket d'un autre repo)

**Pointeur — lecture conditionnelle.** L'exemple de bout en bout d'un cycle
`cross-repo` est dans `steps/cross-repo.md` — **le même fichier qu'aux Étapes 4.5
et 5.7**, donc déjà lu si tu es passé par elles ; en mode `same-repo`, tu n'as
rien à y lire. Si tu as besoin de l'exemple et ne l'as pas déjà lu, résous son
chemin et lis-le EN ENTIER avec l'outil `Read` :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','steps','cross-repo.md'))"
```

⛔ Si tu ne peux pas lire ce fichier, **ARRÊTE-TOI et signale-le** — ne devine pas
ce qu'il contient.

---

## Note sur les agents parallèles

Tu peux invoquer ce skill plusieurs fois de suite avec des `TICKET-ID`
différents. Chaque implémenteur vit dans son propre worktree isolé → aucun conflit
sur les fichiers du repo principal. Comme aucun agent ne touche au backlog (le
statut vient des hooks, scopés par le commit `feat/fix(<ID>)`), les lancements
parallèles ne se marchent plus dessus sur `backlog.md`. Attention en revanche aux
tickets qui **partagent des fichiers de données** (ex. traductions, fixtures)
soumis à un test de cohérence : les lancer **par vagues** (le 2ᵉ après le merge du
1ᵉʳ).

En **cross-repo**, chaque ticket a son propre worktree monté (Étape 5.7) et son
propre suffixe : deux tickets du même repo cible ne se marchent pas dessus. Mais
tes `cd` successifs, eux, se marchent dessus — l'Étape 6.7 laisse ton shell dans le
worktree qu'elle vient d'intégrer. Repose-le systématiquement avant de reprendre le
ticket voisin, et n'utilise jamais l'implicite : `git -C` partout.

⚠️ En parallèle, tu tiens **une boucle en trois temps par ticket** (Étapes 6 →
6.1-6.4 → 6.5), pas un lancement qu'on oublie. Rattache chaque notification au bon
ticket avant d'agir : les Étapes 6.1 à 6.8 s'exécutent **entièrement** avec le
`<WORKTREE_IMPL>` et le `<SHA_IMPL>` du ticket concerné, jamais ceux du voisin —
et l'Étape 6.8, qui **écrit sur disque**, avec ses compteurs (`<R>`, `<U>`,
`<n_relecteurs>`, ses `<finding>`) et son `<sha_final>` à lui.

### Doctrine de frontière de session

Deux règles, pour une session qui enchaîne des tickets :

- **Maturation continue.** Maturer au fil de l'eau, dans la session où la
  question se pose, plutôt que d'accumuler des tickets à maturer pour une
  session de lancement dédiée.
- **Lancer par vagues de 3 à 5 tickets** — un groupe de tickets lancés dans la
  même session —, puis ouvrir une session neuve. ⚠️ Ne pas confondre avec le
  « par vagues » ci-dessus (un ticket à la fois, à cause des fixtures
  partagées) : les deux règles répondent à des risques différents et se
  cumulent, la seconde ne relâchant jamais la première.

Le motif : ce n'est pas la taille d'un prompt recopié — ce prompt d'appel ne
porte plus que des variables, il n'y a plus de masse à y perdre. C'est la
boucle à trois temps par ticket ci-dessus, tenue sur une session qui
s'allonge : à chaque ticket, le rattachement des notifications au bon ticket,
le registre de l'Étape 6.6, et surtout l'Étape 6.8 — qui **écrit sur disque**
et dont l'erreur (un `<sha_final>` emprunté au ticket voisin, par exemple) est
irrattrapable et silencieuse. S'y ajoute le risque de conduite : la chaîne
peut réécrire `commands/sdd-run-ticket.md` lui-même sous la session qui
l'exécute (un `/send` en cours de session remplace ce fichier dans le checkout
live), désynchronisant la copie en contexte de l'orchestrateur du disque.

**Motif mesuré, en complément** : le coût d'un cycle tend à croître avec son
rang dans la session — mécanique, chaque tour relit un contexte qui grossit à
chaque ticket. Session `97cfdd24` du 2026-08-22, 5 cycles `deep`, en
`cache_read` (le terme dominant, très loin devant l'output) :

| rang | ticket | `cache_read` du cycle |
|---|---|---|
| 0 | SKILL-26 | 10,6 M |
| 1 | SKILL-28 | 14,7 M |
| 2 | SKILL-31 | 17,6 M — +66 % sur le premier |
| 3 | SKILL-48 | 15,4 M |

⚠️ Limites, à ne pas taire : la progression n'est **pas monotone** — le rang 3
retombe sous le rang 2 — donc « croît » se lit comme une tendance, pas une loi
vérifiée à chaque pas ; `tokens.scope` vaut `session-to-date`, ces chiffres
sont des deltas calculés à la main ; le 5ᵉ cycle de cette session est faussé
par un lancement parallèle ; un cycle d'une autre session porte un delta
négatif (transcript probablement compacté). Les ordres de grandeur tiennent
(+66 % entre le premier et le pire), pas une progression strictement
croissante — et ce motif explique **pourquoi** découper, jamais **où**
couper : le chiffre de 3 à 5 ci-dessous vient uniquement de la distribution
d'usage, pas de ce tableau.

⚠️ Ce chiffre de 3 à 5 est un ordre de grandeur assumé, pas un seuil mesuré : la
médiane observée est de 2 lancements par session, 87 % des sessions tiennent
déjà sous 5. La règle codifie une pratique déjà majoritaire et borne le cas
rare qui va au-delà.

**Prérequis de mesure — la condition de retrait n'est pas applicable** :
aucun champ enregistré aujourd'hui par `~/sdd-metrics` ne peut
distinguer un `<sha_final>` valide d'un `<sha_final>` emprunté au ticket
voisin. `shaVerified` constate seulement que le SHA existe et est bien formé
dans le dépôt (`true` sur la quasi-totalité des cycles, cf. plus bas) — jamais
sa **provenance** : un SHA emprunté au voisin existe tout autant, et vaudrait
`true` de la même façon. Sur les cycles minoritaires où il vaut `false`, son
motif (`shaVerifiedReason`, depuis SKILL-103) ne discrimine que deux modes de
défaillance disjoints — SHA mal formé (contrôle de format, git jamais
interrogé) ou SHA absent du dépôt (`git rev-parse --verify` en échec) —, sans
rapport avec le défaut de provenance visé ici. Et `controls` ne vérifie que la
cohérence interne du registre (`R ≥ U`), jamais la provenance de ses valeurs ;
pire, il confond structurellement un contrôle réussi et un contrôle jamais
exécuté (`null`). Vérifié sur les cycles enregistrés à ce jour
(`~/sdd-metrics/cycles`, pas de mémoire — ce compte grossit à chaque
lancement) : les deux champs sont déjà au vert sur la quasi-totalité d'entre
eux, ce qui achève de les rendre impropres à mesurer ce motif-là.

Le champ nommé comme manquant, à l'époque, pour ce prérequis : que le
`<sha_final>` persisté à l'Étape 6.8 soit **atteignable depuis la branche du
ticket concerné** — pas seulement qu'il existe dans le dépôt. Un champ nommé
`shaReachableFromBranch` existe désormais dans les fichiers de cycle
(SKILL-46/SKILL-56), mais il répond à une **autre** question : pour chaque
`ref` de finding en disposition `corrigé`, l'écrivain constate son
atteignabilité depuis `main` du dépôt cible, aux côtés de `refVerified`. Il
ne couvre pas `<sha_final>` lui-même, et ne le pourra jamais par ce moyen :
une branche de ticket est coupée depuis le `main` vivant du dépôt, donc tout
SHA déjà fusionné dans `main` avant cette naissance — y compris un
`<sha_final>` emprunté à un ticket voisin — est trivialement atteignable
depuis la branche née ensuite, tout comme depuis `main` lui-même
(specs/skill-56.md § Hors-scope).
**Ce n'est donc pas un instrument qui manque : c'est ce motif-là —
discriminer un `<sha_final>` emprunté au voisin — qui n'est mesurable par
atteignabilité, ni depuis `main`, ni depuis la branche du ticket.** La
doctrine n'a, à ce jour, aucun horizon de retrait mesurable. Le déclencheur
qui suit, écrit avant que cette limite soit connue, s'en trouve **non
exécutable en l'état** — conservé pour mémoire, pas comme procédure à
appliquer.

Une fois ce champ disponible : retirer la doctrine si, sur une population de
cycles à `spawnIndex` élevé, le `<sha_final>` reste atteignable depuis la
branche du ticket concerné aussi souvent en fin de session qu'en début. Ce
constat se fait sur les fichiers de cycle, pas de mémoire.
