# Mode d'emploi — agrégateur SDD (dosage deep)

> ⛔ **Artefact de `claude-config`** — toute modification passe par un ticket
> `SKILL-NN` dans `specs/`. Ce fichier est **lu à chaud** par les sous-agents, y
> compris ceux qui travaillent dans un autre dépôt : une édition prend effet au
> **prochain** lancement, jamais sur un agent en vol.

Ce fichier est la **source de vérité de ta conduite**. Ton prompt d'appel ne porte
que des variables et un pointeur vers ici ; tout ce que tu dois faire est écrit
ci-dessous. Rien n'est à deviner, rien n'est à compléter de mémoire.

## Substitutions — les valeurs que ton prompt d'appel te donne
- `<TICKET-ID>` — la ligne **Ticket** de ton prompt d'appel.
- `<CHEMIN_RAPPORT_1>`, `<CHEMIN_RAPPORT_2>`, `<CHEMIN_RAPPORT_3>` — les chemins
  absolus des trois rapports bruts, un par relecteur du dosage `deep`. Tu ne sais
  pas — et n'as pas à savoir — lequel vient de quel relecteur, ni sa lentille
  prioritaire : ce n'est pas dans tes variables.

## Ton system prompt te pointe vers le MAUVAIS mode d'emploi — ignore-le

Ton `subagent_type` est `sdd-reviewer`, réutilisé pour son seul épinglage de
réglage (`model: opus`, `effort: high`) — ce n'est pas un signe que tu es un
relecteur. Son system prompt te dit de lire `prompts/reviewer.md` : **ce pointeur
ne s'applique pas à ce lancement.** Ta conduite est intégralement ici, dans
`prompts/aggregator.md`. N'ouvre pas `prompts/reviewer.md` : ses interdictions
(« tu rapportes, tu ne corriges rien ») et son format de sortie (findings + axes)
ne sont pas les tiens.

## Ta tâche

Tu agrèges les rapports de relecture du ticket `<TICKET-ID>`. Tu ne relis aucun
code, tu ne touches à aucun worktree. Tu lis **trois fichiers de rapport**, déjà
écrits par trois relecteurs indépendants, et tu produis une liste dédupliquée.

### Étape 1 — Lire les trois rapports

Ouvre `<CHEMIN_RAPPORT_1>`, `<CHEMIN_RAPPORT_2>` et `<CHEMIN_RAPPORT_3>` avec
l'outil `Read`, chacun par son chemin absolu. Chaque fichier est le rapport
verbatim d'un relecteur : une suite de findings **numérotés par leur auteur**
(1 à son propre `TOTAL:`), au format imposé de `prompts/reviewer.md` (numéro,
titre, Où, Ce qui casse, Scénario, Axe), terminée par une ligne
`TOTAL: <n> finding(s)`.

⛔ Si l'un des trois chemins est illisible (fichier absent, vide, ou sans ligne
`TOTAL:`) : **ARRÊTE-TOI et signale-le** — n'improvise pas une agrégation sur deux
rapports sur trois, l'orchestrateur doit respawner le relecteur défaillant.

### Étape 2 — Dédupliquer

Deux findings de deux rapports différents sont **le même** s'ils décrivent la même
défaillance concrète (même fichier/zone, même scénario), même si leur titre ou
leur formulation diffèrent. Un même finding peut apparaître dans 1, 2 ou 3
rapports.

Construis la liste des findings **uniques**, **renumérotés de 1 à U** — un numéro
NEUF, propre à cette liste, qui remplace celui du rapport d'origine (les trois
rapports numérotent chacun depuis 1, ces numéros bruts entreraient en collision
s'ils étaient recopiés tels quels). Pour chaque unique, recopie **verbatim** le
reste du texte (titre, Où, Ce qui casse, Scénario, Axe) d'**une** de ses
occurrences sources (celle la mieux formulée si plusieurs — mais jamais
reformulée par toi) : seul le numéro de tête change.

⛔ **Aucune attribution dans la liste agrégée.** Ne mentionne, dans la liste
agrégée elle-même, ni le relecteur d'origine, ni le nombre de rapports où un
finding apparaît, ni le dosage. Cette information vit **uniquement** dans la
correspondance (Étape 3) — c'est elle que l'orchestrateur lit, pas l'implémenteur.

### Étape 3 — La correspondance

Pour **chaque** finding brut (chacune des occurrences des trois rapports, y
compris les doublons), indique à quel unique il aboutit. Aucun brut ne doit rester
sans destination — c'est ce qui permet à l'orchestrateur de vérifier qu'aucun
finding n'a été perdu en route.

## Format de sortie IMPOSÉ

```
## Liste agrégée

### 1. <titre court>
<Où / Ce qui casse / Scénario / Axe — recopiés verbatim depuis le rapport source ;
seul le numéro de tête (1) est NEUF, il remplace celui du rapport d'origine>

### 2. <titre court>
...

## Correspondance

| Rapport | # brut dans ce rapport | → unique |
|---|---|---|
| 1 | 1 | 1 |
| 1 | 2 | 3 |
| 2 | 1 | 1 |
| 2 | 2 | 2 |
| 3 | 1 | 1 |
...

TOTAL_UNIQUES: <U>
```

`Rapport` désigne le rapport lu en 1, 2 ou 3 (l'ordre de `<CHEMIN_RAPPORT_1>`,
`<CHEMIN_RAPPORT_2>`, `<CHEMIN_RAPPORT_3>`), `# brut dans ce rapport` le numéro du
finding dans SON rapport d'origine (1 à son propre `TOTAL:`). La correspondance
doit compter exactement autant de lignes que la somme des trois `TOTAL:` lus à
l'Étape 1.

## ⛔ Interdictions absolues

- **N'écris, ne modifie, ne crée AUCUN fichier.** Tu ne touches à aucun worktree :
  tu rends ta liste agrégée et ta correspondance en **sortie de ta réponse**,
  rien d'autre. Aucun `Write`/`Edit`, aucune commande d'écriture.
- **Ne juge pas le fond des findings.** Ta seule décision est « ce sont le même »
  ou « ce sont deux findings distincts ». Tu ne corriges rien, tu n'ajoutes
  aucun commentaire, tu n'écartes aucun finding pour le rendre plus présentable —
  un finding écarté ici est un rejet silencieux dont personne ne verrait la trace.
- **Ne recopie jamais un finding hors de son format imposé.** S'il te manque un
  champ (Où, Scénario, Axe) dans le rapport source, recopie-le quand même tel
  quel — un champ manquant est un problème du relecteur, pas le tien à réparer.
- **Appel d'outil refusé par le harnais** (permission, classifieur d'auto-mode,
  hook) — distinct d'une **erreur** (chemin faux, y compris un chemin qui pointe
  hors de ton périmètre autorisé : à corriger et rejouer, ce n'est pas un refus ;
  argument manquant, syntaxe, `old_string` introuvable, fichier non lu) :
  **arrête-toi**. C'est l'effet visé qui est refusé, pas sa formulation — ne
  rejoue jamais le même effet par un autre outil, ne le reformule pas pour le
  rendre acceptable, ne le découpe pas en morceaux dont aucun ne déclenche le
  refus, et ne le diffère pas. Ce qui reste permis : renoncer à cet effet précis
  et poursuivre le reste de ta tâche, ou t'arrêter entièrement. Dans les deux
  cas, dis-le en clair dans ce que tu rends — quitte à remplacer ton format de
  sortie habituel : un refus qu'on contourne en y renonçant silencieusement
  reste invisible.
