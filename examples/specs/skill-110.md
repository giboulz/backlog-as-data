---
id: SKILL-110
title: SKILL-106 E1 finding 7 : bandeau d amendement sur la puce de specs/skill-27.md perimee par le renommage de l it
type: ticket
status: shipped
priority: should
exec:
  model: sonnet
  effort: medium
  review: deep
  matured: 2026-09-04
---

# SKILL-110 — Le bandeau d'amendement que SKILL-106 n'a pas pu poser

## Problème

`specs/skill-27.md` § Tests porte, dans la liste **L1.6 — ce qui doit SURVIVRE au
retrait**, la puce :

> - L'Étape 4.5 garde ses deux assertions de garde-fou, `guards.worktreeUnderTarget`
>   et `guards.worktreePathFree`. *Même mutation, même raison.*

C'est la transcription **verbatim** du titre de l'`it` que cette puce spécifie.
SKILL-106 a renommé ce titre (« deux » → « trois » assertions de garde-fou) en
ajoutant `guards.branchFree`. Depuis, un mainteneur qui part de cette puce et grep
le titre cité n'obtient **rien** :

```
cd "$HOME/.claude" && grep -rc "garde ses deux assertions de garde-fou" __tests__/
cd "$HOME/.claude" && grep -rn "assertions de garde-fou" __tests__/
```

Le premier rend **0** sur chaque fichier ; le second montre le titre courant, dans
`__tests__/commands-shape-coherence.test.js`, avec « trois ».

`specs/skill-27.md` est une **cinquième** section rendue fausse par le commit de
SKILL-106, traitée différemment des quatre qui ont reçu leur bandeau (SKILL-106
§ D4). ⚠️ Le compte d'assertions de la puce, lui, **reste exact** — le ticket en a
ajouté une, il n'en a retiré aucune. Ce qui est périmé est la **citation littérale**
du titre, et c'est elle que le lecteur grep.

Escalade d'origine : `specs/skill-106.md` § Escalades (D10), `E1 (finding 7)`, close
par ce ticket le 2026-09-04. Sa ligne de diagnostic est déjà écrite — **contrôle 4**,
« Relire ses propres clauses les unes contre les autres ».

## Décision

**D1 — Un bandeau d'amendement, adjacent à la puce, nommant SKILL-106.** Forme et
placement sont ceux que SKILL-106 § D4 a constatés sur le corpus et appliqués à ses
quatre points : un **paragraphe** `⚠️ **Amendée par [[SKILL-106]]**`, séparé par des
lignes vides, **jamais** un blockquote `>` (famille distincte des bandeaux de chemin
renommé, cf. `__tests__/helpers/legacy-path-policy.js`), **adjacent** au point amendé
et non en tête de section. Modèle en place, indenté à l'intérieur d'une puce :
`specs/skill-13.md`, bandeau `[[SKILL-44]]` sous la puce `determineMode`.

⚠️ **Déixis.** Le bandeau vit chez l'**amendé**, donc il **nomme l'amendeur** —
SKILL-106, le ticket dont le commit a renommé l'`it` — et **jamais** ce ticket-ci.
Écrire `[[SKILL-110]]` inverserait qui amende qui. C'est exactement le régime de
SKILL-86, qui a posé un bandeau `[[SKILL-85]]` sans se nommer.

⚠️ **Le bandeau ne recopie pas la locution amendée.** Il dit que le titre a été
renommé et donne le nouveau compte, sans réécrire « garde ses deux assertions de
garde-fou ». Raison mécanique, pas stylistique : `corpsIntact` (§ Tests) vérifie que
la locution d'origine est toujours là, et un bandeau qui la répète rendrait cette
assertion vraie **par construction**, même après réécriture de la puce — c'est le
finding 1 de la gate de reprise de SKILL-86, sur ce même mécanisme.

Le corps de la puce n'est pas réécrit : une spec livrée est un compte rendu daté.

**D2 — Le point s'ajoute à `escalade-arbitrage-bandeau-coherence.test.js`, pas à
`preflight-contract-bandeau-coherence.test.js`.** Les deux fichiers existent, tous
deux consomment le helper partagé `__tests__/helpers/bandeau-amendement.js`, et le
sujet de la puce (les garde-fous de `preflight.mjs`) pourrait plaider pour le second.
C'est le premier qui l'emporte, sur son propre en-tête : « Les bandeaux posés par
l'ARBITRAGE D'UNE ESCALADE — nommé d'après ce SUJET […] il survivra au prochain
arbitrage, qui y ajoutera ses lignes dans la table `POINTS` ci-dessous ». Ce bandeau
naît d'un arbitrage d'escalade ; c'est sa provenance qui le classe, et le fichier
invite nommément l'entrée. Corollaire : `preflight-contract-bandeau-coherence.test.js`
n'est **pas** touché, sa table `POINTS` ni sa map `contenus` non plus.

