// SKILL-25 — les trois modes d'emploi sortent du skill et deviennent des
// FICHIERS que le sous-agent lit lui-même (`prompts/*.md`).
//
// Contexte (specs/skill-25.md) : jusqu'à SKILL-12 inclus, `/sdd-run-ticket`
// demandait à l'orchestrateur d'être une photocopieuse verbatim sur un contexte
// long — ~10 000 caractères de template implémenteur recopiés à CHAQUE
// lancement, puis le template relecteur pour chaque relecteur. Mesuré sur une
// session réelle de 18 lancements : à partir du 10ᵉ spawn le prompt perd 30 %
// de sa masse, et la section perdue est « Si tu es repris avec des findings » —
// celle qui porte E1/E2/E3, l'interdiction de rejet silencieux et le format de
// la table de dispositions. La dégradation commence AVANT la compaction : la
// cause est la DISTANCE entre l'injection du template et sa recopie.
//
// Forme C (arbitrage C1 de l'épic `prompt-hors-skill`) : ce qui est invariant
// cesse d'être recopié et devient un fichier lu par le sous-agent lui-même. Le
// prompt d'appel ne transmet plus que les variables. La fidélité devient
// STRUCTURELLE — il n'y a plus de recopie, donc plus rien à rater.
//
// Ce fichier REMPLACE le test SKILL-12 (« cohérence des deux templates inline »)
// dans le même commit que le déplacement (D8 : chaque ticket réécrit dans son
// propre commit les tests dont il contredit l'assertion). Les familles 2 à 5
// sont reprises telles quelles de SKILL-12, rebasées sur les fichiers au lieu
// des blocs inline ; les familles 1 et 6 à 11 sont neuves.
//
// ⚠️ D3, appliqué sans exception : toute liste de contrôle (sections
// obligatoires, ancres, jetons attendus) est DÉCLARÉE ICI, jamais importée de
// la source qu'elle contrôle. La duplication est VOULUE — un test qui lit la
// constante qu'il contrôle se valide contre lui-même.
//
// ⚠️ Chaque assertion porte en commentaire la MUTATION qui doit la faire
// rougir (convention de ce repo).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// Helpers PARTAGÉS avec sdd-reviewer-wiring-coherence.test.js — un seul exemplaire, pour
// que la convention « Substitutions » et l'extraction de fence ne puissent pas
// diverger entre les deux tests qui contrôlent le même dispositif. ⚠️ Ce module
// ne porte AUCUNE liste de contrôle : elles restent déclarées en dur ci-dessous
// (D3).
import {
  readNormalized,
  fileExists as helperFileExists,
  extractBlockAfterMarker,
  hasSectionHeading,
  declaredTokens,
  tokensOf,
  sectionEntre,
  extractSection,
} from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const SDD_FILE = 'commands/sdd-run-ticket.md';
const IMPL_SAME = 'prompts/impl-same.md';
const IMPL_CROSS = 'prompts/impl-cross.md';
const REVIEWER = 'prompts/reviewer.md';

const readFile = (rel) => readNormalized(REPO_ROOT, rel);
const fileExists = (rel) => helperFileExists(REPO_ROOT, rel);

describe('SKILL-25 — 1. Les deux modes d’emploi implémenteur existent et sont autonomes', () => {
  // ⚠️ Mutation : supprimer prompts/impl-same.md (ou impl-cross.md) → rouge.
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    it(`${rel} existe et n'est pas vide`, () => {
      expect(fileExists(rel), `${rel} est absent du dépôt.`).toBe(true);
      expect(readFile(rel).trim().length).toBeGreaterThan(0);
    });

    // ⚠️ Mutation : ajouter un frontmatter `---` en tête → rouge. Ces fichiers
    // ne sont ni des tickets ni des agent-defs : ils sont lus tels quels par
    // un sous-agent, un frontmatter y serait du bruit interprété comme de la
    // consigne.
    it(`${rel} n'a PAS de frontmatter`, () => {
      const first = readFile(rel).split('\n')[0].trim();
      expect(
        first === '---',
        `${rel} commence par un frontmatter — ce fichier est un mode d'emploi lu ` +
          `verbatim par un sous-agent, pas un artefact à parser.`
      ).toBe(false);
    });

    // ⚠️ Mutation : retirer le sentinel de propriété → rouge. Sans lui, rien
    // ne dit à un futur éditeur que ce fichier est un artefact de
    // claude-config, ni qu'il est lu À CHAUD par les agents des autres dépôts.
    it(`${rel} porte le sentinel de propriété (claude-config / SKILL-NN)`, () => {
      const raw = readFile(rel);
      expect(raw).toContain('claude-config');
      expect(raw).toContain('SKILL-NN');
    });
  }

  // ⚠️ Mutation : faire pointer les deux prompts d'appel sur le même fichier
  // (ou copier l'un sur l'autre) → rouge.
  it('les deux modes d’emploi sont bien DEUX fichiers différents', () => {
    expect(readFile(IMPL_SAME)).not.toEqual(readFile(IMPL_CROSS));
  });
});

// Les 9 titres du mode d'emploi implémenteur PLUS la section `## Substitutions`
// — liste déclarée ici (D3), jamais lue des fichiers contrôlés.
const IMPL_SECTIONS = [
  '## Étape 0',
  '## Étape 0.1',
  '## Étape 0.5',
  '## Outils de fichiers',
  '## Discipline SDD',
  '## Si tu es repris avec des findings',
  '## Garde-fous génériques',
  '## Rapport final attendu',
  '## Si tu te trouves bloqué',
  '## Substitutions',
];

describe('SKILL-25 — 2. Sections obligatoires, présentes dans LES DEUX modes d’emploi', () => {
  // ⚠️ Mutation, une par entrée : retirer cette section d'UN SEUL des deux
  // fichiers (mode « on a corrigé A, oublié B ») → rouge.
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    for (const heading of IMPL_SECTIONS) {
      it(`${rel} porte la section "${heading}"`, () => {
        expect(
          hasSectionHeading(readFile(rel), heading),
          `${rel} ne porte pas de section "${heading}" (recherche en début de ` +
            `ligne, suivi d'un blanc — pas un includes).`
        ).toBe(true);
      });
    }
  }
});

// Invariants que NI l'un NI l'autre ne doit perdre — repris tels quels de la
// version SKILL-12 de ce fichier.
const COMMON_ANCHORS = [
  '## Discipline SDD',
  'Si tu es repris avec des findings',
  'ARRÊTE-TOI',
  'Modèle utilisé :',
  "N'écris JAMAIS de fichiers via",
];

