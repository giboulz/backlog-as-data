---
id: SKILL-38
title: README backlog genere : whereismycard n'est plus la source canonique (c'est backlog-cli)
type: ticket
status: wont
priority: should
kind: bug
---

# SKILL-38

## Symptôme

Ouvert en E2 pendant la revue de SKILL-33 (finding 3). Le défaut est **antérieur**
à ce ticket et existerait à l'identique si SKILL-33 n'avait jamais été livré :
vérifié via `git show HEAD^:tools/backlog/README.md` (l'état déjà committé avant
SKILL-33), qui porte déjà le même texte.

`tools/backlog/README.md` (régénéré par `self-update` depuis la constante
`ADOPTION_README` de `backlog-cli`) affirme, section « Ne pas oublier » :

> whereismycard reste la **source canonique** du code (`lib/backlog/`). Quand elle
> évolue : `npm run backlog:build` régénère le bundle, puis
> `node <repo>/dist-backlog/backlog.mjs self-update` le réinstalle ici (+ ce
> README).

Or `~/whereismycard/lib/backlog` **n'existe pas** : le code source vit dans
`~/backlog-cli/lib/backlog` (repo dédié, `package.json` : « Extracted from
whereismycard »). C'est `~/backlog-cli` que SKILL-33 § Décision fait invoquer
(`cd ~/backlog-cli && npm run backlog:install`), pas whereismycard.

## Cause racine

La constante `ADOPTION_README` (`lib/backlog/adoption-readme.ts` dans
`backlog-cli`) n'a pas été mise à jour lors de l'extraction du code backlog
depuis `whereismycard` vers son propre dépôt `backlog-cli`. Le README généré
pointe donc vers un repo qui n'héberge plus le code source du bundle.

## Correction attendue

Éditer `ADOPTION_README` dans `backlog-cli` (`lib/backlog/adoption-readme.ts`)
pour remplacer la référence à « whereismycard » par « backlog-cli », puis
`npm run backlog:install` (ou `--dest`) pour propager le README corrigé dans
tous les checkouts consommateurs (dont `claude-config`).

⚠️ Ce fichier est **généré** : ne pas éditer `tools/backlog/README.md` à la
main dans `claude-config` — toute retouche serait écrasée par le prochain
`self-update`. Le geste correcteur est dans `backlog-cli`, pas ici.

## Portée

- `backlog-cli` : `lib/backlog/adoption-readme.ts` (source du texte).
- `claude-config` : `tools/backlog/README.md` reçoit la correction par
  régénération + commit (même geste que SKILL-33), pas par retouche directe.

## Tests

Aucun test unitaire dédié n'est attendu : le contenu de `ADOPTION_README` est
une chaîne de doc, pas une fonction exercée. La vérification est manuelle
(cf. ci-dessous).

## Vérification

```bash
git -C ~/.claude show HEAD:tools/backlog/README.md | grep -i whereismycard
```
attendu : **vide** (plus aucune occurrence).

---

## Caduc — relocalisé en `BLG-07` (arbitrage du 2026-08-21)

**Le défaut est réel et reste à corriger** ; c'est son domicile qui était faux.

La règle de propriété du `CLAUDE.md` global tranche sur **où vit le livrable**, pas
sur qui l'a trouvé. Or les deux fichiers à modifier vivent tous deux dans
`backlog-cli` :

| Artefact | Chemin |
|---|---|
| La phrase fausse — constante `ADOPTION_README` | `~/backlog-cli/lib/backlog/adoption-readme.ts:89-91` |
| Son test | `~/backlog-cli/__tests__/backlog/adoption-readme.test.ts` |

Aucun commit `fix(SKILL-38)` n'aurait donc jamais atterri sur le `main` de
`claude-config` : les hooks ne l'auraient jamais promu, et ce ticket serait resté
bloqué en `wip` indéfiniment. C'est exactement le **ticket sans domicile** que le
`CLAUDE.md` global décrit.

Arbitrage rendu par l'utilisateur le 2026-08-21 : *« c'est backlog-cli qui stocke
les tickets de la CLI globale — c'est le but de ce projet »*.

`tools/backlog/README.md` de ce dépôt-ci n'est **pas** un livrable : c'est un
**artefact généré** par `self-update`, au même titre que `backlog.json` et
`specs/backlog.md`. Il se régénère à la livraison de `BLG-07`, il ne se ticketise
pas.

⚠️ **`wont` est ici un détournement assumé.** Le vocabulaire du cycle a `parked`
(on se pose encore la question) et `wont` (on a décidé de ne pas le faire). Ce
ticket n'est ni l'un ni l'autre : il est **caduc**, parce que le travail se fait
ailleurs. `wont` est le moins faux des statuts existants. Si le cas se represente —
et il se representera — le manque est dans l'énuméré, pas dans cet arbitrage.

→ **`BLG-07`** (`backlog-cli`). Le diagnostic ci-dessus y est repris.
