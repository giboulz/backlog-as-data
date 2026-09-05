# /mature [ID...] — Maturer un lot de tickets (« mature la première vague », « mature le 15 », « ok pour les 3, mature le ») : escalades d'abord, méthode, puis triplet

Maturer, c'est l'**étape 1 du SDD** : rédiger § Portée, § Tests et § Vérification
d'un ticket, puis poser son triplet `model` / `effort` / `review`. Ce skill est la
**prémisse de `/sdd-run-ticket`** — un ticket qui ne l'a pas traversé reste
`maturing`, et `/sdd-run-ticket` s'arrête dessus.

Son unité est le **lot**, pas le ticket. La maturation arrive presque toujours en
**milieu de conversation**, sur plusieurs tickets d'un coup, en amont d'un
`/sdd-run-ticket` lancé ailleurs : « mature la première vague », « on mature le
ticket 15 », « ok pour les 3, mature le ».

Refermer une escalade **E1**, c'est **re-maturer** : même méthode, même gate. D'où
un seul verbe et pas deux — le skill lit `escalations` de lui-même et bascule en
arbitrage sans qu'on le lui demande.

Il est **générique**, comme `/reflect` et `/sdd-run-ticket` : aucun projet n'est
écrit en dur ici. ⚠️ Contrairement à `/reflect`, il ne présume **pas** que le
dépôt cible est celui de la session — le cas nominal est même l'inverse (un
`SKILL-NN` vit dans `$HOME/.claude`, quel que soit le dépôt d'où l'on mature) :
c'est `preflight resolve` (§ Étape 1) qui tranche, jamais une hypothèse tacite.

**Substitutions** — les valeurs que TOI, orchestrateur, résous avant d'exécuter une
commande : `<RACINE_CIBLE>` la racine absolue du **dépôt qui possède le ticket**,
résolue par `preflight resolve` (§ Étape 1) — jamais présumée égale au dépôt de la
session ; `<RACINE_SESSION>` la valeur de `--session-root`, distincte de la cible et
jamais confondue avec elle ; `<TICKET-ID>`
l'id d'un ticket **du lot**, celui qui **porte** l'escalade ; `<TICKET_TRAITANT>`
l'id du ticket qui **traite** une escalade, souvent hors du lot ; `<TAG_ESCALADE>`
le tag de grammaire d'une escalade (`E1` ou `E3`, avec son `(finding N)`) ;
`<MODELE>`, `<EFFORT>` et `<REVUE>` les trois valeurs du triplet ;
`<DATE_DU_JOUR>` la date du jour au format AAAA-MM-JJ ; `<NOUVEL_ID>` et
`<TITRE_TICKET>` l'id et le titre du `SKILL-NN` ouvert par le **régime (d)**
(§ Étape 4) ; `<NOUVEL_ID_TRAITANT>` et `<TITRE_TICKET_TRAITANT>` l'id et le titre
du **ticket traitant** ouvert par l'arbitrage (§ Étape 4) — un trou **distinct**
de `<NOUVEL_ID>`, précisément parce que les deux régimes peuvent coexister dans la
même passe (une escalade fermée en (d), une autre fermée par un ticket traitant) :
partager un seul trou entre deux `new` réels de la même passe grave le mauvais id
dans un `--by`. Quand l'origine est « ticket traitant », `<NOUVEL_ID_TRAITANT>`
**est** la valeur passée ensuite en `--by` ; `<DEPOT_OUVERTURE>` le dépôt où le
`new` correspondant a effectivement écrit — **toujours** `$HOME/.claude` pour le
régime (d), le dépôt du **livrable** (souvent `<RACINE_CIBLE>`, pas
systématiquement `$HOME/.claude`) pour un ticket traitant ; cette définition est
la **seule** que ce skill pose sur « où le `new` écrit » — les sections qui suivent
y renvoient, elles ne la redisent pas ; `<LENTILLE>` la lentille assignée à un challenger de l'Étape 5.5 (archi ·
sceptique · découpage/séquencement) ; `<CHEMIN_SPEC>` le chemin **absolu** de la
spec d'un ticket du lot, lu du champ `absoluteSpecPath` du JSON de `resolve`
(§ Étape 1) — jamais retapé ni redéduit contre le dépôt de la session ;
`<CHEMINS_SPECS>` l'ensemble des `<CHEMIN_SPEC>` de tout le lot, passés au
challenger de l'Étape 5.5 ; `<IDS_LOT>`
les ids **de tout le lot**, séparés par des virgules (ex. `SKILL-98,SKILL-99`) —
distinct de `<TICKET-ID>` (un seul id), utilisé dans la `description` du spawn
de l'Étape 5.5 puisque chaque challenger y couvre le lot **entier**, jamais un
seul ticket.

⛔ Aucun de ces trous n'a de valeur par défaut, et **l'outil n'en rejette aucun** :
un `<NOUVEL_ID>` laissé tel quel crée un ticket bien réel. Résous-les avant
d'exécuter — les commandes ci-dessous sont recopiables, pas exécutables en l'état.