describe('SKILL-25 — 3. Ancres communes présentes dans LES DEUX modes d’emploi', () => {
  // ⚠️ Mutation : retirer une de ces ancres d'UN SEUL des deux fichiers → rouge.
  for (const anchor of COMMON_ANCHORS) {
    for (const rel of [IMPL_SAME, IMPL_CROSS]) {
      it(`${rel} contient l'ancre commune "${anchor}"`, () => {
        expect(
          readFile(rel).includes(anchor),
          `${rel} ne contient pas l'ancre commune "${anchor}".`
        ).toBe(true);
      });
    }
  }
});

describe('SKILL-25 — 4. Ancres propres au mode « même repo », ABSENTES du cross-repo', () => {
  const SAME_ONLY = ['.agent_worktree_probe_', 'git rebase main', 'chemins RELATIFS'];

  for (const anchor of SAME_ONLY) {
    it(`${IMPL_SAME} contient "${anchor}"`, () => {
      expect(readFile(IMPL_SAME).includes(anchor)).toBe(true);
    });

    // ⚠️ Mutation : ajouter ".agent_worktree_probe_" à impl-cross.md
    // (croisement A→B) → rouge. C'est la signature d'un copier-coller qui a
    // mélangé les deux modes.
    it(`${IMPL_CROSS} ne contient PAS "${anchor}"`, () => {
      expect(
        readFile(IMPL_CROSS).includes(anchor),
        `${IMPL_CROSS} contient "${anchor}" — ancre du mode « même repo » ` +
          `trouvée dans le mode cross-repo.`
      ).toBe(false);
    });
  }
});

describe('SKILL-25 — 5. Ancres propres au cross-repo, ABSENTES du mode « même repo »', () => {
  // `npm install` seul (bare) apparaît AUSSI en prose conditionnelle côté
  // « même repo » (« Lance `npm install` **seulement** si le `CLAUDE.md` le
  // confirme ») : un `.includes('npm install')` serait un faux ami, vrai des
  // deux côtés pour des raisons opposées. L'ancre falsifiable est le BLOC bash
  // complet — c'est lui qui distingue « le cross-repo l'exige sans condition »
  // de « le mode même-repo n'en parle qu'au conditionnel ».
  const CROSS_ONLY = ['<branche_cible>', '```bash\nnpm install\n```', 'chemins ABSOLUS'];

  // ⚠️ SKILL-111 — UNE exception, déclarée ici, bornée à UNE ancre et à UNE
  // section. L'exclusivité de « chemins ABSOLUS » reposait sur un fait que ce
  // ticket rend faux : que le mode « même repo » soit TOUJOURS sandboxé. Il ne
  // l'est plus au régime « relancé à neuf » (l'Étape 6.5 lance le correcteur
  // SANS `isolation`), où un chemin relatif se résout sur le répertoire de la
  // session orchestratrice — le checkout LIVE. `impl-same.md` doit donc y
  // prescrire l'absolu, comme `impl-cross.md` le fait partout.
  //
  // L'ancre reste exclusive PARTOUT AILLEURS dans le fichier, c'est-à-dire là
  // où le fait tient encore : le § « Outils de fichiers » du régime nominal.
  // La mutation que ce test existe pour attraper — recopier le régime de
  // chemins du cross-repo dans le mode « même repo » — reste rouge. Et la
  // contrepartie de l'exemption est une assertion NEUVE, ailleurs : le régime
  // « relancé à neuf » DOIT prescrire l'absolu (`impl-fix-wiring-coherence.test.js`,
  // cas 10), sans quoi on aurait troqué un interdit contre un trou.
  const SECTION_REPRISE = /^## Si tu es repris avec des findings\s*$/;
  const EXEMPTES_HORS_SECTION_REPRISE = new Set(['chemins ABSOLUS']);

  const memeRepoHorsReprise = () => {
    const raw = readFile(IMPL_SAME);
    const section = extractSection(raw, SECTION_REPRISE);
    expect(
      section,
      `${IMPL_SAME} : "## Si tu es repris avec des findings" introuvable — ` +
        `l'exemption ci-dessus ne peut plus être bornée à cette section.`
    ).not.toBeNull();
    return raw.replace(section, '');
  };

  for (const anchor of CROSS_ONLY) {
    const borne = EXEMPTES_HORS_SECTION_REPRISE.has(anchor);
    // ⚠️ Mutation : ajouter à impl-same.md le bloc `npm install`
    // inconditionnel → rouge.
    //
    // ⚠️ Mutation, pour l'ancre exemptée : écrire « chemins ABSOLUS » dans le
    // § « Outils de fichiers » d'impl-same.md (donc hors du régime « relancé à
    // neuf ») → rouge, exactement comme avant SKILL-111.
    it(`${IMPL_SAME} ne contient PAS "${anchor.replace(/\n/g, '\\n')}"${
      borne ? ' (hors § « Si tu es repris avec des findings »)' : ''
    }`, () => {
      const lu = borne ? memeRepoHorsReprise() : readFile(IMPL_SAME);
      expect(
        lu.includes(anchor),
        `${IMPL_SAME} contient une ancre du mode cross-repo.`
      ).toBe(false);
    });

    it(`${IMPL_CROSS} contient "${anchor.replace(/\n/g, '\\n')}"`, () => {
      expect(readFile(IMPL_CROSS).includes(anchor)).toBe(true);
    });
  }
});

describe('SKILL-25 — 6. Anti-re-duplication : le skill ne porte plus le mode d’emploi', () => {
  // Pendant, côté skill, des deux `not.toContain('## Discipline SDD')` de
  // effort-mapping-coherence.test.js (D1) : le prompt SDD ne doit vivre qu'à UN endroit.
  //
  // ⚠️ La liste ne contient AUCUN titre de section : le skill garde le droit de
  // NOMMER « Si tu es repris avec des findings » (l'Étape 6.5 y renvoie).
  // Interdire le titre interdirait le renvoi — on vise le CORPS, pas la
  // référence.
  //
  // ⚠️ Mutation : recoller un template dans le skill « pour que l'agent l'ait
  // sous les yeux » → rouge.
  const BODY_ANCHORS = [
    '.agent_worktree_probe_',
    'git rebase main',
    'Tu as carte blanche dans le worktree',
    "N'écris JAMAIS de fichiers via",
    'Modèle utilisé :',
  ];

  for (const anchor of BODY_ANCHORS) {
    it(`${SDD_FILE} ne contient plus l'ancre de corps "${anchor}"`, () => {
      expect(
        readFile(SDD_FILE).includes(anchor),
        `${SDD_FILE} contient encore "${anchor}" — le mode d'emploi a été ` +
          `recopié dans le skill, ce que ce ticket supprime.`
      ).toBe(false);
    });
  }

  // ⚠️ Mutation : retirer la ligne doctrinale → rouge. C'est elle qui ferme la
  // boucle : sans elle, rien n'interdit à un orchestrateur zélé de « rendre
  // service » en recollant le contenu du fichier dans le prompt d'appel.
  it(`${SDD_FILE} interdit explicitement de recopier un mode d'emploi dans un prompt d'appel`, () => {
    const raw = readFile(SDD_FILE);
    const paragraphs = raw.split('\n\n');
    const hasDoctrine = paragraphs.some(
      (p) => p.includes('⛔') && /recopie/i.test(p) && /mode d'emploi/i.test(p)
    );
    expect(
      hasDoctrine,
      `${SDD_FILE} : aucun paragraphe ne réunit ⛔, « recopie » et « mode ` +
        `d'emploi » — l'interdiction de recopier un mode d'emploi dans un ` +
        `prompt d'appel a disparu.`
    ).toBe(true);
  });
});

