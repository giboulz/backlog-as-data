---
id: SKILL-112
title: Mesure SDD : distinguer le lancement de correction du lancement d implementation
type: ticket
status: shipped
priority: should
exec:
  model: opus
  effort: high
  review: deep
  matured: 2026-09-05
---

# SKILL-112

## Problème

Traite l'escalade **E1 (findings 2 et 3)** de [`specs/skill-111.md`](skill-111.md),
refermée le 2026-09-05 par ce ticket.

Depuis SKILL-111, un cycle `/sdd-run-ticket` dont la gate rend au moins un finding
émet **deux** appels `Agent` en `subagent_type: sdd-impl-<effort>` portant la
**même** `description: "SDD <TICKET-ID>"` : l'implémenteur (Étape 6) et le
correcteur (Étape 6.5). Avant SKILL-111 la reprise était un `SendMessage`, jamais un
appel `Agent` — il n'y avait donc jamais qu'un lancement par ticket et par cycle.

Deux consommateurs de `tools/review-log/write.mjs` retiennent le **dernier**
lancement dont le ticket correspond, et basculent donc sur le correcteur :

- `collectTranscriptMetrics` — `const spawn = matching[matching.length - 1]`
  (l. 732). `spawnIndex`, `prompt.length` / `prompt.sections` et `tokensAtSpawn`
  désignent désormais le correcteur. `tokens − tokensAtSpawn`, que
  `specs/skill-63.md` définit comme le coût de conduite du cycle, exclut alors
  l'implémentation **et** toute la gate ;
- `collectConcurrency` — `const moi = mine[mine.length - 1]` (l. 982), puis
  `if (spawn === moi) continue`, qui exclut par **identité d'objet** et non par
  ticket. Le lancement d'implémentation du même ticket reste candidat et chevauche
  toujours : `concurrentCycles` devient non vide sur **tout** cycle où `U > 0`, y
  compris un ticket lancé seul dans sa session.

Ce ne sont pas des déductions : l'enregistrement de production
`~/sdd-metrics/cycles/2026-09/2026-09-05-SKILL-111-267e6cfa-s01.json` porte
`spawnIndex: 1` (le correcteur) et
`concurrentCycles: [{ ticket: "SKILL-111", spawnIndex: 0 }]` — le ticket concurrent
de lui-même —, sans aucune entrée `unmeasured`. L'enregistrement est **plausible et
faux**, et le champ que SKILL-61 a créé pour signaler un delta contaminé s'allume
partout, donc n'informe plus.

Un troisième effet, de nature différente : `spawnIndex` étant le rang parmi **tous**
les lancements retenus, l'insertion d'un correcteur par cycle décale le rang de tous
les tickets suivants de la session. Le rang enregistré n'est plus comparable à celui
d'avant SKILL-111 — or c'est sur lui que repose la doctrine de frontière de session
de `commands/sdd-run-ticket.md` (« le coût d'un cycle tend à croître avec son rang
dans la session »).

Ces enregistrements sont poussés hors du dépôt vers un consommateur externe
(SKILL-55, `tools/sdd-push/push.mjs`), dont l'ingestion **insère sans jamais mettre
à jour** (`specs/skill-103.md`) : l'enregistrement faux déjà poussé y est
définitivement.

## Décision

**Marquer le lancement de correction dans sa `description`, par un suffixe que le
parseur d'identifiant tolère déjà** — et retirer ce lancement de la population des
« lancements du ticket » chez les consommateurs qui en choisissent un.

Fait constaté avant d'écrire cette décision, et rejouable :

```bash
cd "$HOME/.claude" && node -e "const RE=/^SDD\s+(\S+)/; for (const d of ['SDD SKILL-111','SDD SKILL-111 (correction)']) console.log(JSON.stringify(d),'->',JSON.stringify(RE.exec(d)?.[1]))"
```