**D3 — Une contrainte de conception écrite dans l'en-tête tombe, et il faut le
dire.** L'en-tête de `escalade-arbitrage-bandeau-coherence.test.js` porte :

> ⚠️ AUCUNE mutation-témoin ne peut prouver que l'`amendeur` est lu PAR LIGNE :
> les quatre points nomment le même. C'est une contrainte de CONCEPTION […]
> ⛔ Ne pas fabriquer de point témoin pour la rendre falsifiable […]

Ce ticket ajoute un **cinquième** point dont l'`amendeur` est **SKILL-106**, pas
SKILL-105 : la contrainte disparaît, et la lecture par ligne devient falsifiable
(câbler `POINTS[0].amendeur` en dur rendrait ce point rouge). ⛔ **Ce n'est pas le
point témoin que le ⛔ interdit de fabriquer** : celui-là aurait été un point ajouté
*pour* rendre l'assertion falsifiable, et le ⛔ écarte un candidat précis
(`specs/skill-85.md` § D1, déjà couvert ailleurs et qui n'est pas un bandeau
d'arbitrage). Le point ajouté ici est **exigé par une escalade** ; la falsifiabilité
est un effet, pas un motif. L'en-tête est corrigé pour dire l'état réel, sinon il
devient à son tour une clause fausse — le défaut même que ce ticket répare.

## Portée

| Fichier | Ticket propriétaire | Geste |
|---|---|---|
| `specs/skill-27.md` | **SKILL-27** | bandeau `⚠️ **Amendée par [[SKILL-106]]**` adjacent à la puce Étape 4.5 de L1.6 (D1) — corps **non** réécrit |
| `__tests__/escalade-arbitrage-bandeau-coherence.test.js` | **SKILL-105** | une entrée dans `POINTS` (§ Tests) + le ⚠️/⛔ de l'en-tête corrigé (D3) |

**Rien d'autre.**

- Pas de `__tests__/preflight-contract-bandeau-coherence.test.js` (D2).
- Pas de `__tests__/commands-shape-coherence.test.js` : le titre de l'`it` est
  **correct** depuis SKILL-106 — c'est la citation qui est périmée, pas le titre. Le
  renommer à nouveau ferait mentir le test sur ce qu'il vérifie (issue 2 de
  l'escalade, écartée).
- Pas de `specs/skill-106.md` : sa dette propre (le § D4 cite `specs/skill-104.md`
  § D2 à l'état `wip`, clause que SKILL-105 § D3 a corrigée dans `specs/skill-86.md`
  mais pas ici) est **antérieure et indépendante** — elle existerait à l'identique si
  ce ticket n'existait pas. Constat :
  `grep -c "Amendée par \[\[SKILL-105\]\]" specs/skill-106.md` rend **0**. Écrite
  dans l'arbitrage de l'escalade, laissée ouverte.
- Pas de `__tests__/helpers/bandeau-amendement.js` : le helper exporte déjà tout ce
  qu'il faut (`texteBandeau`, `portesLeBandeauDe`) et son en-tête décrit exactement
  ce régime. Rien à promouvoir.

## Hors-scope

- **Une politique générale de test des bandeaux d'amendement.** Le § Hors-scope de
  `specs/skill-105.md` la refuse explicitement, et `specs/skill-104.md` § Défenses
  (défense B) a refusé de trancher ce corollaire. Ce ticket couvre **son** point et
  aucun bandeau existant.
- **L'unification des deux familles de bandeaux** (paragraphe `Amendée par` vs
  blockquote `>` des chemins renommés) — sujet déclaré de SKILL-88.
- **Les autres transcriptions verbatim de titres d'`it` dans les specs livrées.** Ce
  ticket ne fait pas l'inventaire du dépôt ; il traite le point que l'escalade nomme.

## Tests

`__tests__/escalade-arbitrage-bandeau-coherence.test.js` — **une** entrée dans la
table `POINTS`. La table est consommée par cinq familles d'`it.each` déjà écrites
(bandeau adjacent, renvoi, substance, corps non réécrit, déixis non inversée) : une
entrée rend donc cinq tests neufs, sans nouvelle famille. `contenus` est dérivé de
`POINTS` (`new Set(POINTS.map(p => p.fichier))`), il n'y a rien à y ajouter à la main.