// Les blocs d'appel, leur marqueur et leur liste FERMÉE de variables (D4) —
// déclarés ici, jamais lus du skill.
//
// ⚠️ SKILL-111 : cinquième entrée, `<!-- APPEL:impl-fix -->` (le correcteur de
// l'Étape 6.5, qui remplace la reprise par `SendMessage`). Elle rejoint ce
// registre pour hériter des assertions génériques des familles 7, 8 et 9 —
// c'est tout l'objet d'un registre : un bloc d'appel de plus ne doit pas
// entrer sans ses garde-fous.
const CALL_BLOCKS = [
  {
    marker: '<!-- APPEL:impl-same -->',
    tokens: ['<TICKET-ID>', '<ABSOLUTE_SPEC_PATH>', '<effort>'],
    manual: 'impl-same.md',
    otherManual: 'impl-cross.md',
  },
  {
    marker: '<!-- APPEL:impl-cross -->',
    tokens: [
      '<TICKET-ID>',
      '<ABSOLUTE_SPEC_PATH>',
      '<effort>',
      '<chemin_worktree>',
      '<branche_cible>',
    ],
    manual: 'impl-cross.md',
    otherManual: 'impl-same.md',
  },
  {
    // SKILL-111 — le CORRECTEUR de l'Étape 6.5. Ses variables sont celles de
    // l'implémenteur (recopiées de l'Étape 6, jamais redéduites) plus les trois
    // que seule la reprise connaît : le worktree relu, le nom du mode d'emploi
    // envoyé, et les findings.
    //
    // ⚠️ SEUL bloc du registre dont le mode d'emploi est un JETON et non un nom
    // écrit en dur : UN SEUL bloc sert les DEUX modes (le correcteur relit
    // `impl-same.md` ou `impl-cross.md` selon le mode du cycle), là où les deux
    // blocs d'implémenteur ci-dessus sont dédoublés PAR mode. D'où
    // `manualEstUnJeton`, lu par la seule famille 9 — avec sa contrepartie :
    // le DOSSIER, lui, reste écrit en dur (assertion dédiée là-bas).
    marker: '<!-- APPEL:impl-fix -->',
    tokens: [
      '<TICKET-ID>',
      '<ABSOLUTE_SPEC_PATH>',
      '<effort>',
      '<WORKTREE_IMPL>',
      '<mode_emploi>',
      '<ARBITRAGES_PASSE_1>',
      '<FINDINGS_BRUTS>',
    ],
    manual: '<mode_emploi>',
    manualEstUnJeton: true,
    otherManual: null,
  },
  {
    marker: '<!-- APPEL:reviewer-light -->',
    tokens: ['<TICKET-ID>', '<ABSOLUTE_SPEC_PATH>', '<WORKTREE_IMPL>', '<SHA_IMPL>'],
    manual: 'reviewer.md',
    otherManual: null,
  },
  {
    marker: '<!-- APPEL:reviewer-deep -->',
    tokens: [
      '<TICKET-ID>',
      '<ABSOLUTE_SPEC_PATH>',
      '<WORKTREE_IMPL>',
      '<SHA_IMPL>',
      '<AXE_PRIORITAIRE>',
      '<CHEMIN_RAPPORT>',
    ],
    manual: 'reviewer.md',
    otherManual: null,
  },
];

const CALL_BLOCK_MAX_LINES = 25;

describe('SKILL-25 — 7. Chaque prompt d’appel tient en ≤ 25 lignes (D9)', () => {
  for (const { marker } of CALL_BLOCKS) {
    // ⚠️ Mutation : rallonger un bloc à 26 lignes → rouge. ⚠️ Un marqueur non
    // suivi d'une fence à quatre backticks rend `null` et rougit EXPLICITEMENT
    // (jamais une chaîne vide qui passerait tous les `includes`).
    it(`${marker} : marqueur + fence à quatre backticks, contenu ≤ ${CALL_BLOCK_MAX_LINES} lignes`, () => {
      const block = extractBlockAfterMarker(readFile(SDD_FILE), marker);
      expect(
        block,
        `Marqueur ${marker} introuvable dans ${SDD_FILE}, ou non suivi d'un bloc ` +
          `à quatre backticks.`
      ).not.toBeNull();
      const lines = block.split('\n');
      expect(
        lines.length,
        `${marker} fait ${lines.length} lignes — le prompt d'appel doit rester ` +
          `un POINTEUR (≤ ${CALL_BLOCK_MAX_LINES} lignes, D9). Ce qui dépasse ` +
          `appartient au mode d'emploi, pas au prompt d'appel.`
      ).toBeLessThanOrEqual(CALL_BLOCK_MAX_LINES);
    });
  }
});

