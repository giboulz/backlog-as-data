// SKILL-26 — findings agrégés : un agrégateur vierge remplace la fusion faite à
// la main par l'orchestrateur (Étape 6.5), et le relecteur peut désormais écrire
// SON rapport (Décision 1 de specs/skill-26.md) sans que la phrase du system
// prompt du relecteur ne l'interdise plus.
//
// Contexte (specs/skill-26.md) : avant ce ticket, l'Étape 6.5 prescrivait à
// l'orchestrateur de « fusionner les doublons entre rapports » lui-même — une
// recopie sur contexte long, et un jugement de fusion rendu sur un diff qu'il
// n'a pas lu. Ce fichier verrouille : (1) la prescription de fusion a disparu du
// skill ; (2) les deux contrôles de perte (bruts, puis uniques) sont prescrits,
// BLOQUANTS et scopés à l'Étape 6.4.5 ; (3) l'agrégateur ne spawne qu'en dosage
// `deep`, jamais en `light`, et `<CHEMIN_RAPPORT>` n'est fourni qu'en `deep` ;
// (4) la chaîne d'interdiction d'écriture du relecteur, dans le GÉNÉRATEUR, porte
// désormais la borne « du dépôt relu » ; (5) l'agrégateur ne compte pas dans
// `<n_relecteurs>` ; (6) une reprise pour dépôt manquant est prescrite.
//
// ⚠️ Chaque assertion porte en commentaire la MUTATION qui doit la faire rougir
// (convention de ce repo, D3).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized } from './helpers/prompt-blocks.js';
import { REVIEWER_SHARED } from '../tools/agent-defs/generate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SDD_FILE = 'commands/sdd-run-ticket.md';
const REVIEWER_FILE = 'prompts/reviewer.md';
// SKILL-54 : le CORPS de l'Étape 6.4.5 vit ici depuis le chargement paresseux.
const REVIEW_DEEP_FILE = 'steps/review-deep.md';

const readSkill = () => readNormalized(REPO_ROOT, SDD_FILE);
const readReviewer = () => readNormalized(REPO_ROOT, REVIEWER_FILE);

// Découpe de l'Étape 6.4.5, ajoutée par ce ticket entre 6.4 et 6.5. Utilisée par
// PLUSIEURS describes ci-dessous : la borner ici évite qu'un `.s` sur tout le
// fichier n'aille chercher un « STOP » sans rapport, ailleurs (finding 4 de la
// revue de ce ticket).
//
// ⚠️ SKILL-54 — CIBLE DE LECTURE REPOINTÉE, et rien d'autre (specs/skill-54.md,
// D5.a). Le corps de l'Étape 6.4.5 a quitté `commands/sdd-run-ticket.md` pour
// `steps/review-deep.md` : l'orchestrateur ne le lit qu'en dosage `deep`, au
// lieu de le porter à chaque tour de chaque cycle. Les SEPT assertions que ce
// helper sert sont inchangées — même nombre, mêmes motifs, mêmes libellés :
// elles ne portaient pas sur *le fichier skill*, elles portaient sur *l'étape*.
// L'étape a déménagé, le test la suit, la garantie achetée par SKILL-26 est
// conservée à l'identique. Ce n'est PAS la piste 2 close par la spec (relâcher
// des assertions positives) : rien n'est relâché ici.
//
// ⛔ Ne pas « élargir » ce helper à l'union du skill et de steps/ : chercher
// dans deux fichiers rouvre le faux-négatif « la présence ailleurs masque la
// disparition ». Une assertion lit UN fichier — celui qui porte le
// comportement. La découpe par ancres n'est plus nécessaire : le fichier cible
// EST la section, il n'y a plus de « STOP » d'une autre étape à écarter.
//
// ⚠️ Le bloc `<!-- APPEL:aggregator -->`, lui, est resté dans le skill (D3) —
// les assertions qui le concernent le trouvent dans la prose déplacée, qui le
// cite par son marqueur, et `impl-templates-coherence.test.js` continue de
// vérifier le bloc réel là où il est.
const etape645 = () => readNormalized(REPO_ROOT, REVIEW_DEEP_FILE);

