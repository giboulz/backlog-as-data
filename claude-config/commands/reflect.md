# /reflect — Miner les candidats de mémoire (projet + pool global), router les propositions, et scanner en cross-projet (mode explicite)

Invoqué **à la main**, quand tu décides de faire une passe de rodage sur la mémoire.
Ce skill est le **mineur** du palier `candidate` (SKILL-17) : le palier accumule de
la friction brute à bas seuil ; sans passe périodique qui détecte le récurrent et le
range, ce palier n'est qu'un dépotoir write-only. `/reflect` le vide intelligemment.

Cadrage (maturé en conversation) : on ne cherche **pas** « une amélioration » (non
borné → mush), on cherche **une friction qui se répète et n'a pas encore de règle**.
Le mineur n'est pas un cerveau qui refait le monde : c'est un **routeur** qui
dispatche le récurrent vers le mécanisme qui existe déjà (mémoire durable, backlog,
`CLAUDE.md`). Il **propose** ; le SDD normal, ou l'aval de l'utilisateur, dispose.

⛔ **Manuel/volontaire, jamais automatique.** Un lancement automatique overfitterait
un système jeune (et coûterait cher). Un nudge est acceptable quand le nombre de
candidats non minés franchit un seuil — mais le **déclenchement** reste toujours un
geste explicite. C'est un outil de rodage : usage intense sur un système jeune,
quasi-nul une fois stabilisé.

Ce skill est **générique** (comme `/mature` et `/sdd-run-ticket`) : il tourne
dans le **projet courant** et lit **son** dossier mémoire. Aucun projet n'est écrit
en dur. Depuis SKILL-20, il lit **aussi**, à chaque passe, le pool global
(`$HOME/.claude/memory/candidates/`) — mode projet + pool global sont désormais tous
deux actifs **par défaut**, pas une option à activer. Le **scan cross-projet**
(corréler les pools de PLUSIEURS projets pour repérer un candidat `project` récurrent
et le re-router en `global`) reste, lui, un **mode explicite**, jamais le défaut —
voir § Scan cross-projet (mode explicite) plus bas.

---

## Arguments

`/reflect` s'invoque de deux façons — le point d'entrée du mode scan (SKILL-20,
finding de gate : le fichier ne le déclarait nulle part) :

```
/reflect
/reflect --scan-cross-projet
```

- **Sans argument (défaut)** : exécuter les Étapes 1 à 6 ci-dessous — mine le pool du
  projet courant + le pool global (D1) — puis le § Récap, section « mode normal ».
- **`--scan-cross-projet`** : exécuter le § Scan cross-projet (mode explicite)
  ci-dessous **à la place** des Étapes 1-6 (population et mécanisme différents —
  cf. cette section), puis le § Récap, section « mode scan cross-projet ».

⚠️ Le scan n'est **jamais** invoqué implicitement : sans `--scan-cross-projet`
explicite en argument, `/reflect` ne le déclenche pas, quel que soit le nombre de
candidats accumulés dans les pools par-projet (D1). Rien dans les Étapes 1-6 ne
bascule vers le scan de lui-même.

---

## Pré-requis — localiser le dossier mémoire du projet courant