describe('SKILL-25 — 8. Le prompt d’appel POINTE, et dit quoi faire s’il ne peut pas lire', () => {
  for (const { marker, manual, otherManual } of CALL_BLOCKS) {
    const block = () => extractBlockAfterMarker(readFile(SDD_FILE), marker);

    // ⚠️ Mutation : croiser les fichiers (le bloc `same` pointant
    // `impl-cross.md`) → rouge, dans les deux sens.
    it(`${marker} nomme ${manual}`, () => {
      expect(block()).not.toBeNull();
      expect(block().includes(manual)).toBe(true);
    });

    if (otherManual) {
      it(`${marker} ne nomme PAS ${otherManual}`, () => {
        expect(block().includes(otherManual)).toBe(false);
      });
    }

    // ⚠️ Mutation : remplacer la résolution par un `~/…` passé à `node` — non
    // portable sous PowerShell, déjà interdit par D2 de SKILL-07 → rouge ici
    // AUSSI (le test de forme le voit de son côté ; celui-ci dit pourquoi).
    it(`${marker} résout le chemin par homedir(), jamais par un tilde`, () => {
      const b = block();
      expect(
        b.includes('homedir()'),
        `${marker} ne contient pas la commande de résolution par ` +
          `require('os').homedir() — sans elle, l'agent doit deviner un chemin.`
      ).toBe(true);
      expect(
        b.includes('~/'),
        `${marker} résout le chemin par un tilde — non expansé par PowerShell ` +
          `dans un argument (D2 de SKILL-07).`
      ).toBe(false);
    });

    // ⚠️ Mutation : retirer l'ordre de lecture par l'outil Read / « en entier »
    // → rouge. Un agent qui grep trois lignes du fichier n'a pas lu son mode
    // d'emploi.
    it(`${marker} ordonne la lecture EN ENTIER avec l'outil Read`, () => {
      const b = block();
      expect(b.includes('Read')).toBe(true);
      expect(/EN ENTIER/i.test(b)).toBe(true);
    });

    // ⚠️ Mutation : retirer l'ordre d'arrêt → l'agent, faute de mode d'emploi,
    // improviserait tout le SDD. C'est le SEUL risque neuf de la forme C.
    it(`${marker} porte la consigne d'ARRÊT si la lecture est impossible`, () => {
      const b = block();
      expect(b.includes('ARRÊTE-TOI')).toBe(true);
      expect(
        /si tu ne peux pas lire/i.test(b),
        `${marker} n'énonce pas le cas « lecture impossible ».`
      ).toBe(true);
    });
  }
});

describe('SKILL-25 — 9. Liste FERMÉE de variables par prompt d’appel (D4)', () => {
  for (const { marker, tokens, manual, manualEstUnJeton } of CALL_BLOCKS) {
    // ⚠️ Mutations, deux sens : ajouter une 4ᵉ variable au bloc `same` (toute
    // variable supplémentaire est un ticket) ; en retirer une.
    it(`${marker} porte EXACTEMENT ${JSON.stringify(tokens)}`, () => {
      const block = extractBlockAfterMarker(readFile(SDD_FILE), marker);
      expect(block, `${marker} introuvable.`).not.toBeNull();
      expect([...tokensOf(block)].sort()).toEqual([...tokens].sort());
    });

    // ⚠️ Mutation : transformer le chemin du mode d'emploi en variable
    // (`<PROMPT_PATH>`) → rouge. D4 : le chemin n'est PAS une variable, il est
    // écrit en dur et résolu par l'agent depuis son propre home.
    //
    // ⚠️ SKILL-111 — UNE exception, déclarée dans le registre (`manualEstUnJeton`)
    // et jamais devinée par le motif : le bloc du correcteur sert les DEUX
    // modes, donc le NOM de son mode d'emploi est nécessairement substitué.
    // L'exemption est bornée au jeton `manual` de CETTE entrée — tout autre
    // jeton du même bloc reste jugé par le motif — et elle est payée par
    // l'assertion suivante, qui verrouille ce que D4 protège réellement : le
    // DOSSIER, lui, reste écrit en dur. C'est aussi la forme que l'Étape 6.5
    // exigeait déjà avant ce ticket (famille 12 : « le fichier relu est une
    // substitution, pas un nom figé »), désormais soumise aux garde-fous du
    // registre au lieu d'y échapper.
    it(`${marker} : le chemin du mode d'emploi n'est PAS une variable`, () => {
      const block = extractBlockAfterMarker(readFile(SDD_FILE), marker);
      const exempte = manualEstUnJeton ? manual : null;
      // ⚠️ Le motif vise le fichier de MODE D'EMPLOI, pas n'importe quel
      // chemin : `<ABSOLUTE_SPEC_PATH>` est la spec du ticket, une variable
      // parfaitement légitime — un motif sur « path » la ferait rougir à tort.
      const offenders = [...tokensOf(block)].filter(
        (t) => t !== exempte && /(\.md|prompt|manuel|manual|mode)/i.test(t)
      );
      expect(
        offenders,
        `${marker} porte ${JSON.stringify(offenders)} — le chemin du mode ` +
          `d'emploi doit être écrit en dur dans le prompt d'appel (D4).`
      ).toEqual([]);
    });

    // La contrepartie de l'exemption ci-dessus, et elle seule la rend sûre.
    // ⚠️ Mutation : substituer le dossier lui aussi (`'.claude',<dossier>`) →
    // rouge. Ce qui est substitué est le NOM du fichier, jamais le chemin qui
    // y mène : c'est le chemin que D4 veut voir écrit en dur, pour que l'agent
    // le résolve depuis SON propre home et n'ait rien à deviner.
    if (manualEstUnJeton) {
      it(`${marker} : seul le NOM du mode d'emploi est substitué, pas son dossier`, () => {
        const block = extractBlockAfterMarker(readFile(SDD_FILE), marker);
        expect(block, `${marker} introuvable.`).not.toBeNull();
        expect(
          block.includes("'.claude','prompts'"),
          `${marker} : le dossier du mode d'emploi n'est plus écrit en dur ` +
            `(\`'.claude','prompts'\` attendu dans la commande de résolution).`
        ).toBe(true);
      });
    }
  }
});

describe('SKILL-25 — 10. Contrôle croisé mode d’emploi ↔ prompt d’appel', () => {
  // Les jetons déclarés dans la section « Substitutions » d'un mode d'emploi
  // doivent être EXACTEMENT ceux que son prompt d'appel fournit. C'est le trou
  // qui laisserait un agent lire une consigne dont la valeur n'est jamais
  // fournie — ou recevoir une valeur qu'aucune consigne n'utilise.
  //
  // ⚠️ Restreint aux DEUX couples implémenteur : `prompts/reviewer.md` est un
  // seul fichier pour DEUX blocs d'appel (light sans lentille, deep avec), donc
  // aucune égalité ne peut valoir pour les deux. Ce que le relecteur doit faire
  // sans lentille est vérifié à part, dans sdd-reviewer-wiring-coherence.test.js.
  const COUPLES = [
    { manual: IMPL_SAME, marker: '<!-- APPEL:impl-same -->' },
    { manual: IMPL_CROSS, marker: '<!-- APPEL:impl-cross -->' },
  ];

  // `declaredTokens` vient du module partagé : même granularité que la
  // convention « Substitutions » de F3 (`commands-shape-coherence.test.js`),
  // dont il reproduit la sémantique à l'identique — les deux doivent évoluer
  // ensemble (cf. en-tête de `helpers/prompt-blocks.js`).

  for (const { manual, marker } of COUPLES) {
    // ⚠️ Mutation : renommer un jeton d'UN SEUL côté → rouge.
    it(`${manual} déclare exactement les jetons de ${marker}`, () => {
      const block = extractBlockAfterMarker(readFile(SDD_FILE), marker);
      expect(block, `${marker} introuvable.`).not.toBeNull();
      const declared = [...declaredTokens(readFile(manual))].sort();
      expect(
        declared,
        `${manual} déclare ${JSON.stringify(declared)} alors que ${marker} ` +
          `fournit ${JSON.stringify([...tokensOf(block)].sort())}.`
      ).toEqual([...tokensOf(block)].sort());
    });
  }
});

