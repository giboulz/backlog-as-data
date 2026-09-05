// SKILL-30 — dépouillement baseline des transcripts (tools/review-log/baseline.mjs).
//
// Tests sur des fixtures SYNTHÉTIQUES (`__tests__/fixtures/review-log/`) — jamais
// sur des transcripts réels, hors dépôt et non reproductibles (cf. specs/skill-30.md
// § Tests). Les fixtures et le code ont été confrontés à des transcripts réels de
// `~/.claude/projects` avant d'être figés (reprise après relecture, findings 1-9) :
// c'est cette confrontation qui a révélé la vraie forme du schéma (`Agent` pas
// `Task`, `subagent_tokens` textuel pas une clé JSON, enregistrements de harnais
// hors conversation…), jamais commitée nulle part.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  EXPECTED_PROMPT_SECTIONS,
  parseSession,
  extractSpawns,
  extractRegistry,
  summarize,
  collectRegistries,
  buildSessionRecord,
  runBaseline,
  main,
} from '../tools/review-log/baseline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'review-log');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

describe('SKILL-30 — parseSession', () => {
  it('lignes JSON valides -> un message par ligne', () => {
    const messages = parseSession(readFixture('valid-session.jsonl'));
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('user');
    expect(messages[1].message.usage.output_tokens).toBe(50);
  });

  it('une ligne corrompue est ignorée sans faire échouer la session', () => {
    const messages = parseSession(readFixture('corrupted-session.jsonl'));
    // 3 lignes dans le fichier, 1 corrompue -> 2 messages exploitables.
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('user');
    expect(messages[1].type).toBe('assistant');
  });

  it('fichier vide -> session vide, pas d’exception', () => {
    expect(() => parseSession(readFixture('empty-session.jsonl'))).not.toThrow();
    expect(parseSession(readFixture('empty-session.jsonl'))).toEqual([]);
  });

  it('entrée non-string (undefined/null) -> session vide, pas d’exception', () => {
    expect(parseSession(undefined)).toEqual([]);
    expect(parseSession(null)).toEqual([]);
  });
});