describe('SKILL-26 — l’Étape 6.5 ne prescrit plus la fusion à l’orchestrateur', () => {
  // ⚠️ Mutation-témoin : réintroduire la phrase « Fusionne les doublons entre
  // rapports » (ou « numérote les uniques de 1 à ») dans le skill → rouge.
  // C'était le point exact du ticket : la fusion est désormais un jugement rendu
  // par l'agrégateur, pas recopié par l'orchestrateur sur un diff qu'il n'a pas lu.
  it(`${SDD_FILE} ne prescrit plus « Fusionne les doublons » nulle part`, () => {
    const raw = readSkill();
    expect(raw.includes('Fusionne les doublons')).toBe(false);
    expect(raw.includes('numérote les uniques de 1 à')).toBe(false);
  });
});

describe('SKILL-26 — contrôle 1 : aucun finding brut perdu (scopé à l’Étape 6.4.5)', () => {
  // ⚠️ Mutation-témoin : retirer ce contrôle de l'Étape 6.4.5 → rouge. Sans lui,
  // un agrégateur qui perd un finding en route ne serait jamais rattrapé — c'est
  // le rejet silencieux que ce ticket ferme un étage plus haut (D6 de l'épic).
  it('la section 6.4.5 exige que chaque finding brut ait une destination dans la correspondance', () => {
    const section = etape645();
    expect(
      /chaque\s+finding\s+brut.*a\s+une\s+destination\s+dans\s+la\s+correspondance/is.test(
        section
      ),
      `${REVIEW_DEEP_FILE} § 6.4.5 ne prescrit plus le contrôle « tous les bruts ont une ` +
        `destination » — un finding perdu par l'agrégateur ne serait plus détecté.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin (finding 4 de la revue de ce ticket) : dans la section
  // 6.4.5 SEULE, remplacer « correspondance : **STOP** — l'agrégateur a perdu un
  // finding » par « correspondance : l'agrégateur a perdu un finding » (contrôle
  // documentaire, plus bloquant) → rouge. Régression réelle du premier jet de ce
  // test : la regex, non scopée à la section, matchait le « STOP » sans rapport
  // de l'Étape 7 (« Différence → STOP ») ailleurs dans le fichier et restait
  // verte. Scoper à `etape645()` ET ancrer le motif sur UNE phrase continue (pas
  // une alternance `|` qui accepte n'importe quel STOP du fichier) ferme le trou.
  it('la section 6.4.5 ordonne STOP, à la SUITE ImMÉDIATE du contrôle des bruts perdus', () => {
    const section = etape645();
    expect(
      /Si\s+`R`\s+bruts\s*≠\s*nombre de lignes de\s+correspondance\s*:\s*\*\*STOP\*\*/.test(
        section
      ),
      `${REVIEW_DEEP_FILE} § 6.4.5 : aucun ordre d'arrêt explicite, directement rattaché ` +
        `au contrôle « R bruts ≠ lignes de correspondance ». Le contrôle doit être ` +
        `BLOQUANT, pas seulement documenté.`
    ).toBe(true);
  });
});

describe('SKILL-26 — contrôle 2 : aucun unique perdu entre correspondance et liste', () => {
  // ⚠️ Mutation-témoin : retirer ce second contrôle (garder seulement le premier)
  // → rouge. Un agrégateur qui fusionne juste (contrôle 1 vert) mais tronque sa
  // propre liste agrégée avant de la rendre ne serait pas détecté par le seul
  // comptage des lignes de correspondance (finding 11 de la revue de ce ticket).
  it('la section 6.4.5 exige TOTAL_UNIQUES == nombre d’entrées de la liste agrégée', () => {
    const section = etape645();
    expect(
      /TOTAL_UNIQUES.*nombre d.entrées.*réellement présentes/s.test(section),
      `${REVIEW_DEEP_FILE} § 6.4.5 ne confronte plus \`TOTAL_UNIQUES\` au nombre d'entrées ` +
        `réellement présentes dans la liste agrégée — un unique tronqué de la ` +
        `liste, mais toujours cité dans la correspondance, passerait inaperçu.`
    ).toBe(true);
  });
});

