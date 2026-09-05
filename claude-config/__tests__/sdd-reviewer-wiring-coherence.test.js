// SKILL-23 — câblage de l'Étape 6.3 de commands/sdd-run-ticket.md sur
// l'agent-def dédié `sdd-reviewer` (au lieu de `general-purpose` sans modèle).
//
// Contexte (specs/skill-23.md) : avant ce ticket, la gate de revue spawnait ses
// relecteurs en `subagent_type: "general-purpose"` SANS paramètre `model` → ils
// héritaient du modèle ET de l'effort de la session orchestratrice. La
// puissance de la revue était donc un effet de bord d'un réglage sans rapport.
// Ce test verrouille deux choses, SÉPARÉMENT :
// (1) l'Étape 6.3 spawne bien `subagent_type: "sdd-reviewer"` — l'agent-def
//     GÉNÉRÉ (model: opus, effort: high, verrouillé par
//     agent-defs-coherence.test.js) — et ne mentionne plus `general-purpose` ;
// (2) le DOSAGE (nombre de relecteurs : none→0, light→1, deep→3) reste
//     intact — c'est le point du ticket : on change le TYPE d'agent spawné,
//     pas le NOMBRE. Vérifié au niveau de la lecture du texte, indépendamment
//     du subagent_type utilisé (spec, section Tests, point 3).
//
// Doit rougir AVANT que l'Étape 6.3 soit modifiée — étape 2 du SDD.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// Helpers PARTAGÉS avec impl-templates-coherence.test.js — un seul exemplaire.
// Recopiés, ils divergent en silence (au premier jet de SKILL-25, l'un
// normalisait CRLF avant de découper les paragraphes et l'autre non), et un
// assouplissement futur de la convention n'en corrigerait qu'une moitié.
import {
  readNormalized,
  extractBlockAfterMarker,
  hasSectionHeading,
  sectionEntre,
} from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SDD_FILE = 'commands/sdd-run-ticket.md';
// SKILL-25 : le mode d'emploi du relecteur sort du skill et devient un fichier
// que le relecteur lit lui-même (specs/skill-25.md).
const REVIEWER_FILE = 'prompts/reviewer.md';

const readSddFile = () => readNormalized(REPO_ROOT, SDD_FILE);
const readReviewerFile = () => readNormalized(REPO_ROOT, REVIEWER_FILE);

// Isole le texte de l'Étape 6.3 (jusqu'au prochain `## Étape 6.4`) : les
// assertions ci-dessous ne doivent porter que sur cette section, pas sur tout
// le fichier (l'Étape 6, implémenteur, cite légitimement `sdd-impl-<palier>`
// et un paramètre `model` par appel — un tout autre mécanisme, SKILL-22).
// Découpe déléguée à `sectionEntre` (SKILL-47, qui promeut le wrapper
// local d'alors — cf. specs/skill-42.md, § Amendement) : le helper partagé
// appelle `extractBetween`, et traduit LUI-MÊME son `null` en rouge explicite,
// en nommant le fichier et les deux ancres.
const extractEtape63 = (raw) => sectionEntre(raw, '## Étape 6.3', '## Étape 6.4', SDD_FILE);

describe('SKILL-23 — Étape 6.3 spawne sdd-reviewer, pas general-purpose', () => {
  const raw = readSddFile();
  const etape63 = extractEtape63(raw);

  // Mutation-témoin : remettre `subagent_type: "general-purpose"` → rougit.
  it('cite `subagent_type: "sdd-reviewer"`', () => {
    expect(etape63).toContain('subagent_type: "sdd-reviewer"');
  });

  // Mutation-témoin : réintroduire `general-purpose` n'importe où dans
  // l'Étape 6.3 → rougit. Portée à tout le fichier : l'héritage de session ne
  // doit plus apparaître nulle part pour la gate de revue.
  it('ne mentionne plus `general-purpose` nulle part dans le fichier', () => {
    expect(raw).not.toContain('general-purpose');
  });

  // Mutation-témoin : ajouter `model: "<model>"` à l'appel Agent de l'Étape
  // 6.3 (réintroduire un override par appel, alors que le réglage doit être
  // FIXE côté agent-def) → rougit.
  it('ne passe pas de paramètre `model` à l’appel Agent du relecteur', () => {
    expect(etape63).not.toMatch(/model:\s*"<model>"/);
  });

  it('documente le réglage fixe (model: opus, effort: high) porté par l’agent-def', () => {
    expect(etape63).toMatch(/model:\s*opus/);
    expect(etape63).toMatch(/effort:\s*high/);
  });
});