describe('SKILL-30 — extractSpawns', () => {
  it('détecte les lancements et rend leur rang dans la session', () => {
    const messages = parseSession(readFixture('two-spawns-session.jsonl'));
    const spawns = extractSpawns(messages);
    expect(spawns).toHaveLength(2);
    expect(spawns[0].spawnIndex).toBe(0);
    expect(spawns[1].spawnIndex).toBe(1);
    expect(spawns[0].ticketId).toBe('SKILL-01');
    expect(spawns[1].ticketId).toBe('SKILL-02');
  });

  it('rend la taille en caractères du prompt (mesurée, pas devinée)', () => {
    const messages = parseSession(readFixture('two-spawns-session.jsonl'));
    const spawns = extractSpawns(messages);
    const rawPrompts = messages[1].message.content[0].input.prompt;
    const rawPrompt2 = messages[2].message.content[0].input.prompt;
    expect(spawns[0].promptLength).toBe(rawPrompts.length);
    expect(spawns[1].promptLength).toBe(rawPrompt2.length);
  });

  it('une section manquante est rapportée absente, jamais déduite ou complétée', () => {
    const messages = parseSession(readFixture('two-spawns-session.jsonl'));
    const spawns = extractSpawns(messages);
    // Le premier prompt porte TOUTES les sections attendues.
    for (const section of EXPECTED_PROMPT_SECTIONS) {
      expect(spawns[0].sections[section]).toBe(true);
    }
    // Le second prompt n'en porte que trois : les autres doivent être `false`,
    // jamais omises ni déduites d'une présumée section voisine.
    expect(spawns[1].sections['## Étape 0']).toBe(true);
    expect(spawns[1].sections['## Discipline SDD']).toBe(true);
    expect(spawns[1].sections['## Rapport final attendu']).toBe(true);
    expect(spawns[1].sections['## Étape 0.1']).toBe(false);
    expect(spawns[1].sections['## Étape 0.5']).toBe(false);
    expect(spawns[1].sections['## Outils de fichiers']).toBe(false);
    expect(spawns[1].sections['## Si tu es repris avec des findings']).toBe(false);
    expect(spawns[1].sections['## Garde-fous génériques']).toBe(false);
    expect(spawns[1].sections['## Si tu te trouves bloqué']).toBe(false);
    // Chaque prompt porte EXACTEMENT l'ensemble des clés attendues.
    expect(Object.keys(spawns[1].sections).sort()).toEqual([...EXPECTED_PROMPT_SECTIONS].sort());
  });

  it('aucun lancement -> tableau vide', () => {
    expect(extractSpawns(parseSession(readFixture('valid-session.jsonl')))).toEqual([]);
  });

  // Finding 3 : relecteurs (sdd-reviewer) et sous-agents ordinaires
  // (general-purpose) ne sont PAS des lancements de ticket, même si leur
  // prompt cite « le ticket <ID> » (cas du relecteur).
  it('ignore les relecteurs et les sous-agents ordinaires — seul l’implémenteur (sdd-impl-*) est un lancement', () => {
    const messages = parseSession(readFixture('mixed-agents-session.jsonl'));
    const spawns = extractSpawns(messages);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].spawnIndex).toBe(0); // rang PARMI les lancements retenus, pas parmi tous les appels Agent
    expect(spawns[0].ticketId).toBe('SKILL-07');
  });

  // Finding 9 : `## Étape 0` ne doit pas matcher en préfixe de `## Étape 0.1`
  // ou `## Étape 0.5`.
  it('n’infère pas une section depuis le préfixe d’une autre (## Étape 0 vs ## Étape 0.5)', () => {
    const messages = parseSession(readFixture('section-prefix-session.jsonl'));
    const spawns = extractSpawns(messages);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].sections['## Étape 0.5']).toBe(true);
    expect(spawns[0].sections['## Étape 0']).toBe(false);
    expect(spawns[0].sections['## Étape 0.1']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-112 — extractSpawns : isCorrection et numérotation', () => {
  // ⛔ D3 : le suffixe attendu est DÉCLARÉ ICI, jamais importé de
  // `baseline.mjs` — un test qui lirait la constante qu'il contrôle se
  // validerait contre lui-même, et un nettoyage des deux côtés resterait vert.
  // Le contrôle croisé constante ↔ skill vit dans
  // `review-log-wiring-coherence.test.js` (cas 11 et 12 de specs/skill-112.md).
  const SUFFIXE_CORRECTION = '(correction)';

  function spawnBlock(description, prompt) {
    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Agent',
            input: { subagent_type: 'sdd-impl-high', description, prompt },
          },
        ],
      },
    };
  }

  // ⚠️ Mutation : dériver `isCorrection` du PROMPT (ou le câbler en dur à
  // `false`) → rougit. Le suffixe est invisible pour l'attribution du ticket
  // (`TICKET_ID_FROM_DESCRIPTION_RE` s'arrête au premier blanc) et visible
  // pour qui le cherche : c'est tout le dispositif de SKILL-112.
  it('une description suffixée rend le MÊME ticket, et isCorrection: true', () => {
    const spawns = extractSpawns([
      spawnBlock(`SDD SKILL-112 ${SUFFIXE_CORRECTION}`, 'Tu reprends un ticket déjà implémenté.'),
    ]);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].ticketId).toBe('SKILL-112');
    expect(spawns[0].isCorrection).toBe(true);
  });

  // Mutation-témoin de l'assertion ci-dessus : la MÊME entrée, privée du seul
  // suffixe, doit basculer. Sans elle, un `isCorrection: true` câblé en dur
  // passerait le test précédent.
  it('mutation-témoin : la même description SANS le suffixe rend isCorrection faux', () => {
    const spawns = extractSpawns([
      spawnBlock('SDD SKILL-112', 'Tu reprends un ticket déjà implémenté.'),
    ]);
    expect(spawns[0].ticketId).toBe('SKILL-112');
    expect(spawns[0].isCorrection).toBe(false);
  });

  // ⚠️ Mutation : omettre le champ quand la description est nue → rougit.
  it('une description `SDD <ID>` nue rend isCorrection: false', () => {
    const spawns = extractSpawns(parseSession(readFixture('two-spawns-session.jsonl')));
    expect(spawns.map((s) => s.isCorrection)).toEqual([false, false]);
  });

  // ⚠️ Mutation : rendre `null`/`undefined` quand la description ne matche pas
  // (ticket tiré du PROMPT par `TICKET_ID_FROM_PROMPT_RE`) → rougit. Le champ
  // est un BOOLÉEN dans les trois régimes d'attribution, jamais absent : un
  // consommateur qui teste `!s.isCorrection` ne doit pas dépendre du régime.
  it('description non reconnue (ticket tiré du prompt) -> isCorrection: false, jamais null ni undefined', () => {
    const spawns = extractSpawns([
      spawnBlock('', 'Tu vas implémenter le ticket SKILL-77 de bout en bout.'),
    ]);
    expect(spawns[0].ticketId).toBe('SKILL-77');
    expect(spawns[0].isCorrection).toBe(false);
    expect(spawns[0].isCorrection).not.toBeNull();
    expect(spawns[0].isCorrection).not.toBeUndefined();
    expect(typeof spawns[0].isCorrection).toBe('boolean');
  });

  // ⚠️ Mutation : incrémenter le rang sur un lancement de correction → rougit
  // (SKILL-A2 passerait à 2). C'est la comparabilité avec l'avant-SKILL-111 :
  // `spawnIndex` est le rang parmi les seuls lancements d'IMPLÉMENTATION, et
  // la doctrine de frontière de session de `commands/sdd-run-ticket.md` repose
  // sur ce rang.
  it('un correcteur ne consomme pas de rang : deux implémentations séparées par lui restent 0 et 1', () => {
    const spawns = extractSpawns(parseSession(readFixture('correction-numbering-session.jsonl')));
    expect(spawns).toHaveLength(3);
    expect(spawns.map((s) => s.ticketId)).toEqual(['SKILL-A1', 'SKILL-A1', 'SKILL-A2']);
    expect(spawns.map((s) => s.isCorrection)).toEqual([false, true, false]);
    const rangs = spawns.filter((s) => !s.isCorrection).map((s) => s.spawnIndex);
    expect(rangs).toEqual([0, 1]);
    // Le correcteur n'est PAS numéroté : son rang n'existe pas, il ne se
    // fabrique pas. ⚠️ Mutation : lui donner le rang de son voisin → deux
    // entrées porteraient le même `spawnIndex` sans être le même lancement.
    expect(spawns[1].spawnIndex).toBeNull();
  });
});