describe('SKILL-26 — l’agrégateur ne spawne qu’en dosage `deep`, jamais `light`', () => {
  // ⚠️ Mutation-témoin : retirer le paragraphe « **En dosage `light`**, saute
  // cette étape entière » → rouge. Régression réelle du premier jet de ce test
  // (finding 5 de la revue) : un `includes('\`light\`')` sur toute la section
  // reste vrai par le seul TITRE de l'étape (« dosage \`deep\` uniquement » ne le
  // cite même pas, mais la phrase de saut, elle, le fait) — ancrer sur la phrase
  // de saut ELLE-MÊME, pas sur la présence du mot.
  it('le dosage `light` saute l’étape entière (rien à fusionner)', () => {
    const section = etape645();
    expect(
      /\*\*En dosage `light`, saute cette étape entière\*\*/.test(section),
      `${REVIEW_DEEP_FILE} : l'Étape 6.4.5 ne dit plus que le dosage \`light\` la saute ` +
        `entièrement — l'agrégateur spawnerait alors même pour un seul rapport.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer le paragraphe « **En dosage `deep`**, spawne
  // l'**agrégateur vierge** … » → rouge. Régression réelle du premier jet
  // (finding 5) : `section.includes('\`deep\`')` restait vrai par le seul TITRE
  // de la section, et `section.includes('<!-- APPEL:aggregator -->')` restait
  // vrai par le bloc d'appel resté en place malgré la prescription retirée —
  // ancrer sur la phrase de prescription elle-même, pas sur des fragments épars.
  it('le dosage `deep` prescrit explicitement le spawn de l’agrégateur', () => {
    const section = etape645();
    expect(
      /\*\*En dosage `deep`\*\*, spawne l.\*\*agrégateur vierge\*\*/.test(section),
      `${REVIEW_DEEP_FILE} : l'Étape 6.4.5 ne prescrit plus explicitement le spawn de ` +
        `l'agrégateur en dosage \`deep\` — un titre de section et un bloc d'appel ` +
        `résiduels ne suffisent pas à prouver que le spawn est encore ordonné.`
    ).toBe(true);
    expect(section.includes('<!-- APPEL:aggregator -->')).toBe(true);
  });
});

describe('SKILL-26 — l’agrégateur ne compte pas dans `<n_relecteurs>`', () => {
  // ⚠️ Mutation-témoin : retirer la précision « ne compte PAS dans
  // `<n_relecteurs>` » → rouge. Sans elle, un orchestrateur qui vient de passer
  // 4 appels `Agent` en `subagent_type: "sdd-reviewer"` (3 relecteurs +
  // l'agrégateur) n'a aucune raison de ne pas compter 4 — faussant la mesure de
  // redondance entre dosages persistée à l'Étape 6.8 (finding 10 de la revue).
  it('la section 6.4.5 précise que son spawn ne compte pas dans `<n_relecteurs>`', () => {
    const section = etape645();
    expect(
      /ne compte PAS dans `<n_relecteurs>`/.test(section),
      `${REVIEW_DEEP_FILE} § 6.4.5 ne précise plus que le spawn de l'agrégateur est exclu ` +
        `du décompte des relecteurs.`
    ).toBe(true);
  });
});

describe('SKILL-26 — dépôt manquant malgré un rapport recevable : reprise prescrite', () => {
  // ⚠️ Mutation-témoin : retirer le paragraphe « Si l'agrégateur s'arrête
  // lui-même … Respawne CE relecteur » → rouge. Sans lui, un rapport recevable
  // en sortie mais jamais écrit sur disque (Write non exécuté avant la fin du
  // tour du relecteur) laisse l'orchestrateur sans conduite prescrite : il
  // improviserait soit une fusion manuelle (interdite), soit un blocage sans
  // issue (finding 9 de la revue de ce ticket).
  it('la section 6.4.5 prescrit de respawner le relecteur si l’agrégateur ne peut pas lire son fichier', () => {
    const section = etape645();
    expect(
      /Respawne CE relecteur, avec le MÊME\s*\n?`<CHEMIN_RAPPORT>`/.test(section),
      `${REVIEW_DEEP_FILE} § 6.4.5 ne prescrit plus de respawner le relecteur dont le ` +
        `dépôt de fichier a échoué malgré une sortie recevable.`
    ).toBe(true);
  });
});

