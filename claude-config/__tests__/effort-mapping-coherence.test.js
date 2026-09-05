// SKILL-22 — le générateur d'agent-defs par palier de reasoning et ses deux
// shims de mapping (effort → palier → subagent_type).
//
// Contexte (specs/skill-22.md) : `exec.effort` était DÉCORATIF pour
// l'implémenteur SDD — l'outil `Agent` ne prend pas de paramètre d'effort, seule
// une injection en prose du prompt en portait la trace. Le SEUL levier mécanique
// du reasoning d'un sous-agent est le champ `effort:` du frontmatter d'un
// `.claude/agents/*.md` (doc officielle : valeurs `low|medium|high|xhigh|max`).
// Ce ticket génère un jeu d'agent-defs maigres, un par palier, et câble
// `/sdd-run-ticket` dessus via `subagent_type: sdd-impl-<palier>`.
//
// Ce test couvre les fonctions PURES exportées par le générateur
// (`tools/agent-defs/generate.mjs`) : `buildAgentDefs`, `mapEffortToTier` (le
// shim ancien→officiel) et `tierToSubagentType`. La cohérence disque↔générateur
// est testée à part (`agent-defs-coherence.test.js`).
//
// Doit rougir AVANT que `tools/agent-defs/generate.mjs` existe — étape 2 du SDD.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect } from 'vitest';
import {
  TIERS,
  EFFORT_TO_TIER,
  SHARED,
  SENTINEL,
  SUBAGENT_PREFIX,
  AGENTS_DIR,
  REVIEWER,
  REVIEWER_SHARED,
  buildAgentDefs,
  buildReviewerDef,
  mapEffortToTier,
  tierToSubagentType,
  writeAgentDefs,
  writeReviewerDef,
} from '../tools/agent-defs/generate.mjs';