→ les deux formes rendent `"SKILL-111"`. `TICKET_ID_FROM_DESCRIPTION_RE`
(`tools/review-log/baseline.mjs:94`) s'arrête au premier blanc : le suffixe est donc
**invisible** pour l'attribution du ticket, et **visible** pour qui le cherche.
C'est ce qui permet de marquer sans casser ce que SKILL-111 avait, à raison, refusé
de casser — une `description` non reconnue rendrait `ticketId: null`, strictement
pire.

⛔ **Aucun bump de `SCHEMA_VERSION`.** Ce ticket n'ajoute, ne renomme et ne retire
**aucun champ** de l'enregistrement : il restaure la valeur que les champs existants
avaient avant SKILL-111. Un numéro de schéma décrit une **forme**, et le bumper ici
séparerait l'avant-fix de l'après-fix — jamais le corrompu du sain, puisque 21
enregistrements portent `schema: 5` et qu'un seul est corrompu (constaté par la
commande du § Hors-scope). Il casserait de surcroît l'ingestion : le consommateur
déclare `const SUPPORTED_SCHEMAS = [1, 2, 3, 4, 5]`
(`personal-hub/app/api/sdd/ingest/route.ts:32`) et rejette tout autre schéma en
`badRequest('unknown schema')` (l. 103-105), rejet que `push.mjs` avale en sortant 0
— tous les cycles suivants seraient perdus en silence, une panne pire que celle
qu'on ferme.

⛔ **D2 de `specs/skill-61.md` n'est pas rouverte.** Sa sémantique — « une relance
remplace le cycle précédent », d'où le choix du **dernier** lancement et l'exclusion
par objet — est **conservée telle quelle** pour les vraies relances. Ce ticket
retire de la population une **espèce que D2 n'a jamais envisagée**, le correcteur,
qui n'est pas une relance de l'implémentation mais sa suite.

## Portée

⛔ **`PLAFOND_SKILL` est une valeur allouée en premier-arrivé et n'est pas figée
ici** (`__tests__/skill-size-ceiling-coherence.test.js`) : d'autres tickets écrivent
dans `commands/` entre cette maturation et l'implémentation. Règle d'allocation :
**re-mesurer après écriture** par la commande du § Vérification, et poser le plafond
à la taille constatée.

1. **`commands/sdd-run-ticket.md`, § Étape 6.5, bloc `Agent({…})`** — ⚠️ **c'est le
   bloc de paramètres d'appel, pas le bloc `<!-- APPEL:impl-fix -->`** : la
   `description` y vit (aux alentours de la l. 947 ; l'ancre est le champ
   `description:` du bloc `Agent` de cette étape, pas le numéro de ligne). Elle
   devient `SDD <TICKET-ID> (correction)`. Le suffixe est un **littéral**, pas un
   jeton ; la liste de substitutions du bloc `APPEL:impl-fix` n'est pas concernée et
   reste inchangée.

2. **`commands/sdd-run-ticket.md`, § Étape 6.5, clause d'avertissement de la
   `description`** — la clause qui ordonne aujourd'hui « `description` reste
   `SDD <TICKET-ID>`, mot pour mot celle de l'Étape 6 » (aux alentours des
   l. 957-961) est **réécrite**, pas complétée : elle dit désormais pourquoi le
   suffixe existe (il marque le lancement pour la mesure) **et** pourquoi il ne
   casse pas l'attribution (le parseur s'arrête au premier blanc). ⛔ Laisser
   coexister l'ancienne clause et une nouvelle mettrait dans le même fichier un
   ordre et son contraire à dix lignes d'écart, et l'orchestrateur suivrait la plus
   impérative des deux.

3. **`tools/review-log/baseline.mjs`** — une **constante nommée et exportée** porte
   le marqueur. `extractSpawns` ajoute à chaque entrée un booléen `isCorrection`,
   dérivé de la `description`, et **ne numérote plus les lancements de correction** :
   `spawnIndex` redevient le rang parmi les seuls lancements d'implémentation, donc
   comparable aux enregistrements d'avant SKILL-111. ⛔ `extractTicketId` et
   `TICKET_ID_FROM_DESCRIPTION_RE` restent **inchangés** : le constat du § Décision
   montre qu'ils n'ont rien à corriger.