describe('SKILL-30 — extractRegistry', () => {
  it('registre bien formé -> { r, u }', () => {
    const text =
      'Revue : 2 relecteur(s) · 3 remontées · 1 findings uniques après fusion\nContrôle : 1 uniques = 1 disposés ✓';
    expect(extractRegistry(text)).toEqual({ r: 3, u: 1 });
  });

  it('registre absent -> null + motif (jamais 0)', () => {
    const result = extractRegistry('Rien à voir ici, juste un message normal.');
    expect(result.r).toBeNull();
    expect(result.u).toBeNull();
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('registre présent mais compteurs illisibles -> null + motif (jamais 0)', () => {
    // Placeholders non substitués (`R remontées`, `U findings uniques`) : le
    // texte MENTIONNE bien un registre, mais les nombres sont illisibles.
    const text = 'Revue : 2 relecteur(s) · R remontées · U findings uniques après fusion';
    const result = extractRegistry(text);
    expect(result.r).toBeNull();
    expect(result.u).toBeNull();
    expect(result.r).not.toBe(0);
    expect(result.u).not.toBe(0);
    expect(typeof result.reason).toBe('string');
  });

  it('entrée non-string -> registre absent, pas d’exception', () => {
    expect(() => extractRegistry(undefined)).not.toThrow();
    expect(extractRegistry(undefined)).toEqual({ r: null, u: null, reason: 'registre absent' });
  });
});

describe('SKILL-30 — collectRegistries', () => {
  it('une session sans registre rend un tableau vide, jamais une erreur', () => {
    const messages = parseSession(readFixture('valid-session.jsonl'));
    expect(collectRegistries(messages)).toEqual([]);
  });

  // Findings 4 & 5 : le gabarit non substitué du skill, cité dans un
  // `tool_result` (ex. lecture de commands/sdd-run-ticket.md), ne doit PAS
  // être lu comme un registre. Seul le texte publié par l'orchestrateur
  // lui-même (message `assistant`) compte.
  it('ne retient que le registre PUBLIÉ par l’orchestrateur, pas un gabarit cité dans un tool_result', () => {
    const messages = parseSession(readFixture('registry-real-vs-quoted-session.jsonl'));
    const registries = collectRegistries(messages);
    expect(registries).toEqual([{ r: 3, u: 1 }]);
  });
});

describe('SKILL-30 — summarize', () => {
  it('somme les quatre champs de tokens sur toutes les sessions fournies', () => {
    const messages = parseSession(readFixture('valid-session.jsonl'));
    const [summary] = summarize([{ project: 'proj-a', sessionId: 'sess-1', messages }]);
    expect(summary.tokens).toEqual({
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheCreate: 5,
      subagentReportedTokens: 0,
    });
    expect(summary.noUsage).toBe(false);
  });

  it('une session sans aucun bloc usage rend des zéros ET noUsage: true', () => {
    const messages = parseSession(readFixture('corrupted-session.jsonl'));
    const [summary] = summarize([{ project: 'proj-a', sessionId: 'sess-2', messages }]);
    expect(summary.tokens.input).toBe(0);
    expect(summary.tokens.output).toBe(0);
    expect(summary.tokens.cacheRead).toBe(0);
    expect(summary.tokens.cacheCreate).toBe(0);
    expect(summary.noUsage).toBe(true);
  });

  it('traite plusieurs sessions indépendamment, une entrée par session', () => {
    const m1 = parseSession(readFixture('valid-session.jsonl'));
    const m2 = parseSession(readFixture('corrupted-session.jsonl'));
    const summaries = summarize([
      { project: 'proj-a', sessionId: 'sess-1', messages: m1 },
      { project: 'proj-b', sessionId: 'sess-2', messages: m2 },
    ]);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].project).toBe('proj-a');
    expect(summaries[1].project).toBe('proj-b');
  });

  // Finding 1 : un même tour d'assistant est réécrit sur plusieurs lignes du
  // transcript (une par bloc de contenu), répétant le MÊME `usage`. Sans
  // déduplication par `message.id`, la somme est gonflée.
  it('déduplique les usage répétés du même tour (même message.id), ne les compte qu’une fois', () => {
    const messages = parseSession(readFixture('usage-duplication-session.jsonl'));
    const [summary] = summarize([{ project: 'proj-a', sessionId: 'dup', messages }]);
    // Tour 1 (msg_dup_1, répété 3x) + tour 2 (msg_dup_2), chacun compté UNE fois.
    expect(summary.tokens).toEqual({
      input: 2 + 5,
      output: 411 + 10,
      cacheRead: 33747 + 1,
      cacheCreate: 22952 + 2,
      subagentReportedTokens: 0,
    });
  });

  // Finding 2 : `subagent_tokens` est du TEXTE dans les transcripts réels
  // (task-notification en `content` racine, et texte de `tool_result`),
  // jamais une clé JSON numérique.
  it('somme les subagent_tokens textuels, où qu’ils soient imbriqués dans l’enregistrement', () => {
    const messages = parseSession(readFixture('subagent-tokens-text-session.jsonl'));
    const [summary] = summarize([{ project: 'proj-a', sessionId: 'sub', messages }]);
    expect(summary.tokens.subagentReportedTokens).toBe(1000 + 500);
  });

  // Finding 7 : les enregistrements de harnais (queue-operation, attachment,
  // last-prompt, custom-title…) ne sont pas des « messages ».
  it('messageCount ne compte que les vrais tours de conversation (user/assistant), pas le bruit de harnais', () => {
    const messages = parseSession(readFixture('harness-noise-session.jsonl'));
    expect(messages).toHaveLength(6); // toutes les lignes sont du JSON valide
    const [summary] = summarize([{ project: 'proj-a', sessionId: 'noise', messages }]);
    expect(summary.messageCount).toBe(2); // seulement le tour user + le tour assistant
  });
});