describe('SKILL-25 — 11. Accusé de lecture', () => {
  // Raison d'être identique à celle, déjà écrite, de la ligne « Modèle
  // utilisé : » : rendre vérifiable PAR L'UTILISATEUR, sur le rapport final, un
  // fait que l'agent seul connaîtrait.
  const ACK_RE = /Mode d'emploi\s*:\s*(impl-(?:same|cross)-[A-Za-z0-9]+)/g;

  function acks(raw) {
    return [...raw.matchAll(new RegExp(ACK_RE))].map((m) => m[1]);
  }

  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    // ⚠️ Mutation : retirer la ligne, ou l'écrire deux fois → rouge.
    it(`${rel} porte EXACTEMENT une ligne d'accusé de lecture`, () => {
      const found = acks(readFile(rel));
      expect(
        found.length,
        `${rel} porte ${found.length} accusé(s) de lecture ${JSON.stringify(found)} ` +
          `— il en faut exactement un.`
      ).toBe(1);
    });
  }

  // ⚠️ Mutation : rendre les deux codes identiques → rouge. Deux codes égaux ne
  // distingueraient plus « j'ai lu le bon fichier » de « j'ai lu un fichier ».
  it('les deux codes sont DISTINCTS', () => {
    const a = acks(readFile(IMPL_SAME))[0];
    const b = acks(readFile(IMPL_CROSS))[0];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toEqual(b);
  });

  // ⚠️ Mutation : écrire le code dans le prompt d'appel → rouge. Il deviendrait
  // devinable sans lire le fichier, et l'accusé n'attesterait plus rien.
  it("aucun des deux codes n'apparaît dans le skill", () => {
    const skill = readFile(SDD_FILE);
    for (const code of [...acks(readFile(IMPL_SAME)), ...acks(readFile(IMPL_CROSS))]) {
      expect(
        skill.includes(code),
        `${SDD_FILE} contient le code d'accusé "${code}" — il est désormais ` +
          `devinable depuis le seul prompt d'appel.`
      ).toBe(false);
    }
  });

  // ⚠️ Mutation : ajouter un accusé à prompts/reviewer.md → rouge. Son format
  // de sortie est délibérément FERMÉ (« ton rapport ne contient que des
  // findings et le TOTAL: ») : une ligne de plus y serait lue comme du contenu,
  // fausserait le comptage `R` et perturberait l'agrégation.
  it(`${REVIEWER} ne porte AUCUN accusé de lecture`, () => {
    const raw = readFile(REVIEWER);
    expect(/Mode d'emploi\s*:\s*\S/.test(raw)).toBe(false);
  });
});

describe('SKILL-25 — 12. La reprise redonne le chemin du mode d’emploi', () => {
  // Trouvé en revue. L'Étape 6.5 est le SEUL endroit où le skill demande
  // explicitement une RELECTURE du mode d'emploi — et c'est aussi le moment où
  // l'implémenteur est le plus susceptible de ne plus détenir le chemin : le
  // prompt d'appel tient en tête de son contexte, donc c'est lui que la
  // compaction résume en premier. Lui dire « relis ton mode d'emploi » sans
  // lui dire où il est le renverrait à traiter les findings DE MÉMOIRE, sans
  // E1/E2/E3 ni format de dispositions — exactement le mode de défaillance que
  // ce ticket existe pour fermer, à l'endroit où il faisait le plus de dégâts.
  // Découpe déléguée à `sectionEntre` (SKILL-47, qui promeut le wrapper
  // local d'alors — cf. specs/skill-42.md, § Amendement) : le helper partagé
  // appelle `extractBetween`, et traduit LUI-MÊME son `null` en rouge explicite,
  // en nommant le fichier et les deux ancres.
  const etape65 = (raw) => sectionEntre(raw, '## Étape 6.5', '## Étape 6.6', SDD_FILE);

  // ⚠️ Mutation : retirer la ligne `node -e … homedir() …` du message de reprise
  // → rouge.
  it("le message de reprise porte la commande de résolution par homedir()", () => {
    const section = etape65(readFile(SDD_FILE));
    expect(
      section.includes('homedir()'),
      `${SDD_FILE} : l'Étape 6.5 ordonne de relire le mode d'emploi sans redonner ` +
        `le moyen de le retrouver.`
    ).toBe(true);
    expect(
      section.includes('~/'),
      `${SDD_FILE} : l'Étape 6.5 résout le chemin par un tilde (non portable).`
    ).toBe(false);
  });

  // ⚠️ Mutation : figer `impl-same.md` en dur dans le message → un implémenteur
  // cross-repo se verrait renvoyé au mode d'emploi de l'AUTRE mode.
  it('le fichier relu est une substitution, pas un nom figé', () => {
    const section = etape65(readFile(SDD_FILE));
    expect(section).toContain('<mode_emploi>');
  });

  // ⚠️ Mutation : remplacer « de ton mode d'emploi » par « de ton prompt
  // initial » (l'état d'avant ce ticket) → rouge : la section n'y est plus.
  it('la reprise renvoie au mode d’emploi, pas au prompt initial', () => {
    const section = etape65(readFile(SDD_FILE));
    expect(section).toContain("de ton mode d'emploi");
    expect(
      /de ton prompt initial/.test(section),
      `${SDD_FILE} : l'Étape 6.5 renvoie encore au « prompt initial » — la ` +
        `section « Si tu es repris avec des findings » n'y est plus.`
    ).toBe(false);
  });
});

// SKILL-26 — l'agrégateur : un troisième mode d'emploi (`prompts/aggregator.md`),
// scanné et cohérent avec son propre prompt d'appel — même dispositif que les
// couples ci-dessus (familles 1 à 10), pas ré-agrégé dans CALL_BLOCKS/COUPLES
// (ceux-ci portent des invariants D4/D9 propres aux QUATRE blocs déjà existants,
// que SKILL-26 n'a pas mandat d'étendre). Autorisation bornée à specs/skill-26.md
// § Portée : « prompts/aggregator.md entre dans le périmètre scanné (F0) ;
// contrôle croisé jetons déclarés ↔ jetons du prompt d'appel ».
const AGGREGATOR = 'prompts/aggregator.md';
const AGGREGATOR_MARKER = '<!-- APPEL:aggregator -->';