4. **`tools/review-log/write.mjs`, `collectTranscriptMetrics`** — parmi les
   lancements dont le ticket correspond, ne considérer que ceux dont `isCorrection`
   est faux, puis garder le **dernier** de ce sous-ensemble (D2 préservée pour les
   vraies relances).

5. > ⚠️ **Supersédé par SKILL-114** : la borne « quel que soit son ticket »
   > éteignait un chevauchement réel — le motif suppose le lancement
   > d'implémentation du voisin présent dans le transcript, ce qu'un voisin repris
   > **à la gate seule** ne garantit pas (c'est l'escalade E1 ci-dessous).
   > SKILL-114 la remplace par quatre règles : l'exclusion inconditionnelle ne
   > vaut plus que du correcteur du ticket **courant**, celui d'un autre ticket
   > n'est exclu que s'il est **couvert** par son implémentation. Le paragraphe
   > ci-dessous décrit l'arbitrage pris à la date de SKILL-112 ; il ne prescrit
   > plus.

   **`tools/review-log/write.mjs`, `collectConcurrency`** — exclure des candidats
   **tout** lancement de correction, quel que soit son ticket. Motif : un correcteur
   ne représente jamais un cycle distinct — le cycle auquel il appartient est déjà
   porté par son lancement d'implémentation, qui chevauche de la même façon. Sans
   cette borne, un ticket voisin ayant eu `U > 0` produirait **deux** entrées pour
   lui-même dans `concurrentCycles`. `moi` devient le dernier lancement
   non-correction du ticket.

6. **Régime orphelin — écrit UNE fois, et le même dans les deux fonctions.** Quand
   le ticket n'a que des lancements de correction (transcript tronqué, cycle repris
   à la gate seule), le motif enregistré nomme cette cause précise — jamais le
   `noSpawnReason` actuel (« aucun lancement d'implémenteur pour X dans le
   transcript »), devenu mensonger puisqu'il en existe un. ⚠️ Ce motif alimente les
   **trois** champs que `noSpawnReason` alimente aujourd'hui — `spawnIndex`,
   `prompt` (l. 735-736) et `tokensAtSpawn` (l. 756) — sous peine de faire rougir la
   bijection null ⇄ `unmeasured` d'`assertUnmeasuredInvariant`. Côté
   `collectConcurrency`, le `reason` du régime `mine.length === 0` porte le même
   motif dans le même cas. Le régime « aucun lancement du tout » garde son
   `noSpawnReason` actuel, inchangé.

7. **`__tests__/skill-size-ceiling-coherence.test.js`** — `PLAFOND_SKILL` re-mesuré
   après écriture, avec son commentaire daté selon la convention en place dans ce
   fichier. Explicitement dans la portée, et non conventionnel : `rules/maturation.md`,
   § Portée conventionnelle, classe « rehausser un plafond de taille » parmi ce qui
   **reste** dans le § Portée (condition 3). `PLAFOND_PROMPTS` et `PLAFOND_STEPS`
   ne sont **pas touchés** : aucun point ci-dessus n'écrit dans `prompts/` ni
   `steps/`.

8. **Fixtures** — les transcrits des cas 4 à 10 du § Tests sont livrés en
   **fixtures**, sous `__tests__/fixtures/review-log/`, selon la convention déjà en
   place dans ce dossier. ⛔ Pas de transcript recopié inline dans un fichier de
   test qui dépasse déjà 2800 lignes.

## Hors-scope

- **Bumper `SCHEMA_VERSION`** et, avec lui, élargir `SUPPORTED_SCHEMAS` chez le
  consommateur, ou mettre à jour le registre « Versions émises à ce jour » de
  `specs/skill-55.md`. Arbitré : voir le § Décision. Si l'implémentation fait
  apparaître qu'un champ **change de forme** malgré tout, c'est une **escalade E1**,
  pas un bump décidé en chemin.