describe('SKILL-23 — non-régression du dosage (nombre de relecteurs, inchangé)', () => {
  const raw = readSddFile();

  // Mutation-témoin : muter `**1**` → `**2**` (ou l'inverse pour deep) dans la
  // description du dosage `light`/`deep` → rougit. Le NOMBRE de relecteurs
  // n'est pas concerné par ce ticket — seul le TYPE d'agent spawné change.
  it('`light` → 1 relecteur, `deep` → 3 relecteurs (table Étape 2)', () => {
    expect(raw).toMatch(/\|\s*`light`[^|]*\|\s*1 relecteur vierge/);
    expect(raw).toMatch(/\|\s*`deep`\s*\|\s*3 relecteurs vierges en parallèle/);
  });

  it('Étape 6.3 : `light` → **1** relecteur, `deep` → **3** relecteurs en parallèle', () => {
    expect(raw).toMatch(/`light`\s*→\s*\*\*1\*\*\s*relecteur/);
    expect(raw).toMatch(/`deep`\s*→\s*\*\*3\*\*\s*relecteurs\s*\*\*en parallèle\*\*/);
  });

  it('`review: none` saute la gate entière (0 relecteur) — Étape 6.2', () => {
    expect(raw).toMatch(/Si le dosage vaut `none`.*saute le reste de cette étape/);
  });
});

// --- SKILL-25 : le mode d'emploi du relecteur est un FICHIER ----------------
//
// Les 7 assertions SKILL-23 ci-dessus restent inchangées et vertes : si l'une
// rougit, c'est la réécriture de l'Étape 6.3 qui est fautive, pas l'ancre.
//
// ⚠️ D3 : toutes les listes de contrôle ci-dessous sont DÉCLARÉES ICI, jamais
// lues du fichier qu'elles contrôlent.

describe('SKILL-25 — prompts/reviewer.md existe et porte ses sections obligatoires', () => {
  // ⚠️ Mutation : supprimer le fichier → rouge.
  it('le fichier existe, non vide, SANS frontmatter', () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, REVIEWER_FILE)),
      `${REVIEWER_FILE} est absent — le relecteur n'aurait plus de mode d'emploi.`
    ).toBe(true);
    const raw = readReviewerFile();
    expect(raw.trim().length).toBeGreaterThan(0);
    expect(raw.split('\n')[0].trim() === '---').toBe(false);
  });

  it('il porte le sentinel de propriété (claude-config / SKILL-NN)', () => {
    const raw = readReviewerFile();
    expect(raw).toContain('claude-config');
    expect(raw).toContain('SKILL-NN');
  });

  // ⚠️ Mutation, une par entrée : retirer cette section → rouge.
  const REVIEWER_SECTIONS = [
    '## Étape 0',
    '## Étape 1',
    '## Étape 2',
    '## ⛔ Interdictions absolues',
    '## Axes de relecture',
    '## Format de sortie IMPOSÉ',
    '## Substitutions',
  ];

  for (const heading of REVIEWER_SECTIONS) {
    it(`il porte la section "${heading}"`, () => {
      expect(
        hasSectionHeading(readReviewerFile(), heading),
        `${REVIEWER_FILE} ne porte pas de section "${heading}".`
      ).toBe(true);
    });
  }
});

