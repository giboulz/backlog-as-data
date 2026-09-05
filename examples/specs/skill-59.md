---
id: SKILL-59
title: specs/skill-28.md : clore la note perimee sur le renvoi croise shaReachableFromBranch
type: ticket
status: shipped
priority: should
exec:
  model: sonnet
  effort: low
  review: light
  matured: 2026-08-24
---

# SKILL-59

## Problème

`specs/skill-28.md` § Escalades (clôture SKILL-53, 2026-08-22) affirme encore, au
présent : « **aucun ticket ouvert ne porte aujourd'hui cette mesure.** Un ticket
dédié (ou un arbitrage rouvrant l'un des deux hors-scope) **reste à poser** — hors
du rôle d'un implémenteur. » et « Qui instrumente le champ manquant reste un point
ouvert, non arbitré ici… Les deux specs se renvoient donc l'une à l'autre : **aucun
ticket ouvert ne porte aujourd'hui cette mesure.** »

SKILL-56 a livré `shaReachableFromBranch` dans `tools/review-log/write.mjs` et fermé
ce renvoi circulaire dans `specs/skill-46.md` et `specs/skill-53.md` § Escalades
(clôtures datées du 2026-08-23). `specs/skill-28.md` — le troisième nœud du même
renvoi, cité par les deux clôtures ci-dessus — n'a pas été amendé : son autorisation
d'écriture n'incluait que `session-boundary-coherence.test.js` (specs/skill-56.md § Portée),
pas `specs/skill-28.md` lui-même. Trouvé en gate de reprise de SKILL-56, finding nº 5.

Risque concret : un futur `/mature-epic` ou une session de tri qui lit
`specs/skill-28.md` pour savoir ce qui reste ouvert sur la doctrine de frontière de
session y trouve un « ticket dédié reste à poser » au présent — et ouvre un doublon
de SKILL-56, ou re-tranche un arbitrage déjà rendu.

## Décision

Amender `specs/skill-28.md` § Escalades (le paragraphe de clôture SKILL-53) par une
note de suite, datée et attribuée à SKILL-56, disant que le renvoi circulaire est
fermé : SKILL-56 porte désormais `shaReachableFromBranch` dans
`tools/review-log/write.mjs`, aux côtés de `refVerified`, et que
`commands/sdd-run-ticket.md` § Doctrine de frontière de session le reflète. Ne pas
réécrire le paragraphe existant à la lettre — même geste que les clôtures
précédentes (note ajoutée, historique conservé).

## Portée

| Fichier | Geste |
|---|---|
| `specs/skill-28.md` | § Escalades : note de clôture de suite (SKILL-56, datée) |

## Hors-scope

- Rouvrir le § Décision 3 de `specs/skill-28.md` ou tout autre paragraphe déjà
  *superseded* par la clôture SKILL-53 : hors du périmètre de ce ticket.
- Retoucher `tools/review-log/write.mjs`, `commands/sdd-run-ticket.md`,
  `specs/skill-46.md` ou `specs/skill-53.md` : déjà livrés par SKILL-56.

## Tests

Aucun test automatisé : correction éditoriale d'une spec, pas de comportement
exécutable. Vérification manuelle suffit (§ Vérification).

## Vérification

1. `specs/skill-28.md` § Escalades ne dit plus, au présent, qu'aucun ticket ouvert ne
   porte la mesure ni qu'un ticket dédié reste à poser.
2. Le paragraphe original (clôture SKILL-53) reste lisible tel quel, la note de suite
   s'ajoute sans le réécrire.