- **`subagentReportedTokensByRole`** — troisième consommateur des lancements, qui
  agrège les tokens sous la clé `sdd-impl-<effort>` et confond donc implémenteur et
  correcteur. **Volontairement non traité** : c'est une **somme**, pas une
  désignation, et les tokens du correcteur appartiennent bel et bien au cycle. Rien
  n'y est faux ; le nommer ici évite qu'un lecteur ultérieur croie le § Problème
  exhaustif.
- **Réparer les enregistrements déjà écrits.** Le défaut date de la livraison de
  SKILL-111 (2026-09-05) et frappe tout cycle à `U > 0` mené depuis, quel que soit
  son ticket. Le constater, ne pas le recopier de mémoire :

  ```bash
  grep -rl '"concurrentCycles": *\[ *{' "$HOME/sdd-metrics/cycles/2026-09/"
  ```

  puis, pour chacun, vérifier si l'entrée porte **son propre** ticket. Ce ticket
  arrête l'hémorragie ; il ne réécrit aucun fichier de `~/sdd-metrics` et **n'y
  lance aucun `git`** (interdit de `/sdd-run-ticket`, § Étape 6.8). ⚠️ Les
  enregistrements déjà poussés sont chez le consommateur pour de bon (ingestion en
  insertion seule) : les réparer localement ne les y corrigerait pas.
- **Rouvrir D2 de `specs/skill-61.md`** ni aucune de ses dispositions — voir le
  § Décision. Aucune spec livrée n'est réécrite.
- **`steps/review-deep.md`** — l'autre escalade de SKILL-111, traitée par
  [SKILL-113](skill-113.md), qui est séquencé **après** ce ticket. Aucun octet de
  `steps/` n'est écrit ici.
- **Les autres trous de mesure déjà nommés** : `shaReachableFromBranch` et son
  incapacité à discriminer un `<sha_final>` emprunté au ticket voisin
  (`specs/skill-56.md` § Hors-scope), et les entrées `unmeasured` de D2 qui font
  l'objet de l'escalade ouverte de `specs/skill-69.md`. Rien ici ne les referme.

## Tests

Pas de fichier de test neuf : les fonctions touchées ont déjà leur domicile, et en
ouvrir un quatrième éclaterait la propriété d'un même mécanisme. Les fixtures, elles,
sont neuves (point 8 de la portée).

**`__tests__/review-log-baseline-coherence.test.js`** (`extractSpawns`) :

1. Une `description` `SDD <ID> (correction)` rend `ticketId` = `<ID>` **et**
   `isCorrection: true`. Mutation-témoin : retirer le suffixe → `isCorrection` faux.
2. Une `description` `SDD <ID>` nue rend `isCorrection: false`.
3. Un lancement dont la `description` ne matche pas (`ticketId` tiré du prompt par
   `TICKET_ID_FROM_PROMPT_RE`) rend `isCorrection: false`, jamais `null` ni
   `undefined` : le champ est un booléen dans les trois régimes d'attribution.
4. Deux lancements d'implémentation séparés par un correcteur → leurs `spawnIndex`
   sont `0` et `1`, **consécutifs** : les correcteurs ne consomment pas de rang.
   C'est la comparabilité avec l'avant-SKILL-111.

⚠️ **Non-régression à traiter dans ce même fichier** : le `toEqual` **exhaustif** de
`buildSessionRecord` (aux alentours des l. 266-300) compare l'objet spawn en entier
et rougira à l'ajout d'`isCorrection`. C'est l'**attendu**, pas une régression : le
mettre à jour fait partie de ce ticket.

**`__tests__/review-log-write-coherence.test.js`**
(`collectTranscriptMetrics`, `collectConcurrency`) :

5. Transcript à deux lancements du même ticket, le second marqué correction →
   `spawnIndex` et `prompt.length` désignent le **premier**. Mutation-témoin :
   retirer le marqueur → rouge sur `spawnIndex`.
6. Même transcript → `collectConcurrency` rend `concurrentCycles: []`. C'est le cas
   qui a produit ce ticket.
7. Transcript à deux lancements **non marqués** du même ticket (vraie relance, D2)
   → le **dernier** est retenu, et la relance antérieure reste candidate.
   Non-régression explicite de D2.