describe('SKILL-26 — prompts/aggregator.md existe et est autonome', () => {
  // ⚠️ Mutation : supprimer prompts/aggregator.md → rouge.
  it(`${AGGREGATOR} existe et n'est pas vide`, () => {
    expect(fileExists(AGGREGATOR), `${AGGREGATOR} est absent du dépôt.`).toBe(true);
    expect(readFile(AGGREGATOR).trim().length).toBeGreaterThan(0);
  });

  // ⚠️ Mutation : ajouter un frontmatter `---` en tête → rouge (même raison que
  // pour les modes d'emploi implémenteur/relecteur : lu verbatim par un sous-agent).
  it(`${AGGREGATOR} n'a PAS de frontmatter`, () => {
    const first = readFile(AGGREGATOR).split('\n')[0].trim();
    expect(first === '---').toBe(false);
  });

  // ⚠️ Mutation : retirer le sentinel de propriété → rouge.
  it(`${AGGREGATOR} porte le sentinel de propriété (claude-config / SKILL-NN)`, () => {
    const raw = readFile(AGGREGATOR);
    expect(raw).toContain('claude-config');
    expect(raw).toContain('SKILL-NN');
  });
});

describe('SKILL-26 — contrôle croisé : bloc APPEL:aggregator ↔ prompts/aggregator.md', () => {
  // ⚠️ Mutation : supprimer le marqueur ou sa fence → rouge.
  it(`${AGGREGATOR_MARKER} existe dans ${SDD_FILE}, en bloc à quatre backticks`, () => {
    const block = extractBlockAfterMarker(readFile(SDD_FILE), AGGREGATOR_MARKER);
    expect(
      block,
      `Marqueur ${AGGREGATOR_MARKER} introuvable dans ${SDD_FILE}, ou non suivi ` +
        `d'un bloc à quatre backticks.`
    ).not.toBeNull();
  });

  // ⚠️ Mutation : ajouter/retirer une variable d'UN SEUL côté (bloc d'appel ou
  // section Substitutions de prompts/aggregator.md) → rouge.
  it(`${AGGREGATOR} déclare exactement les jetons de ${AGGREGATOR_MARKER}`, () => {
    const block = extractBlockAfterMarker(readFile(SDD_FILE), AGGREGATOR_MARKER);
    expect(block, `${AGGREGATOR_MARKER} introuvable.`).not.toBeNull();
    const declared = [...declaredTokens(readFile(AGGREGATOR))].sort();
    expect(
      declared,
      `${AGGREGATOR} déclare ${JSON.stringify(declared)} alors que ` +
        `${AGGREGATOR_MARKER} fournit ${JSON.stringify([...tokensOf(block)].sort())}.`
    ).toEqual([...tokensOf(block)].sort());
  });

  // ⚠️ Mutation : faire pointer le bloc d'appel vers reviewer.md au lieu
  // d'aggregator.md → rouge. C'est précisément le pointeur système que le
  // prompt d'appel doit écraser (§ Décision 3 de specs/skill-26.md).
  it(`${AGGREGATOR_MARKER} nomme aggregator.md et écrase le pointeur du system prompt`, () => {
    const block = extractBlockAfterMarker(readFile(SDD_FILE), AGGREGATOR_MARKER);
    expect(block).not.toBeNull();
    expect(block.includes('aggregator.md')).toBe(true);
    expect(/ne s'applique PAS|NE S'APPLIQUE PAS/i.test(block)).toBe(true);
  });
});

// SKILL-90 — la case manquante « spec contradictoire », entre « ambiguë » et
// « tests cassés », au § « Si tu te trouves bloqué » des DEUX modes d'emploi
// implémenteur ; et sa déclaration optionnelle au § « Rapport final attendu »
// (D1). Bornée au CORPS de la section « Si tu te trouves bloqué » via le
// helper partagé `extractSection` (en-tête EXCLU, jusqu'au prochain `## ` —
// ou EOF si aucun ne suit, ce qui est le cas ICI : c'est la dernière section
// des deux fichiers, mais `extractSection` ne PRÉSUME pas de cette place,
// contrairement à un `raw.slice(raw.indexOf(heading))` qui engloberait
// silencieusement une section future ajoutée après elle (finding 9, gate de
// revue de ce ticket).
const BLOQUE_HEADING_RE = /^## Si tu te trouves bloqué\s*$/;

function sectionBloque(raw) {
  const section = extractSection(raw, BLOQUE_HEADING_RE);
  expect(section, `"## Si tu te trouves bloqué" introuvable.`).not.toBeNull();
  return section;
}

// Un bullet Markdown de cette section peut s'étaler sur PLUSIEURS lignes (le
// bullet "ambiguë" en fait déjà deux) : ne JAMAIS isoler un bullet par sa
// seule première ligne (`split('\n')`), qui laisserait une mutation « replier
// la case contradictoire dans la SECONDE ligne du bullet ambiguë » invisible
// (finding 7, gate de revue de ce ticket). `split(/\n(?=- )/)` capture le
// bullet EN ENTIER, jusqu'au prochain `- ` en début de ligne ou la fin de
// section.
function bullets(section) {
  return section.split(/\n(?=- )/);
}

describe('SKILL-90 — 1. La case « spec contradictoire », distincte de « ambiguë »', () => {
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    // ⚠️ Mutation : retirer la case entière → rouge.
    it(`${rel} § "Si tu te trouves bloqué" nomme le cas "contradictoire"`, () => {
      const section = sectionBloque(readFile(rel));
      expect(
        /contradictoire/i.test(section),
        `${rel} § "Si tu te trouves bloqué" ne nomme pas le cas "contradictoire".`
      ).toBe(true);
    });

    // ⚠️ Mutation : fusionner la nouvelle case dans le bullet "ambiguë"
    // existant (au lieu d'un bullet distinct) → rouge, y compris si la fusion
    // se fait dans la SECONDE ligne du bullet "ambiguë" (finding 7 : la
    // fonction `bullets()` capture le bullet complet, pas sa seule première
    // ligne).
    it(`${rel} : la case "contradictoire" est un bullet DISTINCT de "ambiguë"`, () => {
      const section = sectionBloque(readFile(rel));
      const ambigue = bullets(section).find((b) => /^- Spec \*{0,2}ambiguë/i.test(b));
      expect(
        ambigue,
        `${rel} : le bullet "Spec ambiguë" introuvable sous "Si tu te trouves bloqué".`
      ).not.toBeUndefined();
      expect(
        /contradictoire/i.test(ambigue),
        `${rel} : le bullet "ambiguë" (texte complet, pas sa seule première ` +
          `ligne) porte lui-même le mot "contradictoire" — la case n'est pas ` +
          `distincte.`
      ).toBe(false);
    });
  }
});