---

## Pré-requis

Deux résolutions, l'une et l'autre par `homedir()` — jamais un tilde littéral, que
PowerShell (le shell par défaut) n'expanse pas dans un argument.

**L'outil backlog global** (il opère sur le dépôt dans lequel il est invoqué —
`cd "<RACINE_CIBLE>" && …` dans les commandes de ce skill, **pas** nécessairement
celui de la session ; et no-op de lui-même dans un dépôt sans `backlog.json` /
`specs/`) :

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
[ -f "$TOOL" ] || echo "✗ outil backlog absent — réinstalle le bundle (self-update)"
```

Absent → **stopper**. Dans les commandes de ce skill l'outil est écrit sous sa forme
portable équivalente, `"$HOME/.claude/tools/backlog/backlog.mjs"`, recopiable telle
quelle.

**Le fichier de méthode** — `rules/maturation.md` du dépôt de config globale, dont
l'Étape 5 ordonne la lecture :

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','rules','maturation.md'))"
```

---

## Arguments

- **`/mature <ID...>`** — un ou **plusieurs** ids séparés par des espaces
  (`/mature SKILL-98 SKILL-99`). Le lot est traité **dans l'ordre donné**.
- **Sans argument** — le skill **propose** la liste des tickets dont la conversation
  vient de parler, et ne mute rien avant le récap. Il ne devine **jamais** un lot
  depuis le backlog : « tous les `maturing` » n'est pas ce que l'utilisateur a dit.
- **`--repo <chemin>`** — **optionnel**. Racine du dépôt qui possède le lot, quand
  ce n'est ni la session ni le dépôt harnais (`$HOME/.claude`). Passé **verbatim**
  à chaque appel `preflight resolve` (§ Étape 1), même sémantique que chez
  `/sdd-run-ticket` : présent, il désactive la recherche et l'outil ne scanne que
  cette racine.

Un id introuvable dans **aucune** des racines scannées fait **stopper** le lot
entier, sans toucher au reste — un lot n'est jamais exécuté à moitié en silence.
Le message n'est plus rédigé par ce skill : c'est celui que `preflight resolve`
compose lui-même (§ Étape 1), qui nomme les racines réellement scannées.

---

## Étape 1 — Constituer le lot

La résolution du dépôt cible n'est **jamais présumée** : pour **chaque** id du
lot, avant tout autre appel, elle passe par le verbe `resolve` de
`tools/sdd/preflight.mjs` — le même outil que `/sdd-run-ticket` appelle à son
Étape 1. ⛔ Ne rien recoder : c'est le point de la manœuvre.

```bash
PREFLIGHT="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','sdd','preflight.mjs'))")"
SESSION_ROOT="$(git rev-parse --show-toplevel)"
node "$PREFLIGHT" resolve --ticket "<TICKET-ID>" --session-root "$SESSION_ROOT"
```

`$SESSION_ROOT` porte `<RACINE_SESSION>` — jamais confondue avec `<RACINE_CIBLE>`
ci-dessous : un lot peut être maturé depuis un dépôt et vivre dans un autre.

⛔ **`git rev-parse --show-toplevel` peut échouer** — session ouverte hors d'un
dépôt git. `resolve` exige `--session-root` et sort en **code 2** sans lui
(« Arguments requis manquants »). Dans ce cas : **stopper**, dire que le lot
n'est pas résoluble hors d'un dépôt git, et ne pas fabriquer une racine de
repli.

Si l'utilisateur a fourni le drapeau `--repo` (§ Arguments), ajoute-le
**verbatim** à chaque appel `resolve` : l'outil ne cherchera **que** cette
racine.

`resolve` sort en **code non nul** avec un message que **lui-même** compose
(racines réellement scannées, drapeau `--repo`) quand l'id est introuvable. Dans
ce cas : **relaie ce message tel quel et stoppe** — même contrat que
`/sdd-run-ticket` § Étape 1. Le gabarit d'arrêt qu'écrivait ce skill a disparu
(§ Arguments) : une seconde formulation du même arrêt diverge dès que
`preflight` change la sienne.

**Un lot est mono-dépôt.** Compare `targetRoot` entre tous les ids du lot une
fois chacun résolu. S'ils ne rendent pas tous le même `targetRoot` : **stopper**
en nommant les deux racines et les ids qui les portent, sans rien muter. Deux
invocations successives, une par dépôt, sont l'issue — ne mélange jamais deux
dépôts dans le même lot.

Le lot une fois résolu dans une racine unique, `<RACINE_CIBLE>` désigne cette
racine (le champ `targetRoot` du JSON) pour le reste du skill. Le champ
`absoluteSpecPath` du même JSON donne `<CHEMIN_SPEC>` — le chemin **absolu** de
la spec de CE ticket : c'est lui qui ouvre le fichier plus bas et à l'Étape 5,
jamais un chemin retapé sous `specs/` du dépôt de la session, ni du dépôt cible
en le redéduisant à la main.