8. Transcript où un ticket voisin a **un implémenteur et un correcteur** qui
   chevauchent → `concurrentCycles` porte **une seule** entrée pour ce voisin, celle
   de son implémenteur. Borne du point 5.
9. Transcript ne portant qu'un lancement de correction pour le ticket → les **trois**
   champs `spawnIndex`, `prompt` et `tokensAtSpawn` sont `null` avec le motif du
   régime orphelin (point 6), et `collectConcurrency` rend le **même** motif. ⛔ Le
   motif ne doit pas être `noSpawnReason`.
10. Transcript sans aucun lancement du ticket → `noSpawnReason` et
    `concurrentCycles: null` inchangés. Non-régression du régime existant.

**`__tests__/review-log-wiring-coherence.test.js`** :

11. Le suffixe attendu est **déclaré dans le test** — jamais importé de
    `baseline.mjs` — et confronté au texte de `commands/sdd-run-ticket.md`. ⛔ C'est
    D3 du dépôt : « toute liste de contrôle est DÉCLARÉE ICI, jamais lue de la
    source qu'elle contrôle ». Un test qui importerait la constante se validerait
    contre lui-même, et un nettoyage des deux côtés resterait vert.
12. La constante exportée par `baseline.mjs` est, elle aussi, confrontée au même
    littéral déclaré dans le test — deuxième moitié de la même garde : le skill et
    le parseur doivent tomber d'accord **avec le test**, jamais entre eux.
13. La clause du point 2 (pourquoi le suffixe existe) est présente dans
    `commands/sdd-run-ticket.md`. Sans ce cas, un ticket de compression du skill la
    retire, tout reste vert, et le défaut se rouvre exactement comme le § Décision
    le redoute.

**Non-régression, cas par cas** :

- `__tests__/review-log-write-coherence.test.js` fige `SCHEMA_VERSION` à sa valeur
  courante en au moins deux endroits (aux alentours des l. 2373 et 2818) et
  `__tests__/sdd-telemetry-coherence.test.js` en fige une troisième (aux alentours
  de la l. 1770). **Aucune ne doit bouger** : ce ticket ne bumpe pas le schéma. Si
  l'une rougit, c'est que le point a été mal appliqué.
- `assertUnmeasuredInvariant` (bijection null ⇄ `unmeasured`) — reste vert par le
  point 6, et le cas 9 le vérifie sur le régime neuf.
- `__tests__/impl-templates-coherence.test.js` § 7 et § 8 — restent verts : les
  points 1 et 2 n'écrivent pas dans le bloc `APPEL:impl-fix`.
- `__tests__/impl-fix-wiring-coherence.test.js` — **à vérifier explicitement** : ses
  cas assertent la forme du lancement de l'Étape 6.5 et l'un d'eux peut figer la
  `description`. Le constater avant d'écrire, par
  `grep -n "description" __tests__/impl-fix-wiring-coherence.test.js` ; si un cas la
  fige, il entre dans la portée du point 1.

## Vérification

Depuis le worktree du ticket, dans `claude-config` (`$HOME/.claude`).

**Préalable — `node_modules`.** Les worktrees de ce dépôt vivent en
`<home>/claude-config-wt/<nom>`, **hors** de son arborescence, et `node_modules/`
est gitignoré. Constater, ne pas présumer :

```bash
node -e "console.log(require.resolve('vitest/package.json'))"
```

Échec → `npm install` dans **ce** worktree.

```bash
npm test
```

Suite **complète** (`package.json` de `claude-config` déclare `"test": "vitest run"`,
constaté le 2026-09-05). Pas de `typecheck` — ce dépôt n'en déclare pas.

Puis les trois constats que la suite ne fait pas :

```bash
node --input-type=module -e "import('./tools/review-log/baseline.mjs').then(m => { const k = Object.keys(m); console.log(k.join(' ')); process.exit(k.some(n => /MARQUEUR|CORRECTION/i.test(n)) ? 0 : 1) })"
```

