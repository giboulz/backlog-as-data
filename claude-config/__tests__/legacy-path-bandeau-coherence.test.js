// SKILL-72 — specs/skill-62.md cite des noms de fichiers de test que SKILL-65 a
// renommés. La correction n'est PAS de réécrire ces mentions (issue 1, écartée
// à l'arbitrage) : c'est de garantir que TOUTE section qui cite un ancien nom
// est, soit couverte par un bandeau qui le nomme, soit reliée par un renvoi
// d'une ligne à la section qui porte ce bandeau — la politique posée par ce
// même ticket dans `prompts/impl-same.md`/`prompts/impl-cross.md`, § Discipline
// SDD, point 1.
//
// Reprise (findings de la gate) : cette batterie a été refaite de fond en
// comble après une première version défectueuse sur cinq points distincts —
// chacun est documenté au fil du code ci-dessous, à l'endroit qu'il corrige.
//
// ⚠️ Mutation-témoin générale : ajouter, N'IMPORTE OÙ dans specs/skill-62.md,
// la mention d'un nom de fichier de test qui n'existe plus, dans une section
// qui ne porte ni bandeau ni renvoi → rouge.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized, fileExists } from './helpers/prompt-blocks.js';
// SKILL-88 (point 1) : `decouperEnSections`, `bandeauxDe` et `porteUnRenvoi`
// étaient dupliquées ici, indépendamment de `./helpers/legacy-path-policy.js`
// (SKILL-72 pour cette copie, promotion SKILL-79 pour l'autre) — `bandeauxDe`
// y était byte-identique. Ce fichier devient le TROISIÈME appelant réel des
// primitives du helper (voir son en-tête pour ce qu'elles couvrent et ce
// qu'elles ne couvrent pas) ; `sansBandeaux` ne remonte pas — elle n'a qu'un
// appelant, ici même (convention du dépôt, `prompt-blocks.js` en-tête D3 : ne
// promouvoir qu'au deuxième appelant réel).
import { decouperEnSections, bandeauxDe, porteUnRenvoi } from './helpers/legacy-path-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SKILL62_FILE = 'specs/skill-62.md';

// ⚠️ Reprise (finding 5 de la gate) : la version précédente cherchait les noms
// cités dans le texte BRUT, bandeau compris — le bandeau, qui nomme lui-même
// les anciens noms pour les expliquer, se comptait donc comme sa propre
// preuve de couverture, rendant le sanity check inerte. Cette fonction retire
// tout bloc `>` avant toute détection de citation.
function sansBandeaux(corps) {
  return corps
    .split('\n')
    .filter((ligne) => !ligne.startsWith('>'))
    .join('\n');
}

// Tout nom de fichier `*.test.js` cité dans un texte, dédupliqué.
function nomsDeFichiersCites(texte) {
  return [...new Set(texte.match(/[\w-]+\.test\.js/g) || [])];
}

// Une mention d'ancien nom est AUTO-EXPLIQUÉE quand son PROPRE PARAGRAPHE
// narre le renommage en même temps qu'il le cite (« … a renommé `X` en `Y` … »,
// `Y` étant la variante `-coherence`). C'est le cas de `commands-shape.test.js`
// au § Escalades (un précédent d'un AUTRE ticket, SKILL-10, hors scope de
// SKILL-72) : ce paragraphe ne laisse jamais le lecteur devant un chemin mort.
//
// ⚠️ Reprise (finding 6 de la gate) : la version précédente appliquait ce test
// au NOM, sur l'ensemble du document — dès qu'UN paragraphe expliquait un nom,
// TOUTES ses autres occurrences (y compris nues, ailleurs) en étaient
// dispensées. Cette fonction est maintenant appelée PAR PARAGRAPHE (voir
// `nomsNonExpliquesDeLaSection` ci-dessous) : seule l'occurrence dont le
// paragraphe explique le renommage est exemptée, pas les autres.
function estAutoExpliqueeDansCeParagraphe(paragraphe, nomAncien) {
  const nomCoherence = nomAncien.replace(/\.test\.js$/, '-coherence.test.js');
  return (
    paragraphe.includes(nomAncien) &&
    /renommé/i.test(paragraphe) &&
    paragraphe.includes(nomCoherence)
  );
}

// Noms cités dans une section (bandeau exclu) qui sont (a) absents de
// `__tests__/` sur le disque, et (b) non auto-expliqués par leur PROPRE
// paragraphe.
function nomsNonExpliquesDeLaSection(corps) {
  const trouves = new Set();
  for (const paragraphe of sansBandeaux(corps).split(/\n\s*\n/)) {
    for (const nom of nomsDeFichiersCites(paragraphe)) {
      if (fileExists(REPO_ROOT, `__tests__/${nom}`)) continue;
      if (estAutoExpliqueeDansCeParagraphe(paragraphe, nom)) continue;
      trouves.add(nom);
    }
  }
  return [...trouves];
}