Trois champs du JSON sont des **pièges** pour `/mature` — taillé pour
`/sdd-run-ticket`, il ne les lit **pas**, sciemment :

| Champ | Pourquoi `/mature` l'ignore |
|---|---|
| `guards.specOnMain` | vrai seulement si la spec est sur `main` **et** son statut y vaut `todo\|wip`. Un ticket `maturing` — l'entrée normale de `/mature` — le rend **false** : le lire comme une gate refuserait chaque ticket à maturer |
| `guards.statusGate` | rend `already-shipped` sur une re-maturation, régime que `/mature` admet explicitement (ci-dessous). Le lire comme une gate casserait la fermeture d'escalade |
| `review` | `resolve` pose le défaut `light` **dans le consommateur**, pas dans la donnée : un ticket sans `review` rend `light` comme s'il en portait un. `/mature` **pose** le triplet (§ Étape 6), il ne le lit pas — s'en servir ferait passer une valeur fabriquée pour une donnée |

Le lot résolu, **afficher** ce qu'il contient, ne **rien** muter. Pour chacun,
lire sa spec — le fichier à `<CHEMIN_SPEC>`, jamais un chemin reconstruit à la
main — en entier (frontmatter **et** corps) et son statut :

```bash
cd "<RACINE_CIBLE>" && node "$HOME/.claude/tools/backlog/backlog.mjs" list
```

Un ticket déjà `todo` ou plus avancé n'est pas une erreur : il se **re-mature**
(c'est le cas d'une escalade à refermer). Le dire dans le récap, ne pas le retirer
du lot en silence.

⚠️ **`parked`/`wont` — statut vu ici, mais rien à poser.** Un ticket dans ce statut
suit le régime `parked`/`wont` de l'Étape 6 (STOP, engagement pas maturable en
l'état) : ne lui applique **aucune** mutation des Étapes 4, 5 et 5.5 (pas de
`escalations close`, pas de corps de spec réécrit, pas de `## Challenge`) — la
barrière du § Récap ne doit jamais annoncer d'effets de bord pour lui, et ce
ticket n'entre dans le récap que pour signaler l'arrêt.

---

## Étape 2 — Escalades d'abord

**Inconditionnel**, et **avant** l'Étape 5 comme avant tout appel à `mature` — y
compris quand l'utilisateur n'a parlé que de maturation :

```bash
cd "<RACINE_CIBLE>" && node "$HOME/.claude/tools/backlog/backlog.mjs" escalations
```

⚠️ `escalations` **imprime toujours quelque chose**, et **toujours en exit 0** : ne
branche ni sur une stdout muette ni sur le code de retour, mais sur ce qu'il dit.

- `aucune escalade ouverte.` → rien n'est ouvert dans ce projet : **sauter les
  Étapes 3 et 4**.
- « ce dossier n'est pas un projet backlog … » → **stopper** : le lot n'est pas
  résoluble ici. C'est un échec, malgré l'exit 0.
- une ou plusieurs lignes de la forme `ID · fichier:ligne · titre` →
  **intersecter avec le lot**. Si l'intersection ne retient rien, **sauter les
  Étapes 3 et 4** en le disant. Sinon, seules les escalades des ids **du lot**
  basculent en arbitrage ; celles des autres tickets sont **signalées et non
  traitées** — le lot est ce que l'utilisateur a nommé, pas ce que l'outil a trouvé.

---

## Étape 3 — Arbitrage

Une escalade à la fois, **trois blocs, dans cet ordre** :

1. **Le problème** — ce que l'escalade constate, avec **ce qui le prouve** :
   fichier, ligne, citation, repris de l'entrée `###` de la spec. Jamais un résumé
   de mémoire.
2. **Les options** — les issues possibles, chacune **avec son coût**.
3. **La préco** — ton choix, en **une** phrase, et pourquoi.

Puis **attendre**. Tu rends la main et tu ne refermes **rien** tant que
l'utilisateur n'a pas tranché : c'est le **seul point d'arrêt bloquant** de ce
skill, et il n'a **aucun défaut implicite** — contrairement au récap de fin, dont le
défaut est « oui ».

---

## Étape 4 — Gate de fermeture

⛔ **Pas de `escalations close` sans ce que la colonne de droite exige** — et rien
de tout ce qui suit avant l'aval du **§ Récap avant effets de bord** : fermer une
escalade grave un marqueur dans une spec, c'est une mutation comme les autres.

