// SKILL-55 — producteur du contrat de poussée des mesures SDD
// (`tools/sdd-push/push.mjs`, specs/skill-55.md).
//
// Toutes les entrées/sorties sont INJECTÉES (`deps`) : aucun test ne lit le vrai
// `~/sdd-metrics`, aucun n'émet de requête réseau réelle.
//
// ⚠️ Convention D3 : chaque assertion porte en commentaire la MUTATION qui doit
// la faire rougir.

import { describe, it, expect, vi } from 'vitest';
import {
  MAX_BATCH_SIZE,
  DEFAULT_TIMEOUT_MS,
  resolveConfig,
  collectCycles,
  groupBySchema,
  chunk,
  buildPayload,
  postBatch,
  main,
} from '../tools/sdd-push/push.mjs';

// ---------------------------------------------------------------------------
describe('SKILL-55 — resolveConfig', () => {
  // ⚠️ Mutation : rendre `{}` au lieu de `null` quand tout est absent → rougit.
  it('les deux variables présentes -> { url, token }', () => {
    const res = resolveConfig({ SDD_PUSH_URL: 'https://x.example/ingest', SDD_PUSH_TOKEN: 'secret' });
    expect(res).toEqual({ url: 'https://x.example/ingest', token: 'secret' });
  });

  // ⚠️ Mutation : rendre un objet à champ vide (ex. `{ url: undefined, token }`)
  // au lieu de `null` → rougit.
  it('SDD_PUSH_URL absente -> null (pas un objet à champ vide)', () => {
    const res = resolveConfig({ SDD_PUSH_TOKEN: 'secret' });
    expect(res).toBeNull();
  });

  it('SDD_PUSH_TOKEN absente -> null', () => {
    const res = resolveConfig({ SDD_PUSH_URL: 'https://x.example/ingest' });
    expect(res).toBeNull();
  });

  it('les deux absentes -> null', () => {
    expect(resolveConfig({})).toBeNull();
  });

  // ⚠️ Mutation : ne pas trimmer / ne pas tester la longueur après trim →
  // rougit. Une valeur d'espaces seuls doit être traitée comme absente.
  it('valeur présente mais vide ou uniquement des espaces -> traitée comme absente', () => {
    expect(resolveConfig({ SDD_PUSH_URL: '', SDD_PUSH_TOKEN: 'x' })).toBeNull();
    expect(resolveConfig({ SDD_PUSH_URL: '   ', SDD_PUSH_TOKEN: 'x' })).toBeNull();
    expect(resolveConfig({ SDD_PUSH_URL: 'https://x', SDD_PUSH_TOKEN: '   ' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-60 — surface exportée (CYCLE_ID_RE retirée)', () => {
  // ⚠️ Mutation : réexporter `CYCLE_ID_RE` depuis push.mjs → rougit. C'est
  // l'accusé que la grammaire n'existe plus, pas seulement qu'elle n'est plus
  // utilisée.
  it('CYCLE_ID_RE n’est plus exportée', async () => {
    const mod = await import('../tools/sdd-push/push.mjs');
    expect(mod.CYCLE_ID_RE).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-55 — collectCycles', () => {
  function fakeFs(tree) {
    // `tree` : { 'dirpath': { name: 'dir'|'file' } } — clés normalisées '/'
    return {
      readdirSync(dir) {
        const key = String(dir).replace(/\\/g, '/');
        const entries = tree[key];
        if (!entries) {
          const err = new Error(`ENOENT: ${key}`);
          err.code = 'ENOENT';
          throw err;
        }
        return Object.entries(entries).map(([name, kind]) => ({
          name,
          isDirectory: () => kind === 'dir',
          isFile: () => kind === 'file',
        }));
      },
      readFileSync(file) {
        const key = String(file).replace(/\\/g, '/');
        const content = tree.__files__?.[key];
        if (content === undefined) throw new Error(`ENOENT: ${key}`);
        return content;
      },
    };
  }

  const ROOT = 'C:/Users/gibou/sdd-metrics';
  const ID_A = '2026-08-01-SKILL-26-aaaaaaaa-s00';
  const ID_B = '2026-07-01-SKILL-31-bbbbbbbb-s00';
  const ID_GOOD = '2026-08-01-SKILL-26-cccccccc-s00';

  // ⚠️ Mutation : ne parcourir qu'un seul niveau de sous-dossiers → rougit
  // (deux mois de sous-dossiers ne seraient pas tous ramassés).
  it('deux mois de sous-dossiers -> tous les fichiers ramassés, id = nom sans .json', () => {
    const rec1 = { schema: 1, ticket: 'SKILL-26' };
    const rec2 = { schema: 1, ticket: 'SKILL-31' };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir', '2026-07': 'dir' },
      [`${ROOT}/cycles/2026-08`]: { [`${ID_A}.json`]: 'file' },
      [`${ROOT}/cycles/2026-07`]: { [`${ID_B}.json`]: 'file' },
      __files__: {
        [`${ROOT}/cycles/2026-08/${ID_A}.json`]: JSON.stringify(rec1),
        [`${ROOT}/cycles/2026-07/${ID_B}.json`]: JSON.stringify(rec2),
      },
    });
    const cycles = collectCycles(ROOT, { fs, stderr: () => {} });
    expect(cycles).toHaveLength(2);
    const ids = cycles.map((c) => c.id).sort();
    expect(ids).toEqual([ID_A, ID_B].sort());
  });

  // ⚠️ Mutation : réordonner ou reconstruire `record` au lieu de JSON.parse
  // direct → rougit. La comparaison est PROFONDE.
  it('record est strictement égal au contenu du fichier (ordre des clés préservé)', () => {
    const record = { schema: 1, ticket: 'SKILL-26', findings: [{ i: 1, reviewers: ['A'] }] };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir' },
      [`${ROOT}/cycles/2026-08`]: { [`${ID_A}.json`]: 'file' },
      __files__: { [`${ROOT}/cycles/2026-08/${ID_A}.json`]: JSON.stringify(record) },
    });
    const cycles = collectCycles(ROOT, { fs, stderr: () => {} });
    expect(cycles[0].record).toEqual(record);
    expect(Object.keys(cycles[0].record)).toEqual(Object.keys(record));
  });

  // ⚠️ Mutation : laisser remonter l'exception de JSON.parse → rougit.
  it('JSON illisible -> ignoré, motif sur stderr, les autres passent', () => {
    const good = { schema: 1, ticket: 'SKILL-26' };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir' },
      [`${ROOT}/cycles/2026-08`]: { 'bad.json': 'file', [`${ID_GOOD}.json`]: 'file' },
      __files__: {
        [`${ROOT}/cycles/2026-08/bad.json`]: '{ pas du json',
        [`${ROOT}/cycles/2026-08/${ID_GOOD}.json`]: JSON.stringify(good),
      },
    });
    const stderr = vi.fn();
    const cycles = collectCycles(ROOT, { fs, stderr });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].id).toBe(ID_GOOD);
    expect(stderr).toHaveBeenCalled();
    expect(stderr.mock.calls[0][0]).toMatch(/bad\.json/);
  });

  // ⚠️ Mutation : accepter un `schema` non numérique (chaîne, absent) → rougit.
  it('fichier sans schema numérique -> ignoré, motif sur stderr, les autres passent', () => {
    const good = { schema: 1, ticket: 'SKILL-26' };
    const noSchema = { ticket: 'SKILL-26' };
    const stringSchema = { schema: '1', ticket: 'SKILL-26' };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir' },
      [`${ROOT}/cycles/2026-08`]: {
        'no-schema.json': 'file',
        'string-schema.json': 'file',
        [`${ID_GOOD}.json`]: 'file',
      },
      __files__: {
        [`${ROOT}/cycles/2026-08/no-schema.json`]: JSON.stringify(noSchema),
        [`${ROOT}/cycles/2026-08/string-schema.json`]: JSON.stringify(stringSchema),
        [`${ROOT}/cycles/2026-08/${ID_GOOD}.json`]: JSON.stringify(good),
      },
    });
    const stderr = vi.fn();
    const cycles = collectCycles(ROOT, { fs, stderr });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].id).toBe(ID_GOOD);
    expect(stderr).toHaveBeenCalledTimes(2);
  });

  // ⚠️ Mutation : laisser remonter l'exception de readdirSync sur `cycles/`
  // absent → rougit. Et AUCUN motif : c'est le cas légitime, pas une erreur.
  it('cycles/ absent -> tableau vide, pas d’exception, AUCUN motif sur stderr', () => {
    const fs = fakeFs({});
    const stderr = vi.fn();
    expect(() => collectCycles(ROOT, { fs, stderr })).not.toThrow();
    expect(collectCycles(ROOT, { fs, stderr })).toEqual([]);
    expect(stderr).not.toHaveBeenCalled();
  });

  // ⚠️ Mutation : présumer `<root>` toujours présent au lieu de gérer l'erreur
  // → rougit.
  it('racine absente -> tableau vide, pas d’exception', () => {
    const fs = fakeFs({});
    expect(() => collectCycles('C:/nexiste/pas', { fs, stderr: () => {} })).not.toThrow();
  });

  // ⚠️ Mutation : traiter un fichier non-.json comme un cycle (ou signaler une
  // erreur dessus) → rougit — silencieux, aucun appel stderr.
  it('un fichier qui n’est pas .json -> ignoré sans motif', () => {
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir' },
      [`${ROOT}/cycles/2026-08`]: { 'README.md': 'file' },
      __files__: {},
    });
    const stderr = vi.fn();
    const cycles = collectCycles(ROOT, { fs, stderr });
    expect(cycles).toEqual([]);
    expect(stderr).not.toHaveBeenCalled();
  });

  // --- SKILL-60 : la grammaire est retirée, tout id passe --------------
  // ⚠️ Mutation : réintroduire un filtre de forme sur `id` → rougit. C'est le
  // test qui porte le ticket : le cas de collision seul suffirait à le
  // détecter, mais toute la liste verrouille chaque sortie réelle de
  // `recordPath` (`tools/review-log/write.mjs`).
  it.each([
    ['nominal', '2026-08-22-SKILL-26-97cfdd24-s00'],
    ['suffixe de collision (writeRecord, -2)', '2026-08-22-SKILL-26-97cfdd24-s00-2'],
    ['dernière tentative de la boucle wx (-1000)', '2026-08-22-SKILL-26-97cfdd24-s99-1000'],
    ['spawnIndex >= 100 (s100)', '2026-08-22-SKILL-26-97cfdd24-s100'],
    ['date et spawnIndex non mesurés', 'date-inconnue-SKILL-26-97cfdd24-sxx'],
    ['session absente', '2026-08-22-SKILL-26-nosession-s00'],
    ['ticket assaini (_ au lieu de -)', '2026-08-22-SKILL_26-97cfdd24-s00'],
  ])('forme réelle de recordPath — %s -> ramassé', (_label, id) => {
    const good = { schema: 1, ticket: 'SKILL-26' };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir' },
      [`${ROOT}/cycles/2026-08`]: { [`${id}.json`]: 'file' },
      __files__: { [`${ROOT}/cycles/2026-08/${id}.json`]: JSON.stringify(good) },
    });
    const cycles = collectCycles(ROOT, { fs, stderr: () => {} });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].id).toBe(id);
  });

  // ⚠️ Mutation : réintroduire un filtre sur la forme du nom → rougit. Un nom
  // arbitraire, avec un `schema` numérique, doit passer sans AUCUN motif : le
  // producteur ne juge pas les noms.
  it('nom arbitraire avec schema numérique -> ramassé, aucun motif sur stderr', () => {
    const good = { schema: 1, ticket: 'SKILL-26' };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir' },
      [`${ROOT}/cycles/2026-08`]: { 'notes.json': 'file', '2026-truc.json': 'file', 'a.json': 'file' },
      __files__: {
        [`${ROOT}/cycles/2026-08/notes.json`]: JSON.stringify(good),
        [`${ROOT}/cycles/2026-08/2026-truc.json`]: JSON.stringify(good),
        [`${ROOT}/cycles/2026-08/a.json`]: JSON.stringify(good),
      },
    });
    const stderr = vi.fn();
    const cycles = collectCycles(ROOT, { fs, stderr });
    expect(cycles).toHaveLength(3);
    expect(stderr).not.toHaveBeenCalled();
  });

  // --- gate de reprise SKILL-60 n° 3 --------------------------------------
  // ⚠️ Mutation : ne pas contrôler la vacuité de `id` → rougit. Un `id` vide
  // (ou blanc) passerait le contrôle du consommateur
  // (`app/api/sdd/ingest/route.ts` : `id.trim() === ''`), qui rejette alors
  // le LOT ENTIER en 400 — jusqu'à 500 cycles légitimes perdus. Ce n'est PAS
  // une validation de forme : `id` non vide est une exigence structurelle du
  // contrat (LE CONTRAT, § Corps), pas une grammaire empruntée à
  // `recordPath`.
  it.each([
    ['nom de fichier vide (.json seul)', ''],
    ['nom de fichier blanc (espaces seuls)', '   '],
  ])('id %s -> ignoré, motif sur stderr, les autres passent', (_label, basename) => {
    const good = { schema: 1, ticket: 'SKILL-26' };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir' },
      [`${ROOT}/cycles/2026-08`]: { [`${basename}.json`]: 'file', [`${ID_GOOD}.json`]: 'file' },
      __files__: {
        [`${ROOT}/cycles/2026-08/${basename}.json`]: JSON.stringify(good),
        [`${ROOT}/cycles/2026-08/${ID_GOOD}.json`]: JSON.stringify(good),
      },
    });
    const stderr = vi.fn();
    const cycles = collectCycles(ROOT, { fs, stderr });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].id).toBe(ID_GOOD);
    expect(stderr).toHaveBeenCalled();
    expect(stderr.mock.calls.some((c) => /vide/i.test(c[0]))).toBe(true);
  });

  // --- finding de gate SKILL-55 n° 4 --------------------------------------
  // ⚠️ Mutation : laisser le `catch` de `walk` avaler silencieusement une
  // erreur de sous-dossier (ou la traiter comme le cas racine légitime) →
  // rougit. Le mois en échec doit produire un motif ; les autres mois du
  // corpus doivent quand même être ramassés.
  it('sous-dossier illisible (EPERM/EBUSY) -> motif sur stderr, le reste du corpus continue', () => {
    const good = { schema: 1, ticket: 'SKILL-31' };
    const fs = {
      readdirSync(dir) {
        const key = String(dir).replace(/\\/g, '/');
        if (key === `${ROOT}/cycles`) {
          return [
            { name: '2026-08', isDirectory: () => true, isFile: () => false },
            { name: '2026-07', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (key === `${ROOT}/cycles/2026-08`) {
          const err = new Error('EPERM: verrouillé');
          err.code = 'EPERM';
          throw err;
        }
        if (key === `${ROOT}/cycles/2026-07`) {
          return [{ name: `${ID_B}.json`, isDirectory: () => false, isFile: () => true }];
        }
        const err = new Error(`ENOENT: ${key}`);
        err.code = 'ENOENT';
        throw err;
      },
      readFileSync(file) {
        const key = String(file).replace(/\\/g, '/');
        if (key === `${ROOT}/cycles/2026-07/${ID_B}.json`) return JSON.stringify(good);
        throw new Error(`ENOENT: ${key}`);
      },
    };
    const stderr = vi.fn();
    const cycles = collectCycles(ROOT, { fs, stderr });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].id).toBe(ID_B);
    expect(stderr).toHaveBeenCalled();
    expect(
      stderr.mock.calls.some((c) => /2026-08/.test(c[0]) && /illisible/.test(c[0]))
    ).toBe(true);
  });

  // --- finding de gate SKILL-55 n° 5 --------------------------------------
  // ⚠️ Mutation : ne pas dédoublonner par `id` → rougit. Deux fichiers de même
  // basename dans deux dossiers différents (copie, archive) partiraient
  // sinon avec le même `id` dans le même lot.
  it('id déjà vu dans un autre dossier, contenu IDENTIQUE -> doublon ignoré, motif sur stderr', () => {
    const record = { schema: 1, ticket: 'SKILL-26' };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir', archive: 'dir' },
      [`${ROOT}/cycles/2026-08`]: { [`${ID_A}.json`]: 'file' },
      [`${ROOT}/cycles/archive`]: { [`${ID_A}.json`]: 'file' },
      __files__: {
        [`${ROOT}/cycles/2026-08/${ID_A}.json`]: JSON.stringify(record),
        [`${ROOT}/cycles/archive/${ID_A}.json`]: JSON.stringify(record),
      },
    });
    const stderr = vi.fn();
    const cycles = collectCycles(ROOT, { fs, stderr });
    expect(cycles).toHaveLength(1);
    expect(stderr).toHaveBeenCalled();
    expect(stderr.mock.calls.some((c) => /doublon identique/.test(c[0]))).toBe(true);
  });

  // ⚠️ Mutation : dédoublonner sans distinguer un contenu différent (perdre la
  // promesse n° 1 du contrat en silence) → rougit.
  it('id déjà vu, contenu DIFFÉRENT -> doublon ignoré, motif EXPLICITE sur la divergence', () => {
    const first = { schema: 1, ticket: 'SKILL-26', note: 'premier' };
    const second = { schema: 1, ticket: 'SKILL-26', note: 'retouché' };
    const fs = fakeFs({
      [`${ROOT}/cycles`]: { '2026-08': 'dir', archive: 'dir' },
      [`${ROOT}/cycles/2026-08`]: { [`${ID_A}.json`]: 'file' },
      [`${ROOT}/cycles/archive`]: { [`${ID_A}.json`]: 'file' },
      __files__: {
        [`${ROOT}/cycles/2026-08/${ID_A}.json`]: JSON.stringify(first),
        [`${ROOT}/cycles/archive/${ID_A}.json`]: JSON.stringify(second),
      },
    });
    const stderr = vi.fn();
    const cycles = collectCycles(ROOT, { fs, stderr });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].record).toEqual(first); // la PREMIÈRE occurrence rencontrée
    expect(stderr.mock.calls.some((c) => /DOUBLON AVEC UN CONTENU DIFFÉRENT/.test(c[0]))).toBe(true);
  });

  // --- finding de gate SKILL-55 n° 6 --------------------------------------
  // ⚠️ Mutation : retirer le `try/catch` autour de `fsx.readFileSync` (ou
  // laisser l'exception remonter) → rougit. Course réaliste : un fichier
  // LISTÉ par `readdirSync` est verrouillé/déplacé avant le `readFileSync`
  // (write.mjs écrit dans `cycles/` pendant que push.mjs le balaie).
  it('fichier listé mais illisible à la lecture (course avec l’écrivain) -> ignoré, motif sur stderr, ne jette pas', () => {
    const fs = {
      readdirSync(dir) {
        const key = String(dir).replace(/\\/g, '/');
        if (key === `${ROOT}/cycles`) return [{ name: '2026-08', isDirectory: () => true, isFile: () => false }];
        if (key === `${ROOT}/cycles/2026-08`) {
          return [{ name: `${ID_A}.json`, isDirectory: () => false, isFile: () => true }];
        }
        const err = new Error(`ENOENT: ${key}`);
        err.code = 'ENOENT';
        throw err;
      },
      readFileSync() {
        const err = new Error('EBUSY: resource busy or locked');
        err.code = 'EBUSY';
        throw err;
      },
    };
    const stderr = vi.fn();
    let cycles;
    expect(() => {
      cycles = collectCycles(ROOT, { fs, stderr });
    }).not.toThrow();
    expect(cycles).toEqual([]);
    expect(stderr).toHaveBeenCalled();
    expect(stderr.mock.calls[0][0]).toMatch(/illisible/);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-55 — groupBySchema', () => {
  // ⚠️ Mutation : rendre plusieurs entrées pour un corpus mono-version →
  // rougit.
  it('corpus mono-version -> une seule entrée', () => {
    const cycles = [
      { id: 'a', record: { schema: 1 } },
      { id: 'b', record: { schema: 1 } },
    ];
    const groups = groupBySchema(cycles);
    expect(groups).toHaveLength(1);
    expect(groups[0].schema).toBe(1);
    expect(groups[0].cycles).toHaveLength(2);
  });

  // ⚠️ Mutation : mélanger les cycles de deux versions dans le même groupe →
  // rougit.
  it('corpus mêlant schema 1 et schema 2 -> deux entrées, chacune ses propres cycles', () => {
    const cycles = [
      { id: 'a', record: { schema: 1 } },
      { id: 'b', record: { schema: 2 } },
      { id: 'c', record: { schema: 1 } },
    ];
    const groups = groupBySchema(cycles);
    expect(groups).toHaveLength(2);
    const g1 = groups.find((g) => g.schema === 1);
    const g2 = groups.find((g) => g.schema === 2);
    expect(g1.cycles.map((c) => c.id)).toEqual(['a', 'c']);
    expect(g2.cycles.map((c) => c.id)).toEqual(['b']);
  });

  // ⚠️ Mutation : rendre `[{ schema: undefined, cycles: [] }]` sur un corpus
  // vide → rougit.
  it('corpus vide -> aucune entrée', () => {
    expect(groupBySchema([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-55 — chunk', () => {
  // ⚠️ Mutation : couper à `size - 1` ou `size + 1` → rougit.
  it('longueur exactement size -> un seul lot', () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    expect(chunk(items, 5)).toEqual([items]);
  });

  // ⚠️ Mutation : ne pas créer de second lot pour le reliquat → rougit.
  it('longueur size + 1 -> deux lots, le second à un élément', () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    const lots = chunk(items, 5);
    expect(lots).toHaveLength(2);
    expect(lots[0]).toHaveLength(5);
    expect(lots[1]).toEqual([5]);
  });

  // ⚠️ Mutation : rendre `[[]]` (un lot vide) pour une entrée vide → rougit.
  it('longueur 0 -> aucun lot', () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it('MAX_BATCH_SIZE vaut 500 (borne du contrat)', () => {
    expect(MAX_BATCH_SIZE).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-55 — buildPayload', () => {
  // ⚠️ Mutation : envelopper `cycles` dans une copie (`[...cycles]`) → rougit,
  // la référence doit être PRÉSERVÉE (fonction pure, aucune mutation ni copie).
  it('rend { schema, cycles }, cycles inchangé (même référence)', () => {
    const cycles = [{ id: 'a', record: { schema: 1 } }];
    const payload = buildPayload(1, cycles);
    expect(payload).toEqual({ schema: 1, cycles });
    expect(payload.cycles).toBe(cycles);
  });

  // ⚠️ Mutation : muter un `record` reçu (ex. y ajouter un champ) → rougit.
  it('ne mute pas les record reçus', () => {
    const record = { schema: 1, ticket: 'SKILL-26' };
    const cycles = [{ id: 'a', record }];
    buildPayload(1, cycles);
    expect(record).toEqual({ schema: 1, ticket: 'SKILL-26' });
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-55 — postBatch', () => {
  function fakeFetch(status, body) {
    return vi.fn(async () => ({
      status,
      json: async () => {
        if (body === undefined) throw new Error('corps illisible');
        return body;
      },
    }));
  }

  // ⚠️ Mutation : ne pas rendre `ingested`/`skipped` sur un 200 → rougit.
  it('200 avec { ingested, skipped } -> rend ces compteurs', async () => {
    const fetch = fakeFetch(200, { ingested: 20, skipped: 3 });
    const res = await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch });
    expect(res).toEqual({ ok: true, ingested: 20, skipped: 3 });
  });

  // ⚠️ Mutation : laisser remonter l'exception de `res.json()` → rougit (le
  // `postBatch` non muté ne rejette jamais : l'`await` ci-dessous suffit à le
  // constater, sans wrapper `.not.toThrow()` qui ne verrait pas un rejet).
  it('200 au corps illisible -> résultat marqué en erreur, ne jette pas', async () => {
    const fetch = fakeFetch(200, undefined);
    const res = await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  // ⚠️ Mutation : rendre `ok: true` sur un 400 → rougit.
  it('400 unknown schema -> résultat en erreur portant le motif du corps', async () => {
    const fetch = fakeFetch(400, { error: 'unknown schema', supported: [1] });
    const res = await postBatch('https://x/ingest', 'tok', { schema: 2, cycles: [] }, { fetch });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('unknown schema');
  });

  // ⚠️ Mutation : rendre `ok: true` sur un 401 → rougit.
  it('401 -> résultat en erreur portant le code', async () => {
    const fetch = fakeFetch(401, undefined);
    const res = await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
  });

  // ⚠️ Mutation : rendre `ok: true` sur un 5xx → rougit.
  it('5xx -> résultat en erreur', async () => {
    const fetch = fakeFetch(503, undefined);
    const res = await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('503');
  });

  // ⚠️ Mutation : laisser propager l'exception réseau → rougit. C'est
  // l'assertion la plus importante de cette fonction (promesse n° 4 du
  // contrat).
  it('le transport jette (réseau coupé, timeout) -> résultat en erreur, ne propage jamais', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('ECONNREFUSED');
  });

  // ⚠️ Mutation : oublier l'en-tête `Authorization`, ou omettre `Bearer` →
  // rougit.
  it('l’en-tête Authorization: Bearer <token> est bien posé', async () => {
    const fetch = fakeFetch(200, { ingested: 0, skipped: 0 });
    await postBatch('https://x/ingest', 'mon-token', { schema: 1, cycles: [] }, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://x/ingest');
    expect(init.headers.Authorization).toBe('Bearer mon-token');
  });

  // --- finding de gate SKILL-55 n° 2 --------------------------------------
  // ⚠️ Mutation : passer à `method: 'GET'` (ou l'omettre, undici défaultant à
  // GET) → rougit. Sans cette assertion, un refactor qui perd le verbe reste
  // vert partout — la requête part en GET, `body` ignoré, et chaque appel
  // traduit un `405`/`404` en une ligne stderr, sortie 0 : rien ne rougit
  // ailleurs dans le fichier.
  it('la méthode est POST', async () => {
    const fetch = fakeFetch(200, { ingested: 0, skipped: 0 });
    await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch });
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('POST');
  });

  // ⚠️ Mutation : omettre `Content-Type: application/json` (ou une autre
  // valeur) → rougit.
  it('le Content-Type est application/json', async () => {
    const fetch = fakeFetch(200, { ingested: 0, skipped: 0 });
    await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch });
    const [, init] = fetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  // --- finding de gate SKILL-55 n° 1 --------------------------------------
  // ⚠️ Mutation : retirer le `signal`/`AbortController` (ou le délai de
  // garde) → rougit — la requête resterait suspendue jusqu'aux défauts du
  // transport (plusieurs minutes), ce qu'aucun autre test de ce fichier ne
  // peut voir (ils injectent tous un `fetch` qui résout ou rejette
  // IMMÉDIATEMENT).
  it('un POST qui ne répond jamais est ABORTÉ après le délai configuré, jamais suspendu indéfiniment', async () => {
    const fetch = vi.fn(
      (url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason || new Error('aborted')));
        })
    );
    const started = Date.now();
    const res = await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch, timeoutMs: 20 });
    expect(Date.now() - started).toBeLessThan(2000); // très large : borne l'assertion, pas le comportement
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/délai|timeout|garde/i);
  });

  // ⚠️ Mutation : rendre le `signal` optionnel côté appel réseau → rougit.
  it('un AbortSignal est bien posé sur la requête', async () => {
    const fetch = fakeFetch(200, { ingested: 0, skipped: 0 });
    await postBatch('https://x/ingest', 'tok', { schema: 1, cycles: [] }, { fetch });
    const [, init] = fetch.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('DEFAULT_TIMEOUT_MS est une valeur positive raisonnable (pas 0, pas des heures)', () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-55 — main (orchestrateur, promesse n° 4 : jamais un code non nul)', () => {
  const ROOT = 'C:/Users/gibou/sdd-metrics';

  function baseDeps(overrides = {}) {
    return {
      homedir: 'C:/Users/gibou',
      env: { SDD_PUSH_URL: 'https://x/ingest', SDD_PUSH_TOKEN: 'tok' },
      fs: overrides.fs,
      fetch: overrides.fetch,
      stdout: vi.fn(),
      stderr: vi.fn(),
      ...overrides,
    };
  }

  // `cyclesByFile` : { 'C:/Users/gibou/sdd-metrics/cycles/2026-08/<id>.json': record }.
  // `opts.rootExists === false` simule `~/sdd-metrics` absent (finding n° 7) :
  // distinct de « présent mais `cycles/` vide ».
  function fakeFsWithCycles(cyclesByFile, opts = {}) {
    const CYCLES = `${ROOT}/cycles`;
    const dirs = new Map();
    for (const file of Object.keys(cyclesByFile)) {
      const dir = file.replace(/\/[^/]+$/, '');
      if (!dirs.has(dir)) dirs.set(dir, new Set());
      dirs.get(dir).add(file.split('/').pop());
    }
    const monthDirs = new Set(
      [...dirs.keys()].filter((d) => d.startsWith(`${CYCLES}/`)).map((d) => d.split('/').pop())
    );
    if (!dirs.has(CYCLES)) dirs.set(CYCLES, new Set());
    for (const m of monthDirs) dirs.get(CYCLES).add(m);

    const rootExists = opts.rootExists !== false;

    return {
      statSync(p) {
        const key = String(p).replace(/\\/g, '/');
        if (rootExists && (key === ROOT || key === `${ROOT}/.git`)) {
          return { isDirectory: () => true, isFile: () => false };
        }
        const err = new Error(`ENOENT: ${key}`);
        err.code = 'ENOENT';
        throw err;
      },
      readdirSync(dir) {
        const key = String(dir).replace(/\\/g, '/');
        const names = dirs.get(key);
        if (!names) {
          const err = new Error(`ENOENT: ${key}`);
          err.code = 'ENOENT';
          throw err;
        }
        return [...names].map((name) => {
          const full = `${key}/${name}`;
          const isDir = dirs.has(full);
          return { name, isDirectory: () => isDir, isFile: () => !isDir };
        });
      },
      readFileSync(file) {
        const key = String(file).replace(/\\/g, '/');
        const record = cyclesByFile[key];
        if (record === undefined) throw new Error(`ENOENT: ${key}`);
        return JSON.stringify(record);
      },
    };
  }

  // ⚠️ Mutation : émettre une requête malgré une config absente → rougit.
  it('config absente -> sortie 0, aucune requête émise, motif sur stderr', async () => {
    const fetch = vi.fn();
    const stderr = vi.fn();
    const code = await main([], baseDeps({ env: {}, fetch, stderr }));
    expect(code).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
  });

  // ⚠️ Mutation : émettre une requête sur un corpus vide → rougit.
  it('corpus vide (dépôt présent, cycles/ vide) -> sortie 0, aucune requête, motif sur stderr', async () => {
    const fs = fakeFsWithCycles({});
    const fetch = vi.fn();
    const stderr = vi.fn();
    const code = await main([], baseDeps({ fs, fetch, stderr }));
    expect(code).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
  });

  // --- finding de gate SKILL-55 n° 7 --------------------------------------
  // ⚠️ Mutation : recalculer `path.join(homedir, METRICS_DIR_NAME)` à la main
  // au lieu d'appeler `resolveMetricsRoot` → rougit — le motif deviendrait
  // « aucun cycle à pousser » alors que c'est le DÉPÔT ENTIER qui manque.
  it('dépôt de mesures absent -> motif DISTINCT de « corpus vide », toujours sortie 0', async () => {
    const fs = fakeFsWithCycles({}, { rootExists: false });
    const fetch = vi.fn();
    const stderr = vi.fn();
    const code = await main([], baseDeps({ fs, fetch, stderr }));
    expect(code).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
    const message = stderr.mock.calls[0][0];
    expect(message).toMatch(/absent/i);
    expect(message).not.toMatch(/aucun cycle à pousser/);
  });

  // ⚠️ Mutation : émettre plusieurs requêtes pour un lot unique, ou n'imprimer
  // aucune ligne de bilan → rougit.
  it('corpus mono-version de 3 cycles -> une requête, sortie 0, ligne de bilan sur stdout', async () => {
    const fs = fakeFsWithCycles({
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-26-run1-s00.json`]: { schema: 1, ticket: 'SKILL-26' },
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-31-run2-s00.json`]: { schema: 1, ticket: 'SKILL-31' },
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-40-run3-s00.json`]: { schema: 1, ticket: 'SKILL-40' },
    });
    const fetch = vi.fn(async () => ({ status: 200, json: async () => ({ ingested: 3, skipped: 0 }) }));
    const stdout = vi.fn();
    const code = await main([], baseDeps({ fs, fetch, stdout }));
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalled();
    expect(stdout.mock.calls[0][0]).toMatch(/schema 1/);
  });

  // ⚠️ Mutation : ne pas découper au-delà de 500 -> une seule requête pour 501
  // cycles → rougit.
  it('corpus de 501 cycles -> deux requêtes, sortie 0', async () => {
    const files = {};
    for (let i = 0; i < 501; i++) {
      files[`${ROOT}/cycles/2026-08/2026-08-01-SKILL-26-run${i}-s00.json`] = { schema: 1, ticket: 'SKILL-26' };
    }
    const fs = fakeFsWithCycles(files);
    const fetch = vi.fn(async () => ({ status: 200, json: async () => ({ ingested: 1, skipped: 0 }) }));
    const code = await main([], baseDeps({ fs, fetch, stdout: vi.fn() }));
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // ⚠️ Mutation : n'émettre qu'une seule requête pour un corpus à deux
  // versions (les mélanger dans un même lot) → rougit.
  it('corpus à deux versions -> une requête par version, sortie 0', async () => {
    const fs = fakeFsWithCycles({
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-26-run1-s00.json`]: { schema: 1, ticket: 'SKILL-26' },
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-31-run2-s00.json`]: { schema: 2, ticket: 'SKILL-31' },
    });
    const fetch = vi.fn(async () => ({ status: 200, json: async () => ({ ingested: 1, skipped: 0 }) }));
    const code = await main([], baseDeps({ fs, fetch, stdout: vi.fn() }));
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // ⚠️ Mutation : rendre un code non nul quand une requête échoue → rougit.
  // C'est la promesse n° 4 du contrat : elle doit tenir jusque dans main().
  it('une requête échoue (5xx), une autre réussit -> sortie 0, les deux résultats rapportés', async () => {
    const fs = fakeFsWithCycles({
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-26-run1-s00.json`]: { schema: 1, ticket: 'SKILL-26' },
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-31-run2-s00.json`]: { schema: 2, ticket: 'SKILL-31' },
    });
    let call = 0;
    const fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return { status: 503, json: async () => { throw new Error('no body'); } };
      return { status: 200, json: async () => ({ ingested: 1, skipped: 0 }) };
    });
    const stdout = vi.fn();
    const stderr = vi.fn();
    const code = await main([], baseDeps({ fs, fetch, stdout, stderr }));
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(stdout).toHaveBeenCalled(); // le succès rapporté
    expect(stderr).toHaveBeenCalled(); // l'échec rapporté
  });

  // ⚠️ Mutation : rendre un code non nul quand TOUTES les requêtes échouent →
  // rougit.
  it('toutes les requêtes échouent -> sortie 0', async () => {
    const fs = fakeFsWithCycles({
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-26-run1-s00.json`]: { schema: 1, ticket: 'SKILL-26' },
    });
    const fetch = vi.fn(async () => ({ status: 500, json: async () => { throw new Error('x'); } }));
    const code = await main([], baseDeps({ fs, fetch, stdout: vi.fn(), stderr: vi.fn() }));
    expect(code).toBe(0);
  });

  // ⚠️ Mutation : laisser remonter l'exception du transport jusqu'à main() →
  // rougit.
  it('le transport jette -> sortie 0', async () => {
    const fs = fakeFsWithCycles({
      [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-26-run1-s00.json`]: { schema: 1, ticket: 'SKILL-26' },
    });
    const fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const code = await main([], baseDeps({ fs, fetch, stdout: vi.fn(), stderr: vi.fn() }));
    expect(code).toBe(0);
  });

  // ⚠️ Mutation énumérée : un test balaie TOUS les scénarios d'échec et
  // asserte 0 sur chacun — c'est la promesse n° 4 du contrat, condition du
  // câblage dans `/send` et `/deploy`.
  it('aucun chemin de main ne rend un code non nul', async () => {
    const scenarios = [
      // config absente
      async () => main([], baseDeps({ env: {}, fetch: vi.fn(), stdout: vi.fn(), stderr: vi.fn() })),
      // dépôt de mesures absent
      async () =>
        main([], baseDeps({ fs: fakeFsWithCycles({}, { rootExists: false }), fetch: vi.fn(), stdout: vi.fn(), stderr: vi.fn() })),
      // corpus vide
      async () => main([], baseDeps({ fs: fakeFsWithCycles({}), fetch: vi.fn(), stdout: vi.fn(), stderr: vi.fn() })),
      // requête en 401
      async () =>
        main(
          [],
          baseDeps({
            fs: fakeFsWithCycles({ [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-26-run1-s00.json`]: { schema: 1, ticket: 'X' } }),
            fetch: vi.fn(async () => ({ status: 401, json: async () => { throw new Error('x'); } })),
            stdout: vi.fn(),
            stderr: vi.fn(),
          })
        ),
      // transport qui jette
      async () =>
        main(
          [],
          baseDeps({
            fs: fakeFsWithCycles({ [`${ROOT}/cycles/2026-08/2026-08-01-SKILL-26-run1-s00.json`]: { schema: 1, ticket: 'X' } }),
            fetch: vi.fn(async () => {
              throw new Error('timeout');
            }),
            stdout: vi.fn(),
            stderr: vi.fn(),
          })
        ),
    ];
    for (const scenario of scenarios) {
      expect(await scenario()).toBe(0);
    }
  });
});