→ doit **sortir 0** et lister l'export du marqueur (point 3). ⚠️ Une commande qui se
contenterait d'importer le module sortirait 0 même si la constante n'existe pas —
c'est le `process.exit` conditionnel qui fait le constat, pas l'import.

```bash
node -e "console.log(require('./tools/review-log/write.mjs').SCHEMA_VERSION ?? 'ESM')" 2>/dev/null; grep -n "SCHEMA_VERSION = " tools/review-log/write.mjs
```

→ la valeur doit être **identique** à celle d'avant le ticket : aucun bump.

```bash
for f in commands/sdd-run-ticket.md; do LC_ALL=C tr -d '\r' < "$f" | wc -c; done
t=0; for f in prompts/*.md; do t=$((t+$(LC_ALL=C tr -d '\r' < "$f" | wc -c))); done; echo "$t"
s=0; for f in steps/*.md; do s=$((s+$(LC_ALL=C tr -d '\r' < "$f" | wc -c))); done; echo "$s"
```

→ la première valeur doit égaler le `PLAFOND_SKILL` re-mesuré. ⚠️ Pour les deux
autres, le constat est « **ce ticket n'a écrit aucun octet dans `prompts/` ni
`steps/`** » — vérifiable par `git diff --stat main -- prompts/ steps/`, qui doit
être vide — et **non** une égalité avec une valeur d'avant : ces plafonds bougent
sous d'autres tickets, et une égalité stricte rougirait sur un fait étranger.

## Challenge

Deux challengers vierges (lentilles archi · sceptique), passés le 2026-09-05 sur ce
lot. Objections dédupliquées ; chacune a une issue.

**Révisées — le § Décision, le § Portée, le § Tests ou le § Vérification ont changé**

1. *Le bump de schéma casse l'ingestion* — `SUPPORTED_SCHEMAS = [1,2,3,4,5]`
   (`personal-hub/.../ingest/route.ts:32`), rejet en `badRequest`, avalé par
   `push.mjs` en exit 0, `~/sdd-metrics/cycles` non suivi par git → cycles perdus en
   silence. **Vérifié de première main.** Le point 5 d'origine est **supprimé** ;
   l'interdit est écrit au § Décision.
2. *Le motif du bump est faux* — il séparerait l'avant-fix de l'après-fix, jamais le
   corrompu du sain : 21 enregistrements portent `schema: 5`, un seul est corrompu.
   **Vérifié de première main.** Même issue que 1.
3. *Le bump aurait exigé une mise à jour du registre de `specs/skill-55.md`, que le
   § Hors-scope interdisait* — contradiction interne. Disparaît avec le bump.
4. *`SCHEMA_VERSION` est dans `write.mjs:55`, pas dans `baseline.mjs`* — erreur de
   fait. Disparaît avec le bump ; la valeur est désormais citée à son vrai domicile
   au § Vérification.
5. *Le point 1 visait le bloc `APPEL:impl-fix`, où la `description` ne vit pas* —
   erreur de fait. Le point 1 vise désormais le bloc `Agent({…})`, et le dit.
6. *La clause existante ordonne le contraire et n'était pas visée* — le point 2 exige
   sa **réécriture**, pas un ajout à côté.
7. *Le régime orphelin ne nommait qu'« une entrée » `unmeasured` alors que trois
   champs deviennent `null`, contre la bijection d'`assertUnmeasuredInvariant`* —
   le point 6 nomme les trois.
8. *Les points 3 et 4 traitaient le même cas orphelin en sens inverse* — régime
   unifié, écrit une seule fois (point 6), et le cas 9 le vérifie des deux côtés.
9. *Un voisin ayant eu `U > 0` produirait deux entrées dans `concurrentCycles`* — le
   point 5 exclut désormais **tout** lancement de correction, quel que soit son
   ticket ; cas 8.
10. *`spawnIndex` n'est plus comparable à l'avant-SKILL-111* — le point 3 retire les
    correcteurs de la numérotation ; cas 4.
11. *Le cas 10 d'origine violait D3 (un test qui lit la constante qu'il contrôle)* —
    les cas 11 et 12 déclarent le littéral **dans le test** et confrontent les deux
    sources à lui.