describe('SKILL-22 — paliers officiels', () => {
  it('TIERS = les 5 paliers officiels, dans l’ordre', () => {
    expect(TIERS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('SKILL-22 — shim mapEffortToTier (ancien vocab → palier officiel)', () => {
  // Mutation-témoin : changer une des flèches du shim (ex. think-hard→max) →
  // l'assertion correspondante rougit.
  it('none → low', () => expect(mapEffortToTier('none')).toBe('low'));
  it('think → medium', () => expect(mapEffortToTier('think')).toBe('medium'));
  it('think-hard → high', () => expect(mapEffortToTier('think-hard')).toBe('high'));
  it('ultrathink → max', () => expect(mapEffortToTier('ultrathink')).toBe('max'));

  it('EFFORT_TO_TIER couvre exactement l’ancien vocab EXEC_EFFORTS', () => {
    expect(Object.keys(EFFORT_TO_TIER).sort()).toEqual(
      ['none', 'think', 'think-hard', 'ultrathink'].sort()
    );
  });

  it('xhigh n’est PAS atteignable via l’ancien vocab (normal, cf. spec point 4)', () => {
    expect(Object.values(EFFORT_TO_TIER)).not.toContain('xhigh');
  });

  // Mutation-témoin : remplacer le throw par un fallback silencieux (ex.
  // `return 'medium'`) → ces assertions rougissent.
  it('valeur inconnue → erreur explicite, pas de fallback silencieux', () => {
    expect(() => mapEffortToTier('turbo')).toThrow(/inconnu/i);
    expect(() => mapEffortToTier('high')).toThrow(/inconnu/i); // 'high' est un palier, PAS un effort
    expect(() => mapEffortToTier(undefined)).toThrow();
    expect(() => mapEffortToTier('')).toThrow();
  });
});

describe('SKILL-22 — tierToSubagentType (palier → subagent_type)', () => {
  it('high → sdd-impl-high', () => expect(tierToSubagentType('high')).toBe('sdd-impl-high'));

  for (const tier of TIERS) {
    it(`${tier} → ${SUBAGENT_PREFIX}${tier}`, () => {
      expect(tierToSubagentType(tier)).toBe(`${SUBAGENT_PREFIX}${tier}`);
    });
  }

  // Mutation-témoin : accepter un palier hors liste → rougit.
  it('palier inconnu → erreur (y compris l’ancien vocab d’effort)', () => {
    expect(() => tierToSubagentType('think-hard')).toThrow(/inconnu/i);
    expect(() => tierToSubagentType('ultra')).toThrow(/inconnu/i);
    expect(() => tierToSubagentType(undefined)).toThrow();
  });

  it('composition effort → palier → subagent_type', () => {
    expect(tierToSubagentType(mapEffortToTier('think-hard'))).toBe('sdd-impl-high');
    expect(tierToSubagentType(mapEffortToTier('ultrathink'))).toBe('sdd-impl-max');
  });
});

describe('SKILL-22 — buildAgentDefs(tiers, shared)', () => {
  it('émet exactement un fichier par palier de la liste, dans l’ordre', () => {
    const defs = buildAgentDefs();
    expect(defs).toHaveLength(TIERS.length);
    expect(defs.map((d) => d.tier)).toEqual(TIERS);
    expect(defs.map((d) => d.filename)).toEqual(TIERS.map((t) => `${SUBAGENT_PREFIX}${t}.md`));
  });

  it('chaque contenu porte name, effort:<palier>, le tools: partagé et le sentinel', () => {
    for (const def of buildAgentDefs()) {
      expect(def.content).toContain(`name: ${SUBAGENT_PREFIX}${def.tier}`);
      expect(def.content).toContain(`effort: ${def.tier}`);
      expect(def.content).toContain(`tools: ${SHARED.tools}`);
      expect(def.content).toContain(SENTINEL);
    }
  });

  it('le frontmatter n’expose QUE le palier attendu (pas de fuite d’un autre effort)', () => {
    for (const def of buildAgentDefs()) {
      const others = TIERS.filter((t) => t !== def.tier);
      for (const other of others) {
        expect(def.content).not.toContain(`effort: ${other}`);
      }
    }
  });

  it('aucune duplication du prompt SDD (agent-defs maigres)', () => {
    // La discipline SDD reste INLINE dans /sdd-run-ticket (le prompt passé par
    // appel). Les agent-defs ne doivent pas la recopier — repère : le titre de
    // section propre au template implémenteur.
    for (const def of buildAgentDefs()) {
      expect(def.content).not.toContain('## Discipline SDD');
    }
  });

  it('idempotent : deux appels produisent une sortie byte-identique', () => {
    expect(JSON.stringify(buildAgentDefs())).toBe(JSON.stringify(buildAgentDefs()));
  });

  it('respecte des paramètres tiers/shared explicites (fonction pure de ses entrées)', () => {
    const defs = buildAgentDefs(['high'], { tools: 'Read, Bash', body: 'X' });
    expect(defs).toHaveLength(1);
    expect(defs[0].content).toContain('tools: Read, Bash');
    expect(defs[0].content).toContain('effort: high');
  });
});

describe('SKILL-22 — writeAgentDefs (effet de bord + résolution du dossier cible)', () => {
  // Le test de cohérence (agent-defs-coherence) ne couvre PAS ce mécanisme : il
  // relit des fichiers déjà committés sous agents/ contre buildAgentDefs (pure),
  // sans jamais appeler writeAgentDefs ni exercer la résolution de AGENTS_DIR.
  // Un futur edit qui retire un `'..'` du calcul écrirait dans tools/agents/ et
  // laisserait la suite verte — c'est exactement ce trou que ce describe ferme.

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = path.join(__dirname, '..');

  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  // Mutation-témoin : retirer un `'..'` de `AGENTS_DIR` (bug de chemin) → cette
  // assertion rougit (le dossier résolu deviendrait <repo>/tools/agents).
  it('AGENTS_DIR (défaut) résout vers <racine-repo>/agents', () => {
    expect(path.resolve(AGENTS_DIR)).toBe(path.resolve(REPO_ROOT, 'agents'));
  });

  it('écrit un fichier par palier dans le dir fourni, contenu === buildAgentDefs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill22-'));
    tmpDirs.push(dir);
    const returned = writeAgentDefs(dir);
    const expected = buildAgentDefs();
    expect(returned.map((d) => d.filename)).toEqual(expected.map((d) => d.filename));
    for (const def of expected) {
      const onDisk = fs.readFileSync(path.join(dir, def.filename), 'utf8');
      expect(onDisk).toBe(def.content);
    }
    // Exactement les fichiers attendus, pas d'extra.
    expect(fs.readdirSync(dir).sort()).toEqual(expected.map((d) => d.filename).sort());
  });

  it('crée le dossier cible au besoin (mkdir -p sur un chemin inexistant)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skill22-'));
    tmpDirs.push(base);
    const nested = path.join(base, 'a', 'b', 'agents');
    expect(fs.existsSync(nested)).toBe(false);
    writeAgentDefs(nested);
    expect(fs.existsSync(path.join(nested, `${SUBAGENT_PREFIX}high.md`))).toBe(true);
  });

  it('honore des tiers explicites (n’écrit que les paliers demandés)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill22-'));
    tmpDirs.push(dir);
    writeAgentDefs(dir, ['low']);
    expect(fs.readdirSync(dir)).toEqual([`${SUBAGENT_PREFIX}low.md`]);
  });

  it('writeAgentDefs n’écrit PAS sdd-reviewer.md (le relecteur n’est pas un palier)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill22-'));
    tmpDirs.push(dir);
    writeAgentDefs(dir);
    expect(fs.readdirSync(dir)).not.toContain(`${REVIEWER.name}.md`);
  });
});