Les mémoires du projet courant vivent dans `$HOME/.claude/projects/<clé>/memory/`, où
`<clé>` est le **chemin absolu du projet** avec ses séparateurs (`\` ou `/`) **et** le
`:` remplacés par `-`. Exemple : le projet `C:\Users\gibou\whereismycard` a pour clé
`C--Users-gibou-whereismycard`, donc son dossier mémoire est
`$HOME/.claude/projects/C--Users-gibou-whereismycard/memory/`.

Lister les clés disponibles pour retrouver la bonne (ne pas deviner — confirmer) :

```bash
ls "$HOME/.claude/projects/"
```

⚠️ Chaque worktree porte **sa propre** clé (suffixée par son chemin de worktree). Les
candidats du projet s'accumulent sous la clé du **checkout où ils ont été capturés**.
Si tu tournes depuis un worktree et que le dossier est quasi-vide, remonte à la clé du
checkout principal du projet. En cas de doute, `ls` la clé retenue et vérifie qu'elle
contient bien `MEMORY.md` + des fichiers de mémoire.

### Le pool global s'ajoute, toujours (SKILL-20, D1)

En plus du dossier mémoire du projet courant, `/reflect` lit **systématiquement** le
pool global `$HOME/.claude/memory/candidates/` (SKILL-58, CLAUDE.md § Mémoire) —
ce n'est **pas** une option à activer, c'est la lecture par défaut de chaque passe,
au même titre que le pool du projet courant. Ce chemin est **fixe**, indépendant du
projet courant : le lire n'est **pas** le scan cross-projet (§ Scan cross-projet plus
bas), qui, lui, parcourt les dossiers mémoire de PLUSIEURS projets.

---

## Étape 1 — Lire

Charger, depuis le dossier mémoire retenu :

1. **les candidats** — tout fichier de mémoire dont le frontmatter porte
   `metadata.type: candidate`. C'est **l'entrée de la mine** : chaque candidat est une
   observation de friction brute (une ligne « ce qui a lutté / ce que l'utilisateur a
   corrigé / ce que la gate a rattrapé ») + un tag de portée (`project`/`global`), pas
   encore une règle.
2. **les mémoires durables existantes** (`type: feedback` et `type: project`) — on les
   lit pour **ne pas re-proposer** ce qui est déjà une règle gravée. Un candidat qui
   redit une règle existante n'est pas un pattern neuf : c'est du bruit à retirer.
3. **le pool global** — tout `metadata.type: candidate` sous le chemin absolu
   `$HOME/.claude/memory/candidates/` (CLAUDE.md, § Mémoire) : un dossier **fixe**,
   pas dérivé du projet courant, lu par défaut à chaque passe (§ Pré-requis ci-dessus,
   D1). Le lire n'est **pas** le scan des dossiers mémoire des AUTRES projets
   (§ Scan cross-projet, SKILL-20). Un candidat tagué `global` déjà présent dans le
   dossier mémoire par-projet (capturé avant SKILL-58, pas migré — cf. sa spec) reste
   lu normalement au point 1 et peut être re-routé comme n'importe quel pattern.

---

## Étape 2 — Clusteriser

Regrouper les candidats par **thème de friction** — jugement sémantique, pas un
`group by` mécanique. Deux candidats formulés différemment mais qui décrivent la même
friction sous-jacente vont dans le même cluster. Pour chaque cluster, **compter les
occurrences** (le nombre de candidats distincts qu'il réunit).

⛔ **Les deux populations se clusterisent séparément (D2, SKILL-20).** Ne pas
fusionner le pool global et le pool du projet courant en un seul tas avant de
clusteriser : le seuil `≥ 2` de l'Étape 3 se compte **séparément dans chaque
population**. Un candidat `project` isolé ne doit jamais être promu sur la force
d'un candidat de portée globale qui décrit une autre friction — ce serait une
promotion fabriquée, exactement ce que le seuil existe pour empêcher.

---

## Étape 3 — Trancher : pattern vs artefact n=1 (le garde-fou central)

Pour chaque cluster, appliquer le seuil — **c'est le garde-fou qui empêche le système
d'osciller** :

- Un cluster **≥ 2** occurrences, **sans règle durable existante** = un **pattern** à
  router (Étape 4). La friction se répète et n'a pas encore de domicile.
- Un candidat vu **une seule fois** = **artefact n=1** : on **ne grave aucune règle
  dessus**. Un jeune système qu'on retouche sur `n=1` oscille — on laisse l'artefact
  mûrir (il redeviendra peut-être un cluster ≥ 2 à la prochaine passe) ou on le jette
  à l'Étape 6. Graver sur `n=1`, c'est confondre le bruit avec le signal.

Un cluster ≥ 2 qui **redit une règle durable déjà présente** (lue à l'Étape 1) n'est
pas un pattern neuf : il signale que la règle existe mais n'est pas suivie — le noter
à part (peut-être un problème de visibilité de la règle), pas re-graver la même chose.

---

## Étape 4 — Router (le cœur)

Pour chaque **pattern** (≥ 2), produire **une proposition** dirigée vers son
**domicile** existant. Le routage est une **table** — le mineur choisit la ligne, il
n'invente pas de destination :

| Friction récurrente… | Domicile | Action proposée |
|---|---|---|
| **comportement** (l'utilisateur corrige la même chose souvent) | mémoire durable `feedback`/`project` | promouvoir en une mémoire durable (fichier + pointeur `MEMORY.md`) |
| **un skill précis** | ticket `SKILL-NN` (ou `/improve-skill`, SKILL-19) | ouvrir un ticket `SKILL-NN`, ou proposer de lancer `/improve-skill` |
| **l'outillage** (CLI, tests, migrations) | ticket **projet** | ouvrir un ticket dans le scope concerné |
| **la méthode de maturation** (rédiger une spec : portée, tests, vérification) | **diff `rules/maturation.md`** (+ le noyau de `CLAUDE.md` si la friction touche un TITRE) | proposer un diff de la règle, jamais l'appliquer soi-même |
| **le workflow lui-même** (le reste) | **diff `CLAUDE.md`** | proposer un diff de `CLAUDE.md`, jamais l'appliquer soi-même |

⚠️ Les deux dernières lignes restent **distinctes depuis SKILL-97** : le
**texte** des sept contrôles, le rituel de fermeture d'escalade E1 et
l'échelle de choix du modèle vivent exclusivement dans `rules/maturation.md`.
Un diff de méthode qui ne touche pas un TITRE (justification, exemple,
rituel, échelle) vise `rules/maturation.md` seul, et butterait de toute façon
sur `PLAFOND_CLAUDE_MD` s'il visait `CLAUDE.md`.

⚠️ **Depuis SKILL-100**, les sept TITRES (une ligne chacune, sans
justification) sont en plus **projetés** dans `CLAUDE.md`, sous
« ### Maturation — la méthode vit dans une règle, pas ici », et vérifiés
identiques à `rules/maturation.md` par un test
(`commands-shape-coherence.test.js`). Un diff qui reformule un TITRE doit
donc viser **les deux fichiers dans le même commit** — sinon `npm test`
rougit sur cette projection — et re-mesurer `PLAFOND_CLAUDE_MD` (sans marge)
si la longueur du noyau change.

`/improve-skill` (SKILL-19) est une **destination** du routeur, pas implémentée ici :
une friction « skill précis » peut proposer de le lancer, mais ce skill est livré
séparément.

---

## Étape 5 — Proposer, pas agir

Sortir une **liste rangée** de propositions, une ligne par pattern :

```
- Pattern (la friction, une phrase) · nb d'occurrences · domicile · action concrète
```

⛔ **Jamais de hot-patch.** `/reflect` **ne modifie pas** un skill ni `CLAUDE.md` de
lui-même : il **propose** un ticket qui suivra le SDD normal (spec → tests → code →
vérif). La seule chose qu'il grave, **après aval au cas par cas**, c'est ce que son
propre périmètre autorise sans détour par le SDD :

- **promouvoir un candidat en mémoire durable** — écrire le fichier `feedback_…`/
  `project_…` + son pointeur dans `MEMORY.md`, puis **retirer le candidat** promu ;
- **créer un ticket** — via l'**outil backlog global** (comme `/mature`), en
  `maturing`, titre + une ligne de rationale, **sans** poser de triplet ;
- **déplacer un candidat re-routé** (§ Scan cross-projet, mode explicite, D6,
  SKILL-20) — après validation au cas par cas, jamais avant :

```bash
node "$HOME/.claude/tools/backlog/backlog.mjs" new "SKILL-NN" --title "…" --priority should
```

L'utilisateur **approuve au cas par cas** — pas un « tout ou rien ». Rien n'est gravé
sans son aval. Une proposition refusée laisse le candidat en place (il repassera à la
prochaine mine).

---

## Étape 6 — Nettoyer

- Les candidats **promus** (en mémoire durable) ou **absorbés** dans un ticket sont
  **retirés** du dossier mémoire — ils ont trouvé leur domicile.
- Les candidats **n=1 datés** peuvent être **purgés** — mais **seulement à l'aval
  explicite** de l'utilisateur, jamais de purge silencieuse. Présenter la liste des
  artefacts candidats à jeter et attendre le feu vert.

---

## Scan cross-projet (mode explicite)

**SKILL-20.** Le scan cross-projet **ne s'active que sur demande** — jamais le
défaut d'un `/reflect` de routine (§ Arguments, `--scan-cross-projet`). Trois
raisons : il lit hors du projet courant ; son coût croît avec le nombre de projets,
pas avec le travail de la session ; et sa sortie touche les pools **d'autres
projets** — un effet de bord transverse n'a pas à être le sous-produit silencieux
d'une passe ordinaire.

Le scan parcourt les pools **par-projet** (`$HOME/.claude/projects/*/memory/`) pour
repérer, **par leur `description:`**, une friction qui revient dans **plusieurs
projets distincts** (§ Critère de récurrence) — sans présupposer la portée d'un
candidat, qui n'est **pas** dans son frontmatter (§ Lecture en deux temps). Ce n'est
qu'**après** avoir trouvé un appariement, corps chargé, que le scan retient pour
re-routage les candidats de portée `project` : un candidat déjà de portée globale
(Étape 1 point 3, pool `$HOME/.claude/memory/candidates/`) n'est jamais une cible
du scan, il est déjà à sa place.

### Critère de récurrence

Deux candidats « se répètent » quand un agent, lisant leurs `description:`, juge
qu'ils décrivent la **même friction**. La correspondance exacte du slug `name:` est
écartée : deux sessions qui rencontrent la même friction ne la nomment presque
jamais pareil.

⚠️ **Le seuil se compte en projets DISTINCTS, pas en pools ni en occurrences.** Un
même projet peut porter **plusieurs clés** — un checkout principal et chacun de ses
worktrees en ont une (§ Pré-requis, ⚠️ « chaque worktree porte sa propre clé »).
**Replier les clés d'un même projet avant de compter** : une clé de worktree se
reconnaît au motif `--claude-worktrees-…` qui suffixe la clé de son checkout
principal (ex. `C--Users-gibou-backlog-cli--claude-worktrees-blg-11-…` replie sur
`C--Users-gibou-backlog-cli`). Trois candidats qui décrivent la même friction mais
vivent tous dans des clés d'un **même** projet (une fois repliées) ne déclenchent
**aucun** re-routage : c'est une friction de CE projet, elle est déjà au bon endroit.
Il en faut **deux dans deux projets distincts**, après repli.

### Lecture en deux temps

La passe de corrélation ne lit que `name:` et `description:` de chaque candidat — la
**portée** (`project` ou de portée globale) n'est **pas** un champ de frontmatter,
c'est une ligne du **corps** (cf. Étape 1 point 1), donc elle n'est **pas**
disponible à ce stade. Le **corps** n'est chargé que pour les candidats
effectivement **appariés** (≥ 2 projets distincts sur la même friction) — le coût
suit le nombre de correspondances, pas la taille du pool.

C'est seulement une fois le corps chargé, pour un appariement confirmé, que le scan
lit la portée pour décider qui re-router : `project` → cible du re-routage,
`global` → déjà à sa place, ignoré. ⚠️ **Un candidat sans aucune ligne de portée dans
le corps** (capture antérieure à cette convention) **se traite comme `project`**
implicite — l'absence de tag n'est pas un signal d'exclusion, c'est l'état par
défaut de la convention de capture (CLAUDE.md § Mémoire).

### Dossiers orphelins

Le scan vérifie que le chemin du projet (encodé dans la clé `projects/<clé>/memory/`)
existe encore sur disque.

⚠️ **Ce décodage n'est pas inversible sans ambiguïté** : le séparateur de chemin
(`\`/`/`) et un tiret littéral d'un nom de projet (`backlog-cli`) s'écrivent tous
deux `-` dans la clé (le `.` l'est aussi — `.claude` devient `-claude`). Ne **pas**
décoder mécaniquement une seule interprétation et conclure : **générer toutes les
interprétations plausibles** de la clé (chaque `-` interne peut être un séparateur
ou un tiret littéral) et vérifier **chacune** sur disque.

- **Au moins une interprétation existe** → le projet n'est **pas** orphelin, quelle
  que soit l'ambiguïté restante ; il compte normalement pour D3.
- **Aucune interprétation n'existe** → orphelin : **écarté du comptage**, et le
  rapport **nomme les dossiers écartés** — un scan qui saute des données en silence
  est indiscernable d'un scan qui n'en a pas trouvé.

Le doute profite toujours au projet vivant : écarter à tort un pool réel (ex.
`backlog-cli` mal décodé en `backlog/cli`) romprait le seuil D3 pour toute friction
dont une occurrence y vit — plus coûteux qu'un faux négatif d'orphelin.

### Le scan propose, il ne déplace rien

Le re-routage `project` → `global` est une **proposition**, soumise au § Étape 5
« Proposer, pas agir » (qui l'autorise nommément comme effet de bord, § Étape 5) et
au § Récap avant effets de bord ci-dessous — **exactement la même discipline d'aval
au cas par cas**.

⛔ **Aucun déplacement de fichier sans validation explicite.** Le geste écrit dans le
dossier mémoire d'un **autre projet** que celui de la session — la seule écriture
hors-projet de tout ce dispositif.

Une fois validé, le re-routage **déplace** le fichier vers le chemin absolu
`$HOME/.claude/memory/candidates/` (il ne le **copie pas**) : un candidat dupliqué
compterait deux fois au prochain passage. Le déplacement met aussi à jour la ligne
de **portée** du corps du fichier déplacé, de `project` à `global` — sans cette mise
à jour, le fichier vivrait dans le pool global en se déclarant toujours `project`,
et la lecture au prochain `/reflect` (Étape 1 point 3, qui le traite comme un
candidat `global`) contredirait le corps.

---

## Récap avant effets de bord

Avant **toute** promotion, création de ticket, purge ou re-routage, afficher les
propositions et demander l'aval — **au cas par cas**, pas un « tout ou rien ».

### Récap — mode normal (Étapes 1 à 6)

Les deux populations (D2) sont comptées **séparément**, jamais agrégées dans une
seule ligne :

```
Passe /reflect — projet <clé> :
  Candidats lus (pool projet) : <n_p>
  Candidats lus (pool global) : <n_g>
  Clusters (pool projet)      : <c_p>
  Clusters (pool global)      : <c_g>
  Patterns (≥ 2)  :
    - « … » ×<k>  [pool projet|pool global]  → domicile <mémoire|SKILL-NN|ticket projet|CLAUDE.md>  → <action>
    - …
  Artefacts n=1   : <a>  (laissés à mûrir / proposés à la purge)

Pour chaque proposition : promouvoir / ouvrir le ticket / passer ? (au cas par cas)
```

### Récap — mode scan cross-projet

```
Scan cross-projet — <p> projets lus, <o> écartés (orphelins) :
  Dossiers écartés          : <clé1>, <clé2>, …   (§ Dossiers orphelins — nommés, jamais tus)
  Correspondances (≥ 2 projets distincts) :
    - « … » (projets : <projA>, <projB>, …)  → re-router <fichier> vers $HOME/.claude/memory/candidates/
    - …

Pour chaque re-routage proposé : valider / passer ? (au cas par cas — aucun déplacement sans validation, D6)
```

Ne rien graver tant que l'utilisateur n'a pas tranché ligne par ligne, dans les
deux modes. Une passe qui ne trouve aucun pattern ≥ 2 (ni aucune correspondance
cross-projet en mode scan) est un **résultat valide** : le dire, ne rien forcer.

---

## Règles strictes

- **Propose, ne grave pas de règle de workflow.** Aucune modification directe d'un
  skill, de `CLAUDE.md` ou du code : `/reflect` ouvre un ticket, le SDD normal
  dispose. Les seuls effets de bord autorisés (après aval) sont la promotion d'un
  candidat en mémoire durable, la création d'un ticket `maturing`, et — en mode scan
  cross-projet uniquement, après validation — le déplacement d'un candidat re-routé
  (D6, SKILL-20).
- **Jamais graver sur `n=1`.** Le seuil `≥ 2` n'est pas négociable : c'est le
  garde-fou qui empêche un système jeune d'osciller.
- **Jamais de purge silencieuse.** Retirer un candidat n=1 exige l'aval explicite.
- **Mode projet + pool global, tous deux actifs par défaut.** Le scan cross-projet
  (SKILL-20), lui, reste un **mode explicite** — jamais le déclenchement d'un
  `/reflect` de routine — et **ne déplace rien sans validation** (§ Scan cross-projet
  ci-dessus).
- `/reflect` **ne capture pas** de candidats — c'est la convention SKILL-17 et le
  comportement de l'orchestrateur en fin de chunk. Ce skill ne fait que **miner**.