12. *Le cas 11 d'origine (« a strictement augmenté ») n'est pas écrivable* —
    supprimé avec le bump.
13. *La commande de vérification du point 2 était vacue sur Node ≥ 22* — **vérifié**.
    Remplacée par une commande à `process.exit` conditionnel, et l'avertissement est
    écrit à côté.
14. *Le § Vérification ne mesurait pas `commands/sdd-run-ticket.md`, seul plafond que
    ce ticket bouge* — ajouté.
15. *`review-log-write-coherence.test.js` et le `toEqual` exhaustif de
    `review-log-baseline-coherence.test.js` manquaient à la non-régression* —
    nommés, le second comme attendu explicite.
16. *La clause « pourquoi le suffixe existe » n'était gardée par aucun test* — cas 13.
17. *La spec ne disait pas si les transcrits sont inline ou en fixtures* — point 8.
18. *Le grep du § Hors-scope ne constatait pas ce que la phrase affirmait* — remplacé
    par un grep sur `concurrentCycles`, qui couvre tout ticket depuis 2026-09-05.
19. *Rien ne disait que l'enregistrement faux est définitivement chez le
    consommateur (ingestion en insertion seule)* — écrit au § Problème et au
    § Hors-scope.
20. *Aucun ordre déclaré entre SKILL-112 et SKILL-113, qui éditent le même fichier de
    plafonds à marge zéro* — SKILL-113 porte désormais `blockedBy: SKILL-112`, et
    les deux § Vérification affirment « ce ticket n'écrit aucun octet dans X »
    plutôt qu'une égalité contre une valeur qui bouge.

**Défendues — la spec ne change pas**

21. *`subagentReportedTokensByRole` est un troisième consommateur, ni traité ni
    déclaré* — **partiellement retenue** : l'objection a raison sur l'omission, tort
    sur le défaut. C'est une **somme**, pas une désignation ; les tokens du
    correcteur appartiennent au cycle et rien n'y est faux. Nommé au § Hors-scope
    avec ce motif, pour qu'aucun lecteur ne croie le § Problème exhaustif.
22. *Le discriminateur est une chaîne que l'orchestrateur doit taper ; un oubli
    reproduit le record faux sans `unmeasured`* — **défendue**. Toutes les
    alternatives structurelles proposées (prompt du bloc, absence d'`isolation`,
    ligne « Findings, verbatim ») exigeraient qu'`extractSpawns` inspecte le
    **contenu** du prompt, ce qui le rendrait dépendant d'une prose que les tickets
    de skill réécrivent — un couplage plus fragile que le suffixe, pas moins. Le
    risque d'omission est réel et il est couvert : le cas 13 garde la clause qui
    l'explique, et le cas 11 garde le littéral.
23. *Le ticket devrait être `kind: bug`* — **défendue**. Le § Problème porte déjà le
    symptôme constaté et sa cause, le § Décision et le § Portée la correction ; le
    CLI n'expose aucun verbe pour changer `kind` après `new`, et le refaire coûterait
    un id sans rien ajouter au contenu.

## Escalades (D10)

### E1 (finding 1) — la borne « quel que soit son ticket » du point 5 éteint un chevauchement réel
→ Traitée par SKILL-114 (2026-09-05).

**Finding 1 du registre de revue** (type E1), remonté par les trois relecteurs,
chacun l'ayant **rejoué** plutôt que déduit.

**Ce que la gate a trouvé.** Le point 5 du § Portée prescrit d'exclure des candidats
de `collectConcurrency` « **tout** lancement de correction, **quel que soit son
ticket** », sur le motif « le cycle auquel il appartient est déjà porté par son
lancement d'implémentation, qui chevauche de la même façon ». Ce motif suppose ce
lancement **présent dans le transcript**. Il ne l'est pas quand un ticket voisin est
repris **à la gate seule** — le régime que le point 6 du même § Portée nomme
lui-même (« transcript tronqué, cycle repris à la gate seule »), mais qu'il ne
traite que pour le ticket courant, jamais pour le voisin.