describe('SKILL-90 — 2. La case prescrit les DEUX gestes : trancher ET déclarer', () => {
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    // ⚠️ Mutation : retirer la moitié "déclarer" (ne garder que "tranche") →
    // rouge.
    it(`${rel} : la case contradictoire prescrit de trancher ET de déclarer au rapport`, () => {
      const section = sectionBloque(readFile(rel));
      const bullet = bullets(section).find((b) => /contradictoire/i.test(b));
      expect(bullet, `${rel} : aucun bullet ne nomme "contradictoire".`).not.toBeUndefined();
      expect(
        /tranche/i.test(bullet),
        `${rel} : la case contradictoire ne prescrit plus de trancher.`
      ).toBe(true);
      expect(
        /déclare/i.test(bullet) && /rapport/i.test(bullet),
        `${rel} : la case contradictoire ne prescrit plus de déclarer au rapport final.`
      ).toBe(true);
    });
  }
});

describe('SKILL-90 — 3. Les deux modes d’emploi portent ce passage MOT POUR MOT', () => {
  // ⚠️ Mutation : modifier un seul des deux fichiers (le bullet bloqué OU la
  // section de déclaration du rapport) → rouge.
  it('le bullet "contradictoire" de "Si tu te trouves bloqué" est identique dans les deux fichiers', () => {
    const extraitBullet = (raw) => bullets(sectionBloque(raw)).find((b) => /contradictoire/i.test(b));
    const same = extraitBullet(readFile(IMPL_SAME));
    const cross = extraitBullet(readFile(IMPL_CROSS));
    expect(same).not.toBeUndefined();
    expect(cross).not.toBeUndefined();
    expect(same).toEqual(cross);
  });

  // Régression réelle du premier jet (finding 3, gate de revue de ce ticket) :
  // l'extraction précédente calculait `finBullet` en cherchant `\n- (?!\s)` à
  // partir du DÉBUT du bullet lui-même — qui matche sa propre première ligne
  // (`\n- **Escalade…`), à l'index 0. `slice(0, 0)` rendait TOUJOURS la
  // chaîne vide, et `expect('').toEqual('')` passait quel que soit le contenu
  // réel des deux fichiers — un test qui ne pouvait JAMAIS rougir. Fixé en
  // réutilisant `bullets()`, la même découpe déjà éprouvée pour le bullet
  // "contradictoire" ci-dessus : elle isole le bullet AVANT de chercher le
  // suivant, pas depuis son propre début.
  it('la section de déclaration d’escalade du "Rapport final attendu" est identique dans les deux fichiers', () => {
    const extraitDeclaration = (raw) => {
      const section = extractSection(raw, /^## Rapport final attendu\s*$/);
      expect(section, `"## Rapport final attendu" introuvable.`).not.toBeNull();
      const bullet = bullets(section).find((b) =>
        b.includes('Escalade de spec (première passe)')
      );
      expect(
        bullet,
        `"Escalade de spec (première passe)" introuvable sous "## Rapport ` +
          `final attendu" — la section de déclaration optionnelle (D1) a disparu.`
      ).not.toBeUndefined();
      return bullet;
    };
    const same = extraitDeclaration(readFile(IMPL_SAME));
    const cross = extraitDeclaration(readFile(IMPL_CROSS));
    expect(same).toEqual(cross);
  });
});

// SKILL-84 — un appel d'outil REFUSÉ par le harnais est un ARRÊT, pas un
// obstacle à contourner (incident réel du cycle de SKILL-74 : un `Edit` refusé
// par le classifieur d'auto-mode a été rejoué via `sed` en Bash). D1
// (specs/skill-84.md) : la MÊME consigne, mot pour mot, dans les QUATRE
// `prompts/*.md` — deux sections d'accueil DISTINCTES, puisqu'aucun mécanisme
// d'inclusion n'existe entre ces fichiers (chacun est lu SEUL par un
// sous-agent, invariant d'autonomie SKILL-25/SKILL-54) :
//   - `## Si tu te trouves bloqué` pour les deux implémenteurs (précédent
//     SKILL-90, ci-dessus) ;
//   - `## ⛔ Interdictions absolues` pour le relecteur et l'agrégateur.
const INTERDICTIONS_HEADING_RE = /^## ⛔ Interdictions absolues\s*$/;

function sectionInterdictions(raw) {
  const section = extractSection(raw, INTERDICTIONS_HEADING_RE);
  expect(section, `"## ⛔ Interdictions absolues" introuvable.`).not.toBeNull();
  return section;
}

// Les quatre porteurs — (fichier, extracteur de SA section d'accueil), D1.
const PORTEURS_SKILL_84 = [
  { rel: IMPL_SAME, section: sectionBloque },
  { rel: IMPL_CROSS, section: sectionBloque },
  { rel: REVIEWER, section: sectionInterdictions },
  { rel: AGGREGATOR, section: sectionInterdictions },
];

// Isole le bullet complet (via `bullets()`, jamais sa seule première ligne —
// même garde que SKILL-90 ci-dessus) qui porte le nouveau bullet SKILL-84.
//
// ⚠️ Finding 7 (gate de reprise) : la sélection ne doit PAS reposer sur un mot
// qu'une famille ci-dessous réassertionne ensuite sur le résultat — sinon
// cette assertion est vraie PAR CONSTRUCTION et ne peut jamais rougir (le cas
// réel : sélectionner via `/refus/i` puis réassertionner `/refus/i.test(bullet)`
// dans la famille 3). L'ancre `"classifieur d'auto-mode"` est distinctive
// (seule occurrence des quatre fichiers) et n'est elle-même testée par AUCUNE
// famille ci-dessous — même précédent que SKILL-90 (sélection sur
// `/^- Spec \*{0,2}ambiguë/i`, jamais sur les mots ensuite réassertionnés).
const ANCRE_SELECTION = /classifieur d'auto-mode/i;

function bulletRefus(raw, sectionFn) {
  const chunk = bullets(sectionFn(raw)).find((b) => ANCRE_SELECTION.test(b));
  if (chunk === undefined) return undefined;
  // ⚠️ Finding 6 (gate de reprise) : NE PAS couper au premier `\n\n` — un item
  // de liste Markdown "loose" peut légitimement contenir PLUSIEURS paragraphes
  // séparés par une ligne vide, tant que leurs lignes de continuation restent
  // INDENTÉES sous le marqueur. Une coupe au premier `\n\n` retirerait alors
  // du texte comparé une divergence RÉELLE entre les quatre fichiers (ex. une
  // exception ajoutée dans un seul fichier, dans un second paragraphe
  // indenté) sans que la famille 4 ne la voie — elle resterait verte sur des
  // extraits tronqués identiques, alors que les bullets sources divergent.
  //
  // Le signal qui distingue une continuation de liste (à garder) d'une prose
  // hors-liste qui suit la FIN de la section (à couper — ex. "Tu as carte
  // blanche…" quand ce bullet est le dernier de sa section) est
  // l'INDENTATION : une continuation de liste reste indentée, une ligne hors
  // liste démarre en colonne 0.
  const lignes = chunk.split('\n');
  const gardees = [lignes[0]];
  let i = 1;
  while (i < lignes.length) {
    const ligne = lignes[i];
    if (ligne === '') {
      // Ligne vide : regarde la prochaine ligne NON VIDE. Indentée → c'est un
      // paragraphe de continuation du MÊME item, on la garde (avec la ligne
      // vide qui la précède). Sinon → prose hors liste, on s'arrête AVANT
      // cette ligne vide, sans la consommer.
      let j = i + 1;
      while (j < lignes.length && lignes[j] === '') j++;
      if (j < lignes.length && /^\s/.test(lignes[j])) {
        gardees.push(ligne);
        i++;
        continue;
      }
      break;
    }
    if (!/^\s/.test(ligne)) break; // ligne non indentée : hors de ce bullet
    gardees.push(ligne);
    i++;
  }
  return gardees.join('\n').trimEnd();
}

describe('SKILL-84 — 1. Présence, par fichier : un bullet distinct nomme le refus du harnais', () => {
  for (const { rel, section } of PORTEURS_SKILL_84) {
    // ⚠️ Mutation-témoin (§ Tests, point 1) : retirer le bullet d'UN SEUL des
    // quatre fichiers → rouge.
    it(`${rel} : la section d'accueil porte un bullet nommant le refus du harnais`, () => {
      const bullet = bulletRefus(readFile(rel), section);
      expect(
        bullet,
        `${rel} : aucun bullet de la section d'accueil ne nomme un "refus" ` +
          `(appel d'outil refusé par le harnais).`
      ).not.toBeUndefined();
      expect(
        /harnais/i.test(bullet),
        `${rel} : le bullet "refus" ne nomme pas le harnais.`
      ).toBe(true);
    });
  }
});

describe("SKILL-84 — 2. Le bullet prescrit les DEUX gestes : s'arrêter ET le dire dans ce qu'on rend", () => {
  for (const { rel, section } of PORTEURS_SKILL_84) {
    // ⚠️ Mutation-témoin (§ Tests, point 2) : retirer la moitié "s'arrêter",
    // ou la moitié "le dire dans ce qu'on rend" → rouge.
    it(`${rel} : le bullet prescrit d'arrêter ET de le déclarer dans ce qu'on rend`, () => {
      const bullet = bulletRefus(readFile(rel), section);
      expect(bullet).not.toBeUndefined();
      expect(
        /arrête/i.test(bullet),
        `${rel} : le bullet "refus" ne prescrit plus de s'arrêter.`
      ).toBe(true);
      expect(
        /rends/i.test(bullet),
        `${rel} : le bullet "refus" ne prescrit plus de le dire dans ce qu'on rend.`
      ).toBe(true);
    });
  }
});

describe('SKILL-84 — 3. La frontière D2 est écrite : refus ≠ erreur, rejeu "par un autre outil" nommé', () => {
  for (const { rel, section } of PORTEURS_SKILL_84) {
    // ⚠️ Mutation-témoin (§ Tests, point 3) : retirer la distinction
    // refus/erreur, ou l'interdit nommé "par un autre outil" → rouge.
    it(`${rel} : le bullet distingue nommément "refus" et "erreur", et interdit nommément le rejeu par un autre outil`, () => {
      const bullet = bulletRefus(readFile(rel), section);
      expect(bullet).not.toBeUndefined();
      expect(/refus/i.test(bullet), `${rel} : "refus" absent du bullet.`).toBe(true);
      expect(/erreur/i.test(bullet), `${rel} : "erreur" absent du bullet.`).toBe(true);
      expect(
        /autre outil/i.test(bullet),
        `${rel} : l'interdit "par un autre outil" n'est pas nommé dans le bullet.`
      ).toBe(true);
    });
  }
});

describe('SKILL-84 — 4. Identité mot pour mot des QUATRE fichiers', () => {
  // ⚠️ Précédent obligatoire (§ Tests, point 4 — finding 3 de la gate de
  // SKILL-90) : vérifier NON-VIDE et au-dessus d'un PLANCHER de longueur
  // AVANT de comparer. Sans ce garde, une extraction cassée qui rend '' pour
  // les quatre fichiers rendrait `expect('').toEqual('')` vert quel que soit
  // le contenu réel. Mutation-témoin : neutraliser l'extraction (renommer
  // l'ancre de section dans un seul fichier) → rouge, pas vert.
  it('chaque extrait est non vide et dépasse un plancher de longueur', () => {
    for (const { rel, section } of PORTEURS_SKILL_84) {
      const bullet = bulletRefus(readFile(rel), section);
      expect(bullet, `${rel} : bullet "refus" introuvable.`).not.toBeUndefined();
      expect(
        bullet.length,
        `${rel} : l'extrait du bullet "refus" est trop court (${bullet.length} ` +
          `caractères) — l'extraction est probablement cassée.`
      ).toBeGreaterThan(100);
    }
  });

  // ⚠️ Mutation-témoin (§ Tests, point 4) : modifier UN SEUL des quatre
  // fichiers (même un seul mot du bullet) → rouge.
  it('le bullet "refus du harnais" est identique dans les QUATRE fichiers', () => {
    const extraits = PORTEURS_SKILL_84.map(({ rel, section }) => bulletRefus(readFile(rel), section));
    for (const e of extraits) expect(e).not.toBeUndefined();
    const [reference, ...autres] = extraits;
    for (let i = 0; i < autres.length; i++) {
      expect(
        autres[i],
        `${PORTEURS_SKILL_84[i + 1].rel} diverge de ${PORTEURS_SKILL_84[0].rel} ` +
          `sur le bullet "refus du harnais" — l'identité mot pour mot est rompue.`
      ).toEqual(reference);
    }
  });
});
