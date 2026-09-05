// SKILL-22 — cohérence des agent-defs GÉNÉRÉS ↔ disque.
//
// Contexte (specs/skill-22.md, décision point 2) : `agents/sdd-impl-*.md` sont
// des ARTEFACTS GÉNÉRÉS par `tools/agent-defs/generate.mjs`. Chaque fichier
// porte un sentinel « GÉNÉRÉ — NE PAS ÉDITER À LA MAIN ». Ce test régénère en
// mémoire et DIFFE contre le disque : toute édition manuelle ou dérive le fait
// rougir. Même pattern que `backlog.json` / `migrations-coherence` (cf.
// __tests__/impl-templates-coherence.test.js pour la convention de ce repo).
//
// ⚠️ CRLF : ce repo tourne sous Windows avec `core.autocrlf=true`. Le générateur
// écrit du LF ; `.gitattributes` force `eol=lf` sur ces fichiers, mais on
// normalise quand même les deux côtés avant de comparer — on ne reproduit pas le
// défaut non-CRLF-robuste de lib/backlog historique (feedback_h3_crlf_windows_ci).
//
// Doit rougir AVANT que les fichiers existent — étape 2 du SDD.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildAgentDefs, buildReviewerDef } from '../tools/agent-defs/generate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');

const REGEN = 'régénérer : node tools/agent-defs/generate.mjs';
const normalizeEol = (s) => s.replace(/\r\n/g, '\n');

describe('SKILL-22 — cohérence agent-defs générés ↔ disque', () => {
  const defs = buildAgentDefs();

  it('un fichier par palier existe sur disque', () => {
    for (const def of defs) {
      const filePath = path.join(AGENTS_DIR, def.filename);
      expect(fs.existsSync(filePath), `${def.filename} manquant — ${REGEN}`).toBe(true);
    }
  });

  // Mutation-témoin : éditer à la main un `agents/sdd-impl-*.md` (changer une
  // ligne, retirer le sentinel, altérer le tools:) → ce test rougit tant qu'on
  // n'a pas régénéré.
  for (const def of defs) {
    it(`${def.filename} sur disque == sortie du générateur`, () => {
      const filePath = path.join(AGENTS_DIR, def.filename);
      expect(fs.existsSync(filePath), `${def.filename} manquant — ${REGEN}`).toBe(true);
      const onDisk = normalizeEol(fs.readFileSync(filePath, 'utf8'));
      expect(
        onDisk,
        `${def.filename} a dérivé du générateur (édition manuelle ?) — ${REGEN}`
      ).toBe(normalizeEol(def.content));
    });
  }

  // Mutation-témoin : déposer un `agents/sdd-impl-foo.md` que le générateur ne
  // produit pas (palier fantôme) → ce test rougit.
  it('aucun sdd-impl-*.md orphelin (non produit par le générateur) sur disque', () => {
    if (!fs.existsSync(AGENTS_DIR)) {
      throw new Error(`agents/ absent — ${REGEN}`);
    }
    const expected = new Set(defs.map((d) => d.filename));
    const onDisk = fs
      .readdirSync(AGENTS_DIR)
      .filter((f) => /^sdd-impl-.*\.md$/.test(f));
    for (const f of onDisk) {
      expect(
        expected.has(f),
        `${f} présent sur disque mais absent de la sortie du générateur — ${REGEN}`
      ).toBe(true);
    }
  });
});

// SKILL-23 — cohérence de l'agent-def du relecteur (sdd-reviewer.md), même
// pattern que ci-dessus mais SÉPARÉ : le relecteur n'est pas un palier parmi
// d'autres (buildAgentDefs() ne l'inclut pas), et il porte model+effort figés
// que buildReviewerDef() seul construit.
describe('SKILL-23 — cohérence agent-def relecteur (sdd-reviewer.md) générée ↔ disque', () => {
  const reviewerDef = buildReviewerDef();
  const filePath = path.join(AGENTS_DIR, reviewerDef.filename);

  it('agents/sdd-reviewer.md existe sur disque', () => {
    expect(fs.existsSync(filePath), `${reviewerDef.filename} manquant — ${REGEN}`).toBe(true);
  });

  // Mutation-témoin : éditer sdd-reviewer.md à la main (changer model/effort,
  // retirer le sentinel) → ce test rougit tant qu'on n'a pas régénéré.
  it('sdd-reviewer.md sur disque == sortie du générateur', () => {
    expect(fs.existsSync(filePath), `${reviewerDef.filename} manquant — ${REGEN}`).toBe(true);
    const onDisk = normalizeEol(fs.readFileSync(filePath, 'utf8'));
    expect(
      onDisk,
      `sdd-reviewer.md a dérivé du générateur (édition manuelle ?) — ${REGEN}`
    ).toBe(normalizeEol(reviewerDef.content));
  });

  it('porte model: opus et effort: high figés (indépendant de la session)', () => {
    expect(reviewerDef.content).toMatch(/^model: opus$/m);
    expect(reviewerDef.content).toMatch(/^effort: high$/m);
  });
});