describe('SKILL-25 — prompts/reviewer.md absorbe les 4 axes (fin de l’injection <AXES>)', () => {
  // Une ancre par axe. ⚠️ Mutation : en retirer un → rouge. C'est précisément
  // ce que l'ancienne injection rendait possible : un orchestrateur qui recopie
  // trois axes sur quatre, sans que rien ne le signale.
  const AXES = [
    'Conformité à la spec',
    'Contrats & données',
    'Simplification & réutilisation',
    'Conformité aux règles du `CLAUDE.md`',
  ];

  for (const axis of AXES) {
    it(`il porte l'axe « ${axis} »`, () => {
      expect(readReviewerFile().includes(axis)).toBe(true);
    });
  }

  // ⚠️ Mutation : retirer « tu les reçois TOUS » → rouge. Les axes ne sont pas
  // une partition ; sans cette phrase, un relecteur peut se croire cantonné.
  it('il dit que les axes sont reçus TOUS, jamais un sous-ensemble', () => {
    expect(readReviewerFile()).toContain('tu les reçois TOUS');
  });

  // ⚠️ Mutation : retirer la phrase → le relecteur `light` resterait devant un
  // `<AXE_PRIORITAIRE>` non résolu, sans savoir quoi en faire.
  it('il dit quoi faire SANS lentille (dosage light) : balayer les quatre dans l’ordre', () => {
    const raw = readReviewerFile();
    const paragraphs = raw.split('\n\n');
    const hasNoLens = paragraphs.some(
      (p) => /aucune lentille|pas de lentille|sans lentille/i.test(p) && /quatre|4 axes/i.test(p)
    );
    expect(
      hasNoLens,
      `${REVIEWER_FILE} : aucun paragraphe ne dit quoi faire quand aucune ` +
        `lentille prioritaire n'est donnée.`
    ).toBe(true);
  });
});

describe('SKILL-25 — prompts/reviewer.md garde le format de sortie fermé', () => {
  // ⚠️ Mutation : retirer l'interdiction d'écrire d'un relecteur réputé
  // read-only → rouge. Sa consigne est déclarative : elle doit au moins être
  // écrite.
  it("il interdit d'écrire, modifier ou créer un fichier", () => {
    const raw = readReviewerFile();
    expect(raw).toContain("N'écris, ne modifie, ne crée AUCUN fichier");
  });

  it('il impose la ligne finale `TOTAL:`', () => {
    expect(readReviewerFile()).toContain('TOTAL:');
  });

  // ⚠️ Mutation : retirer l'interdiction des remarques « en passant » → rouge.
  // C'est le pire des deux mondes : assez visible pour montrer qu'on l'avait
  // vu, pas assez structuré pour que quiconque soit tenu de le corriger.
  it('il interdit les remarques « en passant » hors format', () => {
    expect(readReviewerFile()).toContain('en passant');
  });
});

describe('SKILL-25 — l’Étape 6.3 ne porte plus le corps du mode d’emploi relecteur', () => {
  const raw = readSddFile();
  const etape63 = extractEtape63(raw);

  // ⚠️ Mutation : recoller le template relecteur dans l'Étape 6.3 → rouge.
  for (const anchor of ['Format de sortie IMPOSÉ', 'TOTAL:', 'Interdictions absolues']) {
    it(`l'Étape 6.3 ne contient plus "${anchor}"`, () => {
      expect(
        etape63.includes(anchor),
        `L'Étape 6.3 contient encore "${anchor}" — le mode d'emploi du relecteur ` +
          `a été recopié dans le skill.`
      ).toBe(false);
    });
  }

  // ⚠️ Mutation : réintroduire l'injection `<AXES>` → rouge. Les axes sont
  // désormais un INVARIANT du fichier, plus une valeur que l'orchestrateur
  // recopie (et peut donc amputer).
  it('`<AXES>` n’apparaît plus NULLE PART dans le skill', () => {
    expect(raw.includes('<AXES>')).toBe(false);
  });

  // ⚠️ Mutation : retirer le nom du fichier → l'orchestrateur n'aurait plus de
  // quoi composer le pointeur.
  it('l’Étape 6.3 nomme prompts/reviewer.md et ordonne sa lecture', () => {
    expect(etape63).toContain('reviewer.md');
    expect(/lis-le|lire|Read/i.test(etape63)).toBe(true);
  });
});