| Régime | Exigé AVANT `escalations close` |
|---|---|
| (a) **E1** dont la cause est une **clause fausse de la spec** | la **ligne de diagnostic** écrite dans l'entrée `###` concernée : **un numéro (1 à 7)**, ou **`aucun`** |
| (b) **E1** qui conteste une **décision produit** (pas une clause fausse) | l'arbitrage écrit dans l'entrée, **pas** de diagnostic : la méthode n'est pas en cause |
| (c) **E3** — la correction cassait un test vert | l'arbitrage écrit dans l'entrée, **pas** de diagnostic, même raison qu'en (b) |
| (d) réponse **`aucun`** en (a) | **en plus** : un ticket `SKILL-NN` ouvert sur la méthode, son id **cité dans la même ligne**, **avant** le `close` (ci-dessous) |
| (e) escalade **déjà close** (visible en `escalations --all`) | **ne rien faire** : ne pas re-fermer, ne pas ré-écrire son marqueur |
| tout régime où l'arbitrage produit du **travail** (le cas fréquent en (b), parfois en (a)/(c)) | **en plus** : le **ticket traitant** ouvert (ci-dessous), son id connu, **avant** le `close` — même contrainte d'ordre qu'en (d) : l'outil grave `--by` verbatim sans validation, un id pas encore attribué grave un ticket qui n'existe pas |

En (a), (b) et (c), si la ligne manque, **ne la fabrique pas** : demande-la par le
format de l'Étape 3, écris ce que l'utilisateur tranche, puis ferme.

**Où l'écrire** : dans l'entrée `###` concernée de la section `## Escalades (D10)`
de la spec du ticket, en édition de **corps** — le frontmatter reste muté
exclusivement par l'outil, et l'insertion du marqueur de fermeture appartient au
verbe :

```bash
cd "<RACINE_CIBLE>" && node "$HOME/.claude/tools/backlog/backlog.mjs" escalations close "<TICKET-ID>" --by "<TICKET_TRAITANT>" --date "<DATE_DU_JOUR>" --which "<TAG_ESCALADE>"
```

⛔ **Le positionnel et `--by` ne sont pas la même valeur.** Le positionnel est le
ticket **porteur** de l'escalade — il est dans le lot. `<TICKET_TRAITANT>` est celui
qui la **traite**, souvent le ticket **suivant**, donc souvent hors lot. L'outil
grave `--by` **verbatim** dans le marqueur `→ Traitée par …` sans rien valider :
lui passer le porteur par réflexe rend un ticket « traité par lui-même », en exit 0,
et perd la seule traçabilité que ce marqueur existe pour porter.

`--which` est **requis** dès qu'un ticket porte plus d'une escalade — sans lui la
cible est ambiguë. ⚠️ Sa valeur n'est **pas** la ligne qu'affiche `escalations` :
cette ligne se lit `ID · fichier:ligne · titre entier`, alors que `--which` compare
le **tag de grammaire** en tête du titre (`E1`, `E3`, avec son `(finding N)`). Le
titre entier n'est la bonne valeur que dans le cas dédupliqué — deux escalades du
même ticket au même tag. Dans le doute, et seulement là où `--which` est requis
(plus d'une escalade, donc refus garanti), lance le `close` sans lui : l'outil
refuse **en listant les tags disponibles**, et c'est cette liste qu'on recopie.

### Régime (d) — l'id du `SKILL-NN` est alloué au moment de l'ouverture

⛔ **N'invente aucun id, et n'en pré-écris aucun** : surtout pas dérivé d'un `list`
lu plus tôt dans la conversation — entre les deux, une session parallèle peut avoir
pris le numéro, et l'attente bloquante de l'Étape 3 rend ce délai arbitrairement
long. Constate le **prochain libre** juste avant d'appeler `new`, jamais avant
l'arbitrage.

```bash
cd "$HOME/.claude" && ls specs/skill-*.md | sort -V | tail -3
cd "$HOME/.claude" && node tools/backlog/backlog.mjs new "<NOUVEL_ID>" --title "<TITRE_TICKET>" --priority should
```

⚠️ **`<NOUVEL_ID>` est un trou, pas une valeur.** L'outil accepte n'importe quel
identifiant bien formé et créerait, ici, un ticket réel dans le checkout **live** de
la config globale — celui que le harnais a chargé pendant que tu travailles.

`new` refuse de trois façons, et **une seule** propose une issue :

| Refus | Ce que tu fais |
|---|---|
| `… existe déjà sur main — prochain id libre : …` | **reprends l'id qu'il propose**, sans incrémenter de toi-même |
| `… existe déjà` — un ticket du dépôt porte cet id | **re-constate** le prochain libre, puis rejoue `new` : aucun id n'est proposé ici |
| `… existe déjà sur le disque` — le fichier existe sans ticket découvert | idem : **re-constate**, puis rejoue |

Dans les deux derniers cas l'outil ne propose rien, et « re-constater puis rejouer »
est l'issue — elle ne contredit pas l'interdit ci-dessus, puisque c'est encore
l'outil qui arbitre, jamais un compteur mental.

C'est la **seule mutation du régime (d)** dont la cible est **fixe** (toujours
`$HOME/.claude`, jamais `<RACINE_CIBLE>`) — `<DEPOT_OUVERTURE>` en donne la
définition unique (§ Substitutions), reprise ici sans être redite. Elle laisse
**trois** artefacts non commités dans `$HOME/.claude` — le § Récap dit lesquels.
Le bloc de constat d'id ci-dessus (`ls specs/skill-*.md`) est lui aussi **borné
au régime (d)** : c'est un motif de nom propre à `$HOME/.claude`, pas au dépôt du
ticket traitant ci-dessous.