describe('SKILL-72 — specs/skill-62.md : toute section citant un ancien nom est couverte (bandeau ou renvoi)', () => {
  const raw = readNormalized(REPO_ROOT, SKILL62_FILE);
  const sections = decouperEnSections(raw);

  // Garde du contrat partagé (SKILL-88, finding 5 de la gate) : `titre` est
  // un champ de la forme unifiée que ce fichier CONSOMME (nom des cas
  // `it.each` ci-dessous, message d'assertion de la couverture LOCALE) sans
  // qu'aucune assertion ne le vérifie directement — un titre manquant ne
  // fait rougir ni le nom d'un test (qui n'est pas une assertion) ni son
  // message d'échec (évalué seulement si le test échoue déjà). Cette
  // assertion ferme ce trou : elle rougit dès que `decouperEnSections` cesse
  // de peupler `titre`, indépendamment de tout autre défaut.
  // ⚠️ Mutation-témoin : retirer `titre: ligne.replace(/^##\s+/, '').trim(),`
  // de `decouperEnSections` (`./helpers/legacy-path-policy.js`) → ce test
  // rougit (vérifié à la main pendant la reprise SKILL-88).
  it('chaque section décapée par decouperEnSections porte un titre non vide', () => {
    expect(sections.length, `${SKILL62_FILE} : aucune section "## " détectée.`).toBeGreaterThan(0);
    for (const s of sections) {
      expect(
        typeof s.titre === 'string' && s.titre.trim().length > 0,
        `${SKILL62_FILE} : une section rendue par decouperEnSections n'a pas de ` +
          `\`titre\` non vide (reçu : ${JSON.stringify(s.titre)}).`
      ).toBe(true);
    }
  });

  // Sanity check de la détection elle-même : si elle ne trouve plus AUCUN
  // ancien nom nécessitant une explication, la batterie ne garantit plus
  // rien. ⚠️ Reprise (finding 5) : calculé maintenant sur `sansBandeaux`, donc
  // ne peut plus être satisfait par le seul bandeau — il exige qu'au moins une
  // citation RÉELLE, hors bandeau, existe encore.
  it('la détection trouve au moins un ancien nom cité hors bandeau (sinon la portée a débordé, ou la détection est cassée)', () => {
    const tous = sections.flatMap((s) => nomsNonExpliquesDeLaSection(s.corps));
    expect(
      tous.length,
      `${SKILL62_FILE} : aucun ancien nom de fichier de test détecté hors ` +
        `bandeau — soit les mentions connues (\`send-empty-selection.test.js\`, ` +
        `\`skill-size-ceiling.test.js\`) ont toutes été réécrites vers leur nom ` +
        `\`-coherence\` (l'issue 1, explicitement écartée par l'arbitrage), soit ` +
        `la détection est cassée.`
    ).toBeGreaterThan(0);
  });

  // Couverture GLOBALE : tout ancien nom cité (hors bandeau, hors
  // auto-expliqué) doit être nommé par AU MOINS UN bandeau du document —
  // n'importe lequel (finding 7 : plusieurs bandeaux sont légaux).
  it('chaque ancien nom détecté est nommé, tel quel, par au moins un bandeau du document', () => {
    const tousLesBandeaux = sections.flatMap((s) => bandeauxDe(s.corps));
    const anciens = new Set(sections.flatMap((s) => nomsNonExpliquesDeLaSection(s.corps)));
    const nonCouverts = [...anciens].filter(
      (nom) => !tousLesBandeaux.some((bandeau) => bandeau.includes(nom))
    );
    expect(
      nonCouverts,
      `${SKILL62_FILE} cite un ou plusieurs anciens noms de fichier de test ` +
        `qu'AUCUN bandeau du document ne nomme littéralement : ${nonCouverts.join(', ')}.`
    ).toEqual([]);
  });

  // Couverture LOCALE : chaque section qui cite un ancien nom non expliqué
  // doit, ELLE-MÊME, soit porter un bandeau qui le nomme, soit porter un
  // renvoi vers la section qui PORTE EFFECTIVEMENT le bandeau de CE nom
  // précis. ⚠️ Reprise (finding 4 et finding 9) : la version précédente ne
  // vérifiait QUE le bandeau du § Tests — le renvoi du § Portée n'était
  // inspecté par aucune assertion, et le § Escalades (troisième section
  // citant un ancien nom) n'était ni bandeau ni renvoi.
  //
  // ⚠️ Durci par [[SKILL-89]] (specs/skill-89.md § Correction attendue,
  // arbitrage D1, variante (a)) : `porteUnRenvoi` exige désormais l'ancien
  // nom et le texte COMPLET du document (`raw`, pas seulement `sections` —
  // finding 5 de la gate SKILL-89 : un bandeau posé au préambule, avant le
  // premier `## `, doit compter comme cible), et vérifie PAR NOM qu'un
  // bandeau réel du document nomme CE nom-là (PAS que le renvoi désigne
  // correctement la section qui le porte — ce serait la variante (b),
  // écartée par la mesure, cf. l'en-tête de `porteUnRenvoi`) — un renvoi qui
  // couvrirait un nom sans en couvrir un autre ne suffit plus à exempter la
  // section pour ce second nom (`.every`, pas un `porteUnRenvoi` global par
  // section).
  it.each(
    sections
      .map((s) => ({ ...s, anciens: nomsNonExpliquesDeLaSection(s.corps) }))
      .filter((s) => s.anciens.length > 0)
  )('§ $titre : bandeau local ou renvoi présent (anciens noms : $anciens)', (section) => {
    const bandeauxLocaux = bandeauxDe(section.corps);
    const couvert = section.anciens.every(
      (nom) =>
        bandeauxLocaux.some((bandeau) => bandeau.includes(nom)) ||
        porteUnRenvoi(section.corps, nom, raw)
    );
    expect(
      couvert,
      `${SKILL62_FILE}, § "${section.titre}" cite ${section.anciens.join(', ')} ` +
        `sans porter, pour chacun, ni un bandeau qui le nomme, ni un renvoi vers ` +
        `une section qui porte effectivement son bandeau — un lecteur qui ouvre ` +
        `cette section tombe sur un chemin mort sans explication ni piste.`
    ).toBe(true);
  });
});