describe('SKILL-25 — l’agent-def du relecteur n’annonce plus d’axes dans le prompt d’appel', () => {
  // Trouvé en revue. L'agent-def est chargé AVANT le prompt d'invocation :
  // s'il annonce au relecteur que « les axes de relecture » arrivent dans ce
  // prompt, le relecteur les y cherche, ne les trouve pas (ils sont désormais
  // dans prompts/reviewer.md) et conclut à un prompt tronqué — alors que son
  // mode d'emploi lui interdit explicitement d'en improviser.
  //
  // Assertion sur le fichier SUR DISQUE : c'est lui que le harnais charge. Sa
  // cohérence avec le générateur est verrouillée à part, par
  // agent-defs-coherence.test.js — les deux sont nécessaires.
  const AGENT_DEF = 'agents/sdd-reviewer.md';

  // ⚠️ Mutation : remettre « les axes de relecture » dans l'énumération de ce
  // qui arrive par le prompt d'invocation → rouge.
  it("il ne promet plus les axes dans le prompt d'invocation", () => {
    const raw = readNormalized(REPO_ROOT, AGENT_DEF);
    const promise = raw.slice(raw.indexOf('Ta tâche concrète'), raw.indexOf('pas ici'));
    expect(
      /axes/i.test(promise),
      `${AGENT_DEF} annonce des axes dans le prompt d'invocation — ils vivent ` +
        `désormais dans ${REVIEWER_FILE}, que le relecteur lit lui-même.`
    ).toBe(false);
  });

  // ⚠️ Mutation : retirer le renvoi → l'agent-def ne dirait plus où est le
  // reste de la conduite, et le relecteur n'aurait qu'un pointeur muet.
  it(`il renvoie explicitement à ${REVIEWER_FILE}`, () => {
    expect(readNormalized(REPO_ROOT, AGENT_DEF)).toContain(REVIEWER_FILE);
  });
});

describe('SKILL-25 — la lentille prioritaire n’existe qu’en dosage deep', () => {
  const raw = readSddFile();

  // ⚠️ Mutation : mettre la lentille dans le bloc `light` → rouge. Le relecteur
  // unique cesserait de balayer les quatre axes à égalité — or `light` n'achète
  // qu'un tirage, il n'a aucune raison d'en privilégier un.
  it('le bloc APPEL:reviewer-light ne porte PAS `<AXE_PRIORITAIRE>`', () => {
    const block = extractBlockAfterMarker(raw, '<!-- APPEL:reviewer-light -->');
    expect(block, 'Marqueur <!-- APPEL:reviewer-light --> introuvable.').not.toBeNull();
    expect(block.includes('<AXE_PRIORITAIRE>')).toBe(false);
  });

  // ⚠️ Mutation : retirer la lentille du bloc `deep` → les trois relecteurs
  // recevraient un prompt identique, et `deep` cesserait d'acheter trois
  // tirages décorrélés.
  it('le bloc APPEL:reviewer-deep porte `<AXE_PRIORITAIRE>`', () => {
    const block = extractBlockAfterMarker(raw, '<!-- APPEL:reviewer-deep -->');
    expect(block, 'Marqueur <!-- APPEL:reviewer-deep --> introuvable.').not.toBeNull();
    expect(block.includes('<AXE_PRIORITAIRE>')).toBe(true);
  });
});
