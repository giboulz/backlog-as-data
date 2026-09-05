# `memory/candidates/` — pool global du palier `candidate`

Ce dossier est le **pool unique** des candidats de mémoire tagués `global`
(palier `candidate`, SKILL-17 ; CLAUDE.md § Mémoire). Il a un **chemin absolu**,
indépendant de la session ou du projet courant, précisément parce qu'un
routage par dérivation du cwd (`projects/<clé>/memory/`) ne peut jamais
produire un pool unique (SKILL-58) — deux sessions différentes n'y résolvent
jamais le même dossier.

## Qui écrit ici

Toute session, quel que soit le projet où elle tourne, quand elle capture un
candidat de mémoire tagué `global` en fin de chunk de travail (une friction sur
*la façon de bosser partout* : un skill global, un workflow, une convention —
pas le code ou les specs d'un projet précis).

## Ce que contient un fichier candidat

Un fichier de mémoire dont le frontmatter porte `metadata.type: candidate`,
avec une seule ligne de corps : « ce qui a lutté / ce que l'utilisateur a
corrigé / ce que la gate a rattrapé », plus le tag de portée `global`.

## Qui le lit

`/reflect` (SKILL-18), en mode mineur — la promotion en règle durable ou en
ticket suit le seuil `≥ 2` du palier `candidate`. Le scan cross-projet
automatique reste SKILL-20 (v2), hors scope ici.

⛔ Les candidats `global` capturés avant SKILL-58 (retombés dans le dossier mémoire
par-projet de la session qui les a écrits, faute de ce chemin) ne sont **pas**
migrés ici — cf. specs/skill-58.md, § Correction attendue. `/reflect`, en mode
projet, continue de les lire là où ils sont et peut les re-router normalement.