### Le ticket traitant — ouvert par l'arbitrage, pas par une gate

Quand l'arbitrage de l'Étape 3 produit du **travail** plutôt qu'une simple
fermeture, le `--by` de `escalations close` ci-dessus désigne un ticket qui
n'existe pas encore. Il s'ouvre par `new`, **avant** le `close` (colonne de
droite du tableau ci-dessus) et **avec la même discipline d'allocation d'id que
le régime (d)** (constat du prochain libre juste avant l'appel, reprise de l'id
proposé en cas de refus), sous les placeholders `<NOUVEL_ID_TRAITANT>` /
`<TITRE_TICKET_TRAITANT>` — distincts de `<NOUVEL_ID>` / `<TITRE_TICKET>` du
régime (d), pour la raison donnée au § Substitutions : les deux `new` peuvent
coexister dans la même passe. Sa cible n'est **pas** fixe : `<DEPOT_OUVERTURE>`
en donne la définition (§ Substitutions) ; le prochain id libre se constate
**dans ce dépôt-là**, sur son propre motif de nom.

⛔ Ce ticket-là **n'est pas** le `SKILL-NN` du régime (d) : il n'est exigé par
**aucune** gate, il est **choisi** par l'arbitrage. Les deux peuvent coexister
dans une même passe — une escalade fermée en (d) faute de diagnostic, une autre
fermée par un ticket traitant qui porte la correction — et le § Récap montre
alors les deux lignes.

---

## Étape 5 — Maturer

Rédiger les sections de la spec de chaque ticket du lot **selon la méthode**, qui
vit dans `rules/maturation.md` du dépôt de config globale (chemin résolu au
§ Pré-requis).

**Toutes** les sections scaffoldées, pas trois : le backlog a deux `kind`. Un
`feature` porte § Portée, § Tests et § Vérification ; un **`bug`** porte en plus
§ Symptôme, § Cause racine et § Correction attendue — et un projet peut surcharger
cette liste par son `.claude/ticket-sections.json`. Chaque section arrive sous le
placeholder `_(à remplir)_` : **aucun ne doit subsister** à la fin de l'étape. C'est
le seul signal mécanique qu'une section n'a pas été rédigée, et rien en aval ne le
rattrape — l'Étape 6 promeut sans jamais lire le corps.

⛔ **Ces écritures de corps de spec sont des mutations**, et les plus lourdes du
skill : elles attendent l'aval du **§ Récap avant effets de bord** au même titre
que les appels CLI. Aucun CLI ne les rejouera.

⚠️ **Ouvre le fichier de méthode et lis-le.** Ne présume **jamais** qu'il est déjà
chargé : la règle est path-scopée sur `specs/**/*.md` **relativement au répertoire
d'où la session a été lancée**, donc elle ne s'injecte pas quand on mature depuis un
autre dépôt — le cas nominal de ce skill.