describe('SKILL-23 — buildReviewerDef (agent-def relecteur, model+effort figés)', () => {
  it('name, description, tools, model: opus, effort: high, le sentinel', () => {
    const def = buildReviewerDef();
    expect(def.name).toBe('sdd-reviewer');
    expect(def.filename).toBe('sdd-reviewer.md');
    expect(def.content).toContain('name: sdd-reviewer');
    expect(def.content).toContain('model: opus');
    expect(def.content).toContain('effort: high');
    expect(def.content).toContain(SENTINEL);
  });

  it('REVIEWER expose model: opus et effort: high (source de vérité figée)', () => {
    expect(REVIEWER.model).toBe('opus');
    expect(REVIEWER.effort).toBe('high');
    expect(REVIEWER.name).toBe('sdd-reviewer');
  });

  it('sans argument, utilise REVIEWER_SHARED (tools + body par défaut)', () => {
    expect(buildReviewerDef().content).toBe(buildReviewerDef(REVIEWER_SHARED).content);
  });

  it('aucune duplication du prompt SDD (agent-def maigre, même discipline que l’implémenteur)', () => {
    const def = buildReviewerDef();
    expect(def.content).not.toContain('## Discipline SDD');
    expect(def.content).not.toContain('Axes de relecture');
  });

  it('idempotent : deux appels produisent une sortie byte-identique', () => {
    expect(JSON.stringify(buildReviewerDef())).toBe(JSON.stringify(buildReviewerDef()));
  });

  it('respecte un `shared` explicite (fonction pure de ses entrées)', () => {
    const def = buildReviewerDef({ tools: 'Read, Bash', body: 'X' });
    expect(def.content).toContain('tools: Read, Bash');
    expect(def.content).toContain('model: opus');
    expect(def.content).toContain('effort: high');
  });

  it('n’expose pas de palier `effort:` de l’implémenteur (low/medium/xhigh/max)', () => {
    const def = buildReviewerDef();
    for (const tier of ['low', 'medium', 'xhigh', 'max']) {
      expect(def.content).not.toContain(`effort: ${tier}`);
    }
  });
});

describe('SKILL-23 — writeReviewerDef (effet de bord)', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('écrit exactement sdd-reviewer.md dans le dir fourni, contenu === buildReviewerDef', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill23-'));
    tmpDirs.push(dir);
    const returned = writeReviewerDef(dir);
    const expected = buildReviewerDef();
    expect(returned.filename).toBe(expected.filename);
    expect(fs.readdirSync(dir)).toEqual([expected.filename]);
    const onDisk = fs.readFileSync(path.join(dir, expected.filename), 'utf8');
    expect(onDisk).toBe(expected.content);
  });

  it('crée le dossier cible au besoin (mkdir -p sur un chemin inexistant)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skill23-'));
    tmpDirs.push(base);
    const nested = path.join(base, 'a', 'b', 'agents');
    expect(fs.existsSync(nested)).toBe(false);
    writeReviewerDef(nested);
    expect(fs.existsSync(path.join(nested, `${REVIEWER.name}.md`))).toBe(true);
  });
});