Constaté par exécution, sur
`__tests__/fixtures/review-log/correction-neighbour-session.jsonl` privé de sa seule
ligne `toolu_nei_impl_d2` :

```
avec impl voisin          : {"concurrentCycles":[{"ticket":"SKILL-D2","spawnIndex":1}],"reason":null}
sans impl voisin          : {"concurrentCycles":[],"reason":null}
sans impl + sans marqueur : {"concurrentCycles":[{"ticket":"SKILL-D2","spawnIndex":1}],"reason":null}
```

La troisième ligne établit que c'est une **régression de ce ticket**, non un défaut
préexistant : le régime d'avant rendait l'entrée. Un `[]` signifie « mesuré, rien
trouvé » — un mensonge là où D1 de `specs/skill-61.md` exige `null` + motif.

**Pourquoi l'implémenteur ne pouvait pas le corriger.** Les quatre issues sont
toutes des décisions de *quoi*, et chacune bute sur une clause que ce ticket a déjà
tranchée en sens inverse :

1. **Garder les correcteurs orphelins candidats** — contredit mot pour mot le
   point 5, dont l'universalité n'est pas un accident : elle a été **ajoutée en
   réponse à l'objection 9 du § Challenge**. Elle **change de surcroît la forme d'un
   champ** : un correcteur porte `spawnIndex: null`, donc l'entrée poussée serait
   `{ ticket, spawnIndex: null }` et le `sort` comparerait des `NaN`. Or le
   § Hors-scope dit : « Si l'implémentation fait apparaître qu'un champ **change de
   forme** malgré tout, c'est une **escalade E1**. »
2. **Numéroter les correcteurs** pour éviter ce `null` — contredit le point 3 et
   rouvre la comparabilité de `spawnIndex` avec l'avant-SKILL-111, l'un des trois
   effets que ce ticket ferme.
3. **Rendre `null` + motif dès qu'un correcteur orphelin existe** — honore D1 sans
   toucher la population des candidats, mais éteint la mesure de concurrence
   **entière** sur un transcript où elle est majoritairement mesurable. Arbitrage de
   *quoi*, non prescrit.
4. **La variante** nommée dans le finding (voisin dont l'implémentation *et*
   l'écriture sont antérieures, mais dont un second passage de gate relance un
   correcteur pendant le cycle courant) n'est atteignable par aucune des trois :
   elle exige de changer `closureOf`, donc le modèle d'intervalle de **D2 de
   `specs/skill-61.md`**, que ce ticket déclare deux fois hors-scope.

**Les issues possibles, non tranchées.** Aux quatre ci-dessus s'ajoute une
**cinquième**, formulée par le correcteur et non écrite : un correcteur est exclu
des candidats **si et seulement si** un lancement d'implémentation du même ticket,
antérieur, a une clôture postérieure au correcteur — sinon il porte un cycle que
rien d'autre ne porte. Elle paraît la plus juste, et c'est la seule qui traite le
voisin et le ticket courant par la même règle. Elle appelle un § Portée élargi, au
moins un cas de § Tests, et une décision explicite sur la nullabilité de
`concurrentCycles[].spawnIndex`.

**Diagnostic de méthode** — contrôle **3** (« énumérer les branches et les régimes
du mécanisme touché »). Le point 6 du § Portée énumère bien le régime orphelin, mais
seulement du côté du ticket enregistré ; le point 5 touche le **même** prédicat
depuis l'autre côté (les voisins) sans dire ce qu'il fait de ce régime-là. ⚠️ À
noter pour la méthode : la clause fautive est née d'une **objection de challenge**
retenue (§ Challenge, nº 9), qui fermait un vrai trou — deux entrées pour un même
voisin — en élargissant la borne d'un cran de trop. Réviser une clause sous
objection ne dispense pas de re-dérouler le contrôle 3 sur la clause révisée. La
fermeture de cette escalade n'exigera donc **pas** l'ouverture d'un ticket sur la
méthode : la réponse n'est pas `aucun`.