⛔ **Rien de LA MÉTHODE** (`rules/maturation.md` — ses sept contrôles, son
rituel de fermeture d'escalade, son échelle de choix du modèle) **n'est recopié
dans ce skill**. La seule reprise assumée est la question fermée du tableau de
l'Étape 4 — une gate ne peut pas bloquer sur une exigence qu'elle n'énonce pas
—, et elle renvoie à `rules/maturation.md`, qui en reste le domicile. Partout
ailleurs, pour LA MÉTHODE spécifiquement : un seul domicile, parce qu'une
seconde copie diverge en silence et que deux textes périmés du même périmé
s'accordent parfaitement. ⚠️ Cet absolu ne porte QUE sur `rules/maturation.md` —
il ne dit rien du sous-titre suivant, qui hérite d'un skill DIFFÉRENT
(SKILL-57, désormais caduc), pas de la méthode.

### Deux conventions héritées d'un skill d'orchestration désormais caduc (SKILL-99)

Elles s'appliquent dès que rédiger une section fait apparaître l'une de ces deux
situations — pas à chaque maturation, mais dès que la situation se présente :

**Spec livrée = compte rendu daté, pas contrat vivant.** Une spec dont le ticket
est `merged`/`shipped` enregistre l'arbitrage pris à sa date ; elle ne prescrit
plus (le code et les tests sont le contrat vivant). Quand un ticket **supersède**
une décision d'une spec livrée, il pose un **bandeau d'une ligne en tête de la
section supersédée**, nommant le ticket qui la remplace — jamais une mention
lointaine, et il ne réécrit pas la section.

**Fichier de test neuf = nommé d'après son sujet, jamais d'après un ticket.** Le
fichier survit au ticket qui le crée ; un numéro de ticket lui ôterait tout
domicile pour le prochain ticket sur le même sujet. Si ce dépôt réserve un
fichier de test aux plafonds de taille (ex.
`__tests__/skill-size-ceiling-coherence.test.js` dans `claude-config`), il
reste réservé aux plafonds — n'y mêle pas des assertions de prose. Le § Portée
que tu rédiges à cette même étape **nomme** ce fichier neuf.

⛔ **Le bandeau de supersession et le nommage du fichier de test sont, eux
aussi, des mutations** : elles attendent le même aval du **§ Récap avant effets
de bord** que les écritures de corps de spec ci-dessus.

---

## Étape 5.5 — Challenge (dosage puis spawn)

Repris d'un skill d'orchestration désormais caduc (SKILL-99) : la **barrière** et
le **challenger vierge**, en **dosage** — c'est-à-dire déclenchés selon la taille
du lot, pas systématiquement. Entre l'écriture des sections de spec (Étape 5) et
la pose du triplet (Étape 6).

### Barrière (critique)

**La barrière est ce qui rend le challenger utile.** Le challenger lit les
**fichiers de spec du lot** que l'Étape 5 vient d'écrire, et **jamais** le
transcript de la conversation de maturation. Toi, orchestrateur, tu as été
« vendu » par la conversation ; le challenger arrive **vierge** — exactement
comme les relecteurs de la gate de `/sdd-run-ticket` ne voient que le diff, pas
le raisonnement qui l'a produit. ⛔ **Rien de la conversation ne franchit la
barrière.** Le prompt du challenger (ci-dessous) ne contient **aucun** contenu de
la conversation : ni résumé, ni justification des choix, ni « où regarder ».

### Dosage — quatre cas, indexés sur la taille du LOT

Tu lis les signaux, tu **proposes** le cas dans le récap (§ Récap avant effets de
bord) ; l'utilisateur peut **override**.

| Cas | Nb | Lentilles | Déclencheurs |
|---|---|---|---|
| **0** | 0 | — | lot de **1 ou 2** tickets, **aucun** signal du cas 2 |
| **1** | 1 | archi + sceptique **combinées** | lot de **3 à 5** tickets, aucun signal du cas 2 |
| **2** | 2 | archi séparée · sceptique séparée | **au moins un** : multi-sous-systèmes · changement de schéma / modèle de données · gate ou dépendance externe · code déjà retiré ressuscité |
| **3** | 3 | archi · sceptique · **découpage/séquencement** | lot de **≥ 6** tickets |

Le **nombre de tickets du lot** est déterministe (c'est l'argument de `/mature`) ;
les signaux sémantiques restent **ton** read. La 3ᵉ lentille attrape le mode
d'échec distinct : cadrage juste, **ordre** faux. Un lot de **≥ 6** tickets qui
porte **aussi** un signal du cas 2 relève du cas 3, qui l'emporte : il inclut les
deux lentilles du cas 2 et y ajoute la troisième — sans cette phrase, les deux
lignes seraient vraies en même temps et laisseraient l'orchestrateur choisir.
**En cas 0, aucun challenger n'est spawné, et aucune section `## Challenge` n'est
créée** — une section vide dirait qu'un challenge a eu lieu (même défaut que la
section d'escalade fabriquée à vide, `/sdd-run-ticket` Étape 6.6.5).

### Spawn

Spawner **N challengers vierges**, **dans un seul message** — jamais un par un —
avec l'outil `Agent`, `subagent_type: "general-purpose"`, **sans `isolation`**
(lecture seule, ils ne committent rien), `run_in_background: false`, **aucune**
attente de notification (comme la gate de `/sdd-run-ticket`, Étape 6.3 : c'est le
regroupement en un seul message qui porte le parallélisme, pas le drapeau de
background — voir [`specs/skill-34.md`](../specs/skill-34.md), qui a déjà arbitré ce point pour la
gate) :

```
Agent({
  subagent_type: "general-purpose",
  run_in_background: false,
  description: "challenge <IDS_LOT> (<LENTILLE>)",
  prompt: <PROMPT_TEMPLATE>
})
```

Chaque challenger ne reçoit que : les **chemins** des specs du lot, la racine
projet et sa lentille. Recopie le **template figé** ci-dessous, verbatim,
placeholders substitués — **rien d'autre**.

### Template figé du prompt challenger

⚠️ Ce bloc est délimité par QUATRE backticks (il contient lui-même un extrait en
trois backticks). Ne mets **rien** de la conversation dedans.

````
Tu es un challenger VIERGE d'un lot de tickets maturés. Tu n'as PAS assisté à la
conversation de maturation, et c'est délibéré : ta valeur vient de ce que tu
arrives sans avoir été convaincu. Tu ne lis QUE les fichiers de spec listés
ci-dessous et le code du projet — jamais un transcript, jamais le contexte de la
conversation.

Specs du lot (à lire en entier) : <CHEMINS_SPECS>
Racine du projet : <RACINE_CIBLE>
Ta lentille : <LENTILLE>

Ta mission : attaquer § Portée, § Hors-scope, § Tests et § Vérification de CHAQUE
ticket du lot (plus § Symptôme, § Cause racine et § Correction attendue pour un
ticket `bug`), à travers ta lentille, plus la cohérence du lot entre ses tickets.
1. Lis chaque spec en entier, puis le code du projet réellement concerné (pas de
   supposition — va voir les fichiers cités ou impliqués).
2. Pour CHAQUE ticket, cherche le trou :
   - § Portée — couvre-t-elle le VRAI besoin, avec ses dépendances ?
   - § Hors-scope — honnête, ou un report déguisé qui reviendra mordre ?
   - § Tests — couvre-t-elle chaque fonction exportée, y compris orchestrateurs
     et scripts CLI ?
   - § Vérification — chaque commande citée est-elle rejouable telle quelle ?
   - Ticket `bug` : § Symptôme est-il constaté, pas supposé ? § Cause racine
     est-elle la vraie cause, ou un symptôme redit ? § Correction attendue
     couvre-t-elle la cause, pas seulement le symptôme ?
3. Chaque spec doit se tenir SEULE. Si une décision n'a de sens qu'avec un
   contexte que la spec ne porte pas, c'est un trou : signale-le.
4. Vérifie la cohérence ENTRE les tickets du lot : dépendances, ordre, doublons.

Rends des objections STRUCTURÉES, jamais une réécriture. Une ligne par objection :

```
- Ticket · Section visée · Objection (le trou, en une phrase) · Scénario (le cas concret où ça casse)
```

Si tu ne trouves rien sur une section, dis-le explicitement pour cette section —
« rien à signaler » est une information, pas un vide. Ne propose PAS de réécriture
de la spec : tu attaques, l'orchestrateur arbitre.
````

### Arbitrage — gardé, pas perdu avec la conversation

Présenter les objections **une à une**. Pour chacune, l'utilisateur arbitre :

- **objection juste** → **réviser** la section visée de la spec du ticket ;
- **objection à côté** → **défendre** (écrire la défense, pas la jeter).

Les deux issues atterrissent dans une section **`## Challenge`** appendée au corps
de la spec du ticket visé, sur le modèle de `## Escalades (D10)` : le frontmatter
reste muté exclusivement par l'outil. **Ne clore l'étape que lorsque chaque
objection a une issue écrite** dans `## Challenge`.

⛔ **Cette écriture est une mutation** : elle attend l'aval du
**§ Récap avant effets de bord**, au même titre que les appels CLI.

---

## Étape 6 — Poser le triplet

Le triplet se pose **par l'outil**, jamais par une édition à la main du
frontmatter, et la **date se passe explicitement** — le CLI n'invente jamais une
date (tu la connais par le contexte `currentDate` de la session) :

```bash
cd "<RACINE_CIBLE>" && node "$HOME/.claude/tools/backlog/backlog.mjs" mature "<TICKET-ID>" --model "<MODELE>" --effort "<EFFORT>" --review "<REVUE>" --date "<DATE_DU_JOUR>"
```

Un ticket du lot par appel **quand cet appel a lieu** (voir le régime ci-dessous),
et seulement une fois obtenu l'aval du **§ Récap avant effets de bord**. Les trois
vocabulaires et la doctrine « quand choisir `deep` » vivent chez `/backlog` ;
l'échelle de choix du modèle, dans `rules/maturation.md`. Ce skill n'en pose pas de
seconde copie.

### Régime de re-maturation — indexé sur le STATUT, pas sur le triplet

La promotion de statut, dont le § Récap dit ce qu'elle vaut, n'est **pas** le
prédicat de ce régime. Le prédicat qui déclenche l'appel est le **statut** du
ticket, pas « le triplet a-t-il changé » — un ticket
remis en `maturing` par un `set` de correction explicite porte parfois déjà un
triplet, et un `maturing` d'origine peut aussi bien ne pas en porter.

| Statut | Ce que fait l'Étape 6 |
|---|---|
| `maturing` | **appeler `mature`** — c'est la maturation nominale, qu'un triplet préexiste ou non |
| `todo` · `wip` · `merged` · `shipped`, **et** triplet à changer | **appeler `mature`** — le triplet est de la donnée, on le corrige ; le statut, lui, ne bougera pas |
| `todo` · `wip` · `merged` · `shipped`, **et** triplet identique | **ne pas appeler `mature`**, et le dire dans le récap — l'appel **réécrirait `matured`** à la date du jour, effaçant la date à laquelle le triplet a réellement été décidé |
| `parked` · `wont` | **stopper** et le dire : l'outil refuse (`exec: interdit pour le statut « … »`), l'invariant `exec` n'admettant le triplet que sur `todo`/`wip`/`merged`, et optionnellement `shipped`. Ces deux statuts sont un **engagement**, pas une étape de cycle : un ticket parqué se dé-parque (`set status=maturing`) avant d'être maturé, il ne se mature pas en place |

---

## Récap avant effets de bord

⚠️ **Cette section est une barrière, pas une conclusion.** Elle est écrite en
dernier parce que le lot et les arbitrages doivent être connus pour la remplir, mais
elle s'affiche **avant la première mutation, quelle qu'elle soit**. Les
Étapes 4, 5, 5.5 et 6 y renvoient et **ne mutent rien** tant qu'elle n'a pas eu son
aval : un récap affiché après coup ne protège de rien, répondre « non »
n'annulerait plus rien.

Elle énumère **les cinq mutations** que la suite produira :

1. la fermeture d'escalade — `escalations close`, qui grave un marqueur dans le
   corps d'une spec ;
2. l'ouverture du ticket du régime (d) — `new`, **toujours dans `$HOME/.claude`**,
   qui n'est « un autre dépôt » que si `<RACINE_CIBLE>` ne l'est pas déjà ;
3. l'ouverture du **ticket traitant** (§ Étape 4) — `new`, dans le dépôt de son
   livrable, quand l'arbitrage produit du travail plutôt qu'une simple fermeture ;
4. les écritures de **corps de spec** de l'Étape 5 (§ Portée, § Tests, § Vérification,
   plus les sections de diagnostic d'un `bug`), et l'écriture de la section
   `## Challenge` de l'Étape 5.5 quand le dosage n'est pas le cas 0 ;
5. la pose du triplet — `mature`, quand l'Étape 6 l'appelle réellement (voir le
   régime de l'Étape 6).

La ligne `Repo` — lue du champ `mode` de l'Étape 1 (`same-repo` / `cross-repo`) —
est le **seul** endroit où un changement de dépôt devient visible **avant** la
première mutation.

```
Maturation du lot :
  Repo       : <RACINE_CIBLE>   ← même dépôt que la session | ⚠️ CROSS-REPO
  Lot        : <TICKET-ID> « … »   (maturing)
               … une ligne par id résolu
  Escalades  : <TICKET-ID> · <TAG_ESCALADE> → ce que l'utilisateur a tranché
               traitée par : <TICKET_TRAITANT>
               hors lot, signalées et NON traitées : …
  Ouverture  : <NOUVEL_ID> « <TITRE_TICKET> » dans <DEPOT_OUVERTURE>   (régime (d))
               <NOUVEL_ID_TRAITANT> « <TITRE_TICKET_TRAITANT> » dans <DEPOT_OUVERTURE>   (ticket traitant)
               … une ligne par ticket EFFECTIVEMENT ouvert pendant la passe — au plus une par
               origine ; les deux régimes peuvent coexister, chacun avec son propre id
  Specs      : <TICKET-ID> → sections réécrites : …
  Challenge  : cas <0|1|2|3> → <n> challenger(s) vierge(s)
               signaux : <ce que tu as lu — taille du lot, schéma, code ressuscité, gate externe…>
  Triplet    : <TICKET-ID> → model <MODELE> · effort <EFFORT> · review <REVUE>
               | ⚠️ aucun appel — triplet déjà posé et inchangé
               | ⛔ STOP — statut <parked|wont> : engagement, pas maturable en l'état
               (voir le régime de l'Étape 6)

Procéder ? (oui / non — défaut oui)
```

Réponse explicitement `non` ou `n` → **arrêter**. Sinon **continuer** : un skill
invoqué explicitement ne redemande pas l'autorisation qu'il vient de recevoir.

⛔ **Ce skill ne commite pas** — et les dépôts à commiter se **dérivent**, jamais
une liste fermée à un nombre fixe : chaque `<DEPOT_OUVERTURE>` réellement utilisé
par une ligne `Ouverture` du récap ci-dessus en est un, en plus de `<RACINE_CIBLE>` :

- **`<RACINE_CIBLE>`** — où atterrissent TOUTES les mutations du lot : les corps
  de spec de l'Étape 5, la section `## Challenge` de l'Étape 5.5, le marqueur
  `escalations close` de l'Étape 4, la pose du triplet (`mature`, Étape 6),
  `backlog.json` et la vue `specs/backlog.md`. `<RACINE_CIBLE>` n'est **pas**
  forcément le dépôt de la session — c'est la ligne `Repo` du récap ci-dessus qui
  le dit ;
- **chaque `<DEPOT_OUVERTURE>` distinct de `<RACINE_CIBLE>`** — sa valeur pour
  chaque origine est celle du § Substitutions, pas redite ici ; elle peut être un
  **troisième** dépôt, distinct à la fois de `<RACINE_CIBLE>` et de
  `$HOME/.claude`. `new` y a écrit les mêmes trois artefacts (la spec,
  `backlog.json`, `specs/backlog.md`). Un dépôt ainsi ouvert et laissé sale perd
  le ticket au prochain `/sync` ou reset, et la ligne de diagnostic de
  `<RACINE_CIBLE>` citerait alors définitivement un id qui n'a jamais existé —
  exactement ce que le régime (d) sert à empêcher, et ce que le ticket traitant
  risque tout autant.

⚠️ **`mature` ne promeut que depuis `maturing`.** Un ticket re-maturé — le cas d'une
escalade refermée sur un ticket déjà `merged` — **garde son statut** : ne l'annonce
pas comme prêt à coder, `/sdd-run-ticket` le refuserait. Seuls les tickets qui
étaient `maturing` en ressortent en `todo`, et ceux-là sont l'entrée de
`/sdd-run-ticket <TICKET-ID>`, dont ce skill est la prémisse.
