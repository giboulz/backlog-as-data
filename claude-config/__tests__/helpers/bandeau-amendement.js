// Helper PARTAGÉ du motif de bandeau d'amendement `⚠️ **Amendée par [[SKILL-NN]]**`
// (SKILL-106, D1 de specs/skill-106.md). Promu au DEUXIÈME appelant réel — seuil
// en vigueur dans ce dépôt (`prompt-blocks.js`, en-tête D3) : sans cette
// promotion, `amended-phrase-bandeau-coherence.test.js` (SKILL-81) et le fichier
// neuf de SKILL-106 (`preflight-contract-bandeau-coherence.test.js`) porteraient
// chacun leur propre détecteur, et une évolution future de la convention (ex.
// un jour futur) n'en corrigerait qu'un — exactement le défaut que SKILL-88
// documente pour la famille voisine des bandeaux `>` (chemins renommés).
//
// ⚠️ Ce module exporte le STRICT nécessaire — l'amorce du bandeau et un
// prédicat « ce texte porte-t-il un bandeau nommant `<ID>` » — et RIEN de la
// découpe en sections : celle-ci reste locale à chaque fichier consommateur,
// qui a ses propres raisons de découper autrement (`amended-phrase-…` sur
// `##`/`###` avec préambule, `preflight-contract-…` par ancres littérales).
//
// ⚠️ Famille DISTINCTE de `legacy-path-policy.js` (`bandeauxDe`) : celle-là
// détecte des blocs `>` (blockquote) consécutifs, motif de la politique des
// CHEMINS RENOMMÉS (SKILL-72/79/88). Le motif ici est un PARAGRAPHE
// `⚠️ **Amendée par [[…]]**`, séparé par des lignes vides, jamais un `>` — les
// deux conventions restent séparées, l'unification éventuelle étant le sujet
// déclaré de SKILL-88, pas de celui-ci.

// Amorce d'un paragraphe de bandeau — volontairement plus large qu'un bandeau
// nommant un ID précis : un bandeau posé par un AUTRE ticket sur une autre
// section du même fichier doit être reconnu comme bandeau tout autant, même
// s'il ne nomme pas l'ID qu'on cherche.
export const AMORCE_BANDEAU = /^\s*⚠️\s*\*\*Amendée par \[\[/;

/** Le texte littéral d'un bandeau nommant `id` (ex. "Amendée par [[SKILL-106]]"). */
export function texteBandeau(id) {
  return `Amendée par [[${id}]]`;
}

/**
 * `texte` porte-t-il, quelque part, un bandeau d'amendement nommant `id` ?
 * Recherche littérale — pas une détection de paragraphe isolé : un appelant
 * qui doit EXCLURE le bandeau de son propre comptage (pour qu'il ne se compte
 * pas comme sa propre preuve de couverture) retire d'abord les paragraphes
 * amorcés par `AMORCE_BANDEAU` avant d'appeler ses propres prédicats — ce
 * module ne prescrit pas cette étape, qui reste métier à chaque appelant.
 */
export function portesLeBandeauDe(texte, id) {
  return texte.includes(texteBandeau(id));
}