describe('SKILL-26 — chemin de rapport : neuf à chaque exécution, jamais réutilisé', () => {
  // ⚠️ Mutation-témoin : retirer la consigne de suffixe NEUF → rouge. Sans elle,
  // un chemin déterministe (ticket + rang) collisionne avec un fichier périmé
  // laissé par une tentative précédente arrêtée avant l'Étape 6.4.5 — l'agrégateur
  // n'a aucun moyen de distinguer un rapport frais d'un rapport d'un lancement
  // antérieur (finding 3 de la revue de ce ticket).
  it(`${SDD_FILE} exige un suffixe NEUF à chaque exécution de l'Étape 6.3, jamais réutilisé`, () => {
    const raw = readSkill();
    expect(
      /NEUF à chaque exécution de cette étape/.test(raw) &&
        /ne doit\s*\n?\s*\*\*jamais\*\* réutiliser un chemin d.une tentative/.test(
          raw
        ),
      `${SDD_FILE} : la fraîcheur du chemin de rapport (suffixe neuf, jamais ` +
        `réutilisé d'une tentative précédente) n'est plus prescrite.`
    ).toBe(true);
  });
});

describe('SKILL-26 — `<CHEMIN_RAPPORT>` : seulement en dosage `deep`, jamais en `light`', () => {
  // ⚠️ Mutation-témoin : réintroduire la ligne « Chemin de dépôt du rapport :
  // <CHEMIN_RAPPORT> » dans le bloc `APPEL:reviewer-light` → rouge. Aucun
  // agrégateur ne lit jamais ce fichier en `light` (finding 13 de la revue) :
  // l'écriture serait un travail mort à chaque cycle `light`, et le mode d'emploi
  // du relecteur affirmerait à tort qu'un agrégateur « lira ce fichier plus tard ».
  it('le bloc APPEL:reviewer-light ne porte PAS `<CHEMIN_RAPPORT>`', () => {
    const raw = readSkill();
    const marker = '<!-- APPEL:reviewer-light -->';
    const start = raw.indexOf(marker);
    expect(start, `${marker} introuvable.`).not.toBe(-1);
    const end = raw.indexOf('<!-- APPEL:reviewer-deep -->', start);
    expect(end, `Marqueur de fin (reviewer-deep) introuvable après ${marker}.`).not.toBe(
      -1
    );
    const block = raw.slice(start, end);
    expect(block.includes('<CHEMIN_RAPPORT>')).toBe(false);
  });

  // ⚠️ Mutation-témoin : retirer `<CHEMIN_RAPPORT>` du bloc `APPEL:reviewer-deep`
  // → rouge. C'est la seule voie par laquelle l'agrégateur reçoit un chemin à lire.
  it('le bloc APPEL:reviewer-deep porte `<CHEMIN_RAPPORT>`', () => {
    const raw = readSkill();
    const start = raw.indexOf('<!-- APPEL:reviewer-deep -->');
    expect(start).not.toBe(-1);
    expect(raw.slice(start).includes('<CHEMIN_RAPPORT>')).toBe(true);
  });
});