describe('SKILL-30 — bout en bout', () => {
  it('une fixture à trois messages -> JSON attendu, comparé en entier', () => {
    const raw = readFixture('e2e-session.jsonl');
    const record = buildSessionRecord('test-project', 'e2e-session', raw);

    const promptText =
      'Tu vas implémenter le ticket SKILL-30 de bout en bout.\n\n' +
      '## Étape 0 — Verrouille ton worktree\n\n' +
      '## Étape 0.1 — Synchronise\n\n' +
      '## Outils de fichiers\n\n' +
      '## Discipline SDD (non négociable)\n\n' +
      '## Si tu es repris avec des findings\n\n' +
      '## Rapport final attendu';

    expect(record).toEqual({
      project: 'test-project',
      sessionId: 'e2e-session',
      timestampMin: '2026-07-19T09:00:00.000Z',
      timestampMax: '2026-07-19T09:00:10.000Z',
      messageCount: 3, // 3 vrais tours (user, assistant, et le tool_result — type "user" aussi)
      tokens: {
        input: 200,
        output: 120,
        cacheRead: 20,
        cacheCreate: 15,
        subagentReportedTokens: 777,
      },
      noUsage: false,
      subagentCallCount: 1,
      spawns: [
        {
          spawnIndex: 0,
          promptLength: promptText.length,
          ticketId: 'SKILL-30',
          // SKILL-112 : champ AJOUTÉ à chaque entrée de spawn. Ce `toEqual`
          // exhaustif a rougi à son arrivée — attendu, pas une régression :
          // c'est précisément ce qu'une comparaison EN ENTIER est là pour
          // voir.
          isCorrection: false,
          sections: {
            '## Étape 0': true,
            '## Étape 0.1': true,
            '## Étape 0.5': false,
            '## Outils de fichiers': true,
            '## Discipline SDD': true,
            '## Si tu es repris avec des findings': true,
            '## Garde-fous génériques': false,
            '## Rapport final attendu': true,
            '## Si tu te trouves bloqué': false,
          },
        },
      ],
      registries: [],
    });
  });
});