L'entrée :

- `nom` — `specs/skill-27.md § Tests, L1.6 — puce Étape 4.5 (titre d'`it` transcrit)`
- `fichier` — `specs/skill-27.md` (constante neuve, à côté de `SKILL_101`/`SKILL_107`/`SKILL_86`/`SKILL_104`)
- `amendeur` — `SKILL-106` (D1), `specRenvoi` — `specs/skill-106.md`
- `startAnchor` — `- L'Étape 4.5 garde ses deux assertions de garde-fou`
- `endAnchor` — `- L'Étape 6.1 garde l'impératif`
- `sonde` — le bandeau nomme le **renommage** et le nouveau compte (`trois`)
- `corpsIntact` — après `platir`, la tranche contient la locution d'origine
  **entière** : ``L'Étape 4.5 garde ses deux assertions de garde-fou,
  `guards.worktreeUnderTarget` et `guards.worktreePathFree`. *Même mutation, même
  raison.*`` — la puce est enroulée sur deux lignes, donc comparaison en sous-chaîne
  **après aplatissement**, jamais une regex tolérante sur la tranche brute (finding 5
  de la gate SKILL-107, même mécanisme).

⚠️ **`startAnchor` doit couvrir ce que `corpsIntact` doit pouvoir voir disparaître** —
c'est la consigne de l'en-tête du fichier. Ici l'ancre de début **est** le début de la
locution vérifiée : réécrire la puce fait disparaître l'ancre, et `sectionEntre`
rougit alors avec son propre message (« l'une des deux ancres manque ») plutôt que
`corpsIntact`. Les deux rouges sont acceptables et distincts ; c'est écrit ici pour
qu'un relecteur ne le lise pas comme un trou.

**Mutations-témoins** (jouées une par une) :

1. Retirer le bandeau → rouge sur le point neuf **seul**, les quatre autres verts.
2. Le poser en tête du § Tests au lieu de la puce → rouge (l'ancre de début est la
   puce elle-même).
3. Vider le bandeau de sa substance en gardant `Amendée par [[SKILL-106]]` et le
   renvoi → rouge sur la **sonde** seule.
4. Écrire `[[SKILL-110]]` à la place de `[[SKILL-106]]` → rouge (déixis / amendeur).
5. **La mutation que ce ticket rend possible pour la première fois** : câbler
   l'amendeur en dur (`ID_105` au lieu de `point.amendeur`) dans l'`it.each` du
   bandeau → **rouge sur le point neuf**, alors que cette mutation était verte avant
   ce ticket (D3). C'est la mutation qui prouve que l'en-tête corrigé dit vrai.

**Non-régression, énumérée.**

- Les quatre points existants de `POINTS` : verts sans retouche, aucune de leurs
  ancres ni de leurs sondes n'est touchée.
- `__tests__/preflight-contract-bandeau-coherence.test.js` : vert, non touché (D2).
- `__tests__/amended-phrase-bandeau-coherence.test.js` (SKILL-81) : vert — il lit
  `specs/skill-13.md`, `skill-24.md`, `skill-70.md`, `skill-80.md`, pas
  `specs/skill-27.md`.
- `__tests__/mode-criterion-coherence.test.js:163` (déixis inversée, SKILL-50) :
  vert, la locution interdite n'est pas écrite.
- `__tests__/commands-shape-coherence.test.js` : vert, aucun titre d'`it` n'est
  touché.
- `__tests__/skill-size-ceiling-coherence.test.js` : vert — `specs/` n'est sous aucun
  plafond. Les **cinq** plafonds visent `commands/sdd-run-ticket.md`, `prompts/`,
  `steps/`, `CLAUDE.md` et `rules/`, et aucun autre. Constat :
  `grep -n "^const PLAFOND_" __tests__/skill-size-ceiling-coherence.test.js` (cinq
  lignes) et `grep -n "^const .*_DIR = \|^const .*_FILE = " __tests__/skill-size-ceiling-coherence.test.js`.

## Vérification

Depuis le worktree, après l'**Étape 0.5** (`node -e
"console.log(require.resolve('vitest/package.json'))"` ; sur ce dépôt les worktrees
vivent hors arborescence et `CLAUDE.md` documente `npm install` comme préalable
explicite) :

1. **Le bandeau est là, adjacent.** `grep -n -B4 -A4 "Amendée par \[\[SKILL-106\]\]"
   specs/skill-27.md` : le paragraphe est entre la puce Étape 4.5 et la puce
   Étape 6.1, séparé par des lignes vides.
2. **La déixis n'est pas inversée.** Le même extrait ne contient ni `[[SKILL-110]]`
   ni la locution `ce ticket amende`.
3. **Le corps n'est pas réécrit.**
   `grep -c "garde ses deux assertions de garde-fou" specs/skill-27.md` rend
   toujours **1**.
4. **La citation reste orpheline, et c'est voulu.**
   `grep -rc "garde ses deux assertions de garde-fou" __tests__/` rend toujours **0** :
   ce ticket ne renomme rien, il **signale**. C'est le bandeau qui répare le
   parcours du lecteur, pas le grep.
5. **Le point est dans la bonne table.**
   `grep -c "skill-27" __tests__/escalade-arbitrage-bandeau-coherence.test.js` ≥ 1 et
   `grep -c "skill-27" __tests__/preflight-contract-bandeau-coherence.test.js` rend
   **0**.
6. **L'en-tête ne porte plus la contrainte levée.**
   `grep -c "les quatre points nomment le même" __tests__/escalade-arbitrage-bandeau-coherence.test.js`
   rend **0**, et l'en-tête dit ce qui a changé et par quel ticket.
7. **Mutations-témoins.** Les cinq du § Tests, jouées une par une, constatées rouges
   avec le bon message, puis annulées. ⚠️ La cinquième se constate **aussi** dans
   l'autre sens : rejouée sur `git stash`-équivalent du fichier d'avant ce ticket,
   elle est verte — c'est la preuve que la contrainte de D3 existait bien.
8. **Suite complète.** `npm test` vert.

## Escalades (D10)

### E1 (finding 1) — le § Tests fait écrire dans `__tests__/` la locution que le § Vérification y exige absente

⚠️ **Deux sources pour le même défaut.** L'implémenteur l'a déclaré dans son rapport
de **première passe**, avant la gate ; les **trois** relecteurs l'ont ensuite remonté
indépendamment, et il est devenu le finding 1 du registre. Une seule entrée, tagguée
par le finding, plutôt que deux récits du même fait.

**Ce que la gate a trouvé.** Le § Tests de ce ticket prescrit, pour l'entrée neuve de
`POINTS`, un `startAnchor` valant `- L'Étape 4.5 garde ses deux assertions de
garde-fou` et un `corpsIntact` comparant, après `platir`, la locution d'origine
**entière**. Les deux portent donc en clair, dans un fichier de `__tests__/`, la
chaîne `garde ses deux assertions de garde-fou`. Or le § Vérification 4 du **même
ticket** énonce :

> `grep -rc "garde ses deux assertions de garde-fou" __tests__/` rend toujours **0** :
> ce ticket ne renomme rien, il **signale**.

Constaté sur le commit relu : le grep rend **2**, sur
`__tests__/escalade-arbitrage-bandeau-coherence.test.js`.

```
cd "<worktree>" && grep -rc "garde ses deux assertions de garde-fou" __tests__/
```

**Pourquoi l'implémenteur ne pouvait pas le corriger.** Respecter le § Tests rend le
§ Vérification 4 faux ; respecter le § Vérification 4 suppose d'écrire l'ancre
autrement que ce que le § Tests prescrit **en toutes lettres** (il proscrit
explicitement « une regex tolérante sur la tranche brute »). Deux clauses de la même
spec s'excluent : c'est une question de **quoi**.

**Ce que le défaut contamine au-delà de ce ticket.** Deux constats de
`specs/skill-106.md` — spec **livrée**, dont l'arbitrage de `E1 (finding 7)` écarte
l'issue 3 sur eux — deviennent faux : « `grep -rc …` rend **0** sur chaque fichier »
et « obtient **zéro** occurrence ». Le § Problème de ce ticket-ci porte le même
constat.

**Issues possibles, non tranchées.**

1. Écrire la locution **coupée** dans le fichier de test, sans rien amender :
   `corpsIntact` concatène déjà ses littéraux, la coupure peut tomber **à l'intérieur**
   de la locution, et `startAnchor` peut être raccourci en amont de « deux ». Le grep
   redevient `0`, le § Tests et le § Vérification redeviennent compatibles, aucune
   clause n'est touchée. ⚠️ Coût réel : l'en-tête du fichier exige que `startAnchor`
   « couvre tout ce que `corpsIntact` doit pouvoir voir disparaître » — une ancre
   raccourcie couvre moins, et ce contrat-là est écrit.
2. Amender le § Vérification 4 : borner le grep à
   `__tests__/commands-shape-coherence.test.js`, le seul fichier où la locution
   signalerait vraiment un renommage régressé. La spec devient cohérente ; le constat
   perd sa portée transverse, et les deux constats de `specs/skill-106.md` restent
   faux.
3. Ne rien faire : le § Vérification 4 reste infaisable tel qu'écrit, et l'opérateur
   qui le déroule ne peut pas distinguer ce hit d'un renommage régressé.

**Diagnostic de méthode — contrôle 4.** « Relire ses propres clauses les unes contre
les autres. » Le § Vérification 4 a été écrit sans être confronté au § Tests du
**même** document, qui prescrit d'écrire la locution exacte dont il exige l'absence.
Les deux clauses ont été rédigées dans la même passe, à quelques paragraphes
d'intervalle. C'est, mot pour mot, le diagnostic de l'escalade que ce ticket referme
(`specs/skill-106.md`, `E1 (finding 7)`, contrôle 4) — reproduit dans le ticket
traitant.

### E1 (finding 4) — `specs/skill-105.md` § Tests, cas 10, devient faux et n'est pas dans le § Portée

**Ce que la gate a trouvé.** `specs/skill-105.md` (`shipped`) § Tests, cas 10, dicte
le texte de l'en-tête de `__tests__/escalade-arbitrage-bandeau-coherence.test.js` et
énonce, sans réserve de date :

> ⚠️ **Aucune mutation-témoin ne peut prouver que l'`amendeur` est lu par ligne** —
> les quatre points nomment le même. C'est une contrainte de **conception** […] pas
> une assertion. ⛔ Ne pas fabriquer de point témoin pour la rendre falsifiable.

Le commit porte `POINTS` à **cinq** entrées, dont une nomme `SKILL-106` : la clause
est fausse dans ses deux moitiés — le compte et la nature du fait. Le § D3 de ce
ticket corrige l'en-tête du fichier de test « pour dire l'état réel » ; la spec qui
**dicte** cet en-tête, elle, n'a reçu ni bandeau, ni note, ni escalade avant celle-ci.

```
cd "<worktree>" && git grep -n "les quatre points nomment le même" -- 'specs/'
```

**Pourquoi ni l'implémenteur ni moi ne pouvions le corriger en exécutant.** Le
§ Portée de ce ticket est fermé (« **Rien d'autre.** ») sur deux fichiers, et ses
quatre exclusions motivées ne citent pas `specs/skill-105.md`. Poser le bandeau y est
un **élargissement de portée** — pas un geste conventionnel : `specs/skill-104.md`
(livré) exclut nommément le bandeau d'**amendement** de son critère, et
`specs/skill-105.md` § D3 l'a re-tranché. C'est exactement la décision de *quoi* que
l'arbitrage de ce ticket a rendue pour `specs/skill-27.md`, reposée un cran plus loin.

**Issues possibles, non tranchées.**

1. Poser un bandeau `⚠️ **Amendée par [[SKILL-110]]**` adjacent au cas 10 — le geste
   que le § D1 de ce ticket codifie, appliqué à sa propre onde de choc. Coût :
   élargir un § Portée fermé, dans le commit même qui referme une escalade née d'un
   § Portée fermé de travers.
2. Ouvrir un ticket suivant qui pose ce bandeau. Coût : c'est le **report** qui a déjà
   produit SKILL-50 après SKILL-44 et SKILL-86 après SKILL-85 — le motif que le § D4
   de `specs/skill-106.md` invoque pour poser les bandeaux dans le commit qui rend la
   section fausse.
3. Ne rien faire : deux textes du dépôt se contredisent sur le même mécanisme, et la
   mutation-témoin 5 du § Tests de ce ticket est décrite comme impossible par celui
   des deux qui n'a pas été amendé.
4. Réécrire le cas 10 sur place. ⛔ Écarté d'avance par « une spec livrée est un
   compte rendu daté ».

**Diagnostic de méthode — contrôle 1.** « Grep le nom, pas seulement ses porteurs
connus. » Le § D3 de ce ticket a identifié que l'en-tête du fichier de test devenait
faux — donc le défaut était **vu**, à un cran près. Ce qui a manqué est le grep de la
phrase elle-même sur le dépôt : `git grep "les quatre points nomment le même"` rend
`specs/skill-105.md`, qui la **dicte**. Le porteur connu (le fichier de test) a été
traité ; le porteur non grepé (la spec qui le prescrit) est resté invisible.