describe('SKILL-26 — prompts/reviewer.md : numérotation et absence conditionnelle', () => {
  // ⚠️ Mutation-témoin : retirer la consigne de numérotation du format de sortie
  // → rouge. Sans numéro d'origine, ni l'implémenteur (dosage `light`, liste
  // relayée telle quelle) ni l'agrégateur (dosage `deep`, correspondance « # brut
  // dans ce rapport ») n'ont de numérotation partagée à citer (finding 1 de la
  // revue de ce ticket).
  it('impose au relecteur de numéroter ses findings (1 à son TOTAL)', () => {
    const raw = readReviewer();
    expect(raw.includes('### <n>. <titre court>')).toBe(true);
    expect(/Numérote chaque finding/.test(raw)).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer la clause d'absence de `<CHEMIN_RAPPORT>` → un
  // relecteur `deep` spawné par une session orchestratrice antérieure à ce
  // ticket (skill chargé une fois par session) recevrait l'ordre d'écrire sans
  // variable pour le faire, et devinerait un chemin dans le répertoire de la
  // session — potentiellement un dépôt vivant (finding 6 de la revue).
  it('dit explicitement quoi faire si `<CHEMIN_RAPPORT>` n’est pas fourni : ne rien déposer', () => {
    const raw = readReviewer();
    expect(
      /si\s+`<CHEMIN_RAPPORT>`\s+ne t.est PAS fourni.*ne dépose rien/is.test(raw),
      `${REVIEWER_FILE} ne dit plus explicitement de ne rien déposer quand ` +
        `\`<CHEMIN_RAPPORT>\` est absent — le relecteur devinerait un chemin.`
    ).toBe(true);
  });
});

describe('SKILL-26 — Étape 6.6 : la source de l’attribution est déclarée après ce ticket', () => {
  // ⚠️ Mutation-témoin : restaurer « Tu es le seul à connaître cette attribution :
  // tu as passé les appels » sans plus de précision → rouge. Cette phrase seule
  // ne dit plus la vérité en dosage `deep` depuis ce ticket : l'agrégateur rend
  // une liste SANS attribution, la correspondance de l'Étape 6.4.5 est l'unique
  // source qui la reconstruit (finding 2 de la revue de ce ticket).
  it('renvoie explicitement à la correspondance de l’Étape 6.4.5 pour peupler la colonne « Relecteur » en `deep`', () => {
    const raw = readSkill();
    expect(
      /la correspondance de l.Étape 6\.4\.5 la reconstruit pour toi/.test(raw),
      `${SDD_FILE} : l'Étape 6.6 ne dit plus explicitement que l'attribution, en ` +
        `dosage \`deep\`, se reconstruit depuis la correspondance de l'Étape 6.4.5.`
    ).toBe(true);
  });
});

describe('SKILL-26 — Règles strictes : le relecteur peut écrire SON rapport', () => {
  // ⚠️ Mutation-témoin : restaurer « n'écrit **jamais** » sans la borne « dans le
  // dépôt relu » → rouge. Contradiction sinon avec l'Étape 6.3 qui, en dosage
  // `deep`, ordonne précisément au relecteur d'écrire son rapport dans
  // `<CHEMIN_RAPPORT>` (finding 12 de la revue de ce ticket).
  it("les règles strictes bornent l'interdiction d'écriture au dépôt relu", () => {
    const raw = readSkill();
    // Tolérant au retour à la ligne dans le Markdown source (wrap éditorial).
    expect(/n.écrit \*\*jamais dans le\s+dépôt relu\*\*/.test(raw)).toBe(true);
    // ⚠️ Mutation-témoin : remettre « n'écrit **jamais**. » (sans borne) → rouge.
    expect(/n.écrit \*\*jamais\*\*\. /.test(raw)).toBe(false);
  });
});

describe('SKILL-26 — exception D7 : la chaîne d’interdiction d’écriture du relecteur (générateur)', () => {
  // Assertion sur le GÉNÉRATEUR (`REVIEWER_SHARED.body`), pas sur
  // `agents/sdd-reviewer.md` qui est un artefact PRODUIT — cohérence
  // disque↔générateur déjà verrouillée par agent-defs-coherence.test.js.
  //
  // ⚠️ Mutation-témoin : remettre « tu n'écris aucun fichier. » (sans la borne
  // « du dépôt relu ») dans REVIEWER_SHARED.body → rouge. Sans cette borne, le
  // relecteur ne pourrait plus légitimement écrire son propre rapport
  // (§ Décision 1 de specs/skill-26.md), qui vit HORS du dépôt relu.
  it("REVIEWER_SHARED.body porte « tu n'écris aucun fichier du dépôt relu »", () => {
    expect(REVIEWER_SHARED.body).toContain(
      'tu n’écris aucun fichier du dépôt relu.'
    );
  });

  // ⚠️ Mutation-témoin : réintroduire la formulation absolue « tu n'écris aucun
  // fichier. » (point final, sans borne) à CÔTÉ de la nouvelle → rouge. Les deux
  // ne doivent jamais coexister.
  it('REVIEWER_SHARED.body ne porte plus la formulation absolue sans borne', () => {
    expect(REVIEWER_SHARED.body).not.toMatch(/tu n’écris aucun fichier\.(?!\s*$)/);
    expect(REVIEWER_SHARED.body.includes('tu n’écris aucun fichier.\n')).toBe(
      false
    );
  });
});