describe('SKILL-30 — runBaseline / main (CLI, robustesse du lot)', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function makeTmpRoot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill30-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('root introuvable -> { error }, pas d’exception', () => {
    const result = runBaseline(path.join(os.tmpdir(), 'skill30-inexistant-xyz'));
    expect(typeof result.error).toBe('string');
    expect(result.sessions).toBeUndefined();
  });

  it('cas nominal : un projet, une session -> un enregistrement', () => {
    const root = makeTmpRoot();
    const projectDir = path.join(root, 'mon-projet');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'sess-1.jsonl'), readFixture('valid-session.jsonl'));

    const result = runBaseline(root);
    expect(result.error).toBeUndefined();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].project).toBe('mon-projet');
    expect(result.sessions[0].sessionId).toBe('sess-1');
  });

  // Finding 8 : « une session illisible n'interrompt pas le lot » — un fichier
  // de session illisible (ici : un DOSSIER portant l'extension .jsonl, donc
  // pas lisible comme fichier) est sauté, le reste du lot continue.
  it('un fichier de session illisible est sauté sans interrompre le lot', () => {
    const root = makeTmpRoot();
    const projectDir = path.join(root, 'mon-projet');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'bonne-session.jsonl'), readFixture('valid-session.jsonl'));
    // Un dossier nommé comme un .jsonl : fs.readFileSync doit échouer dessus.
    fs.mkdirSync(path.join(projectDir, 'session-illisible.jsonl'));

    const result = runBaseline(root);
    expect(result.error).toBeUndefined();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sessionId).toBe('bonne-session');
  });

  // Finding 8 : un dossier de PROJET illisible (échec de fs.readdirSync sur
  // ce sous-dossier précis) est sauté sans interrompre le lot ni faire
  // planter les autres projets.
  it('un dossier de projet illisible est sauté sans interrompre le lot', () => {
    const root = makeTmpRoot();
    const goodProject = path.join(root, 'projet-lisible');
    const badProject = path.join(root, 'projet-illisible');
    fs.mkdirSync(goodProject);
    fs.mkdirSync(badProject);
    fs.writeFileSync(path.join(goodProject, 'sess-1.jsonl'), readFixture('valid-session.jsonl'));
    fs.writeFileSync(path.join(badProject, 'sess-2.jsonl'), readFixture('valid-session.jsonl'));

    const realReaddirSync = fs.readdirSync.bind(fs);
    vi.spyOn(fs, 'readdirSync').mockImplementation((p, opts) => {
      if (path.resolve(String(p)) === path.resolve(badProject)) {
        throw new Error('EACCES simulé (permission refusée)');
      }
      return realReaddirSync(p, opts);
    });

    const result = runBaseline(root);
    expect(result.error).toBeUndefined();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].project).toBe('projet-lisible');
  });

  it('main(argv) écrit le JSON de runBaseline sur stdout', () => {
    const root = makeTmpRoot();
    const projectDir = path.join(root, 'mon-projet');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, 'sess-1.jsonl'), readFixture('valid-session.jsonl'));

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    main([root]);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeSpy.mock.calls[0][0]);
    expect(written.sessions).toHaveLength(1);
    expect(written.sessions[0].project).toBe('mon-projet');
    // ⚠️ Mutation (SKILL-69) : laisser `summarize` publier la clé sous son nom
    // d'AVANT ce ticket → rougit. Le bout-en-bout `main`/`runBaseline` sort le
    // NOUVEAU nom, pas seulement `summarize` appelée directement. Le nom
    // d'avant est reconstruit en deux morceaux pour ne pas apparaître, en
    // clair, dans ce fichier (Vérification nº 3 de specs/skill-69.md).
    const PRE_SKILL69_KEY = 'subagent' + 'Tokens';
    expect(written.sessions[0].tokens).toHaveProperty('subagentReportedTokens');
    expect(written.sessions[0].tokens.subagentReportedTokens).toBe(0);
    expect(written.sessions[0].tokens).not.toHaveProperty(PRE_SKILL69_KEY);
  });

  it('main(argv) sur une racine introuvable écrit sur stderr et pose exitCode=1, sans throw', () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const originalExitCode = process.exitCode;
    expect(() => main([path.join(os.tmpdir(), 'skill30-inexistant-xyz')])).not.toThrow();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });
});
