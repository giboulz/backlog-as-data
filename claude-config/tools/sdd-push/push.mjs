// SKILL-55 — moitié PRODUCTRICE du contrat de poussée des mesures SDD vers un
// consommateur externe (specs/skill-55.md). LE CONTRAT y est décrit en entier ;
// ce fichier n'est qu'une implémentation, pas une seconde source de vérité.
//
// Trois principes, hérités de D11 (review-log/write.mjs) :
//
//  1. **Chemin dérivé, jamais configuré.** Le corpus est `<home>/sdd-metrics/cycles`
//     — dérivé via `resolveMetricsRoot` et `METRICS_DIR_NAME`, IMPORTÉS de
//     `../review-log/write.mjs` : un seul endroit qui sait où vit le dépôt de
//     mesures ET quels contrôles ("existe", "est un répertoire", "porte un
//     `.git`") en font un dépôt valide. Recopier ce `path.join` ici referait
//     dériver sans en refaire les contrôles (finding de gate SKILL-55 n° 7).
//     Seules `SDD_PUSH_URL` et `SDD_PUSH_TOKEN` viennent de l'environnement :
//     ce sont des coordonnées d'un système TIERS, pas un chemin local.
//  2. **No-op silencieux si rien à faire.** Config absente, dépôt absent,
//     `cycles/` vide ou absent : motif sur stderr, sortie 0, aucune requête.
//  3. **Ne bloque jamais l'appelant** — ni en CODE DE SORTIE, ni en DURÉE.
//     Réseau, timeout, `4xx`, `5xx`, JSON illisible, un `main()` qui rejette :
//     tout est rapporté sur stderr, jamais jeté, code de sortie toujours 0, et
//     chaque POST est borné par un délai de garde (`postBatch`, § Transport).
//     C'est ce qui autorise le câblage dans `/send` et `/deploy`.
//
// Lecture seule sur `~/sdd-metrics` : aucun `git`, aucune écriture, aucun fichier
// de marque. ⛔ Aucun `backlog init`, jamais.
//
// Le fichier de cycle reste la source ; le payload envoyé en est une PROJECTION
// (aujourd'hui l'identité — LE CONTRAT, § « Le fichier de cycle reste la source »).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { METRICS_DIR_NAME, resolveMetricsRoot } from '../review-log/write.mjs';

/** Borne du contrat : au plus 500 cycles par POST (LE CONTRAT, § Corps). */
export const MAX_BATCH_SIZE = 500;

/**
 * Délai de garde par lot (finding de gate SKILL-55 n° 1) : la promesse « ne
 * bloque jamais l'appelant » ne porte pas que sur le CODE de sortie, elle
 * porte aussi sur la DURÉE — sans borne explicite, un `personal-hub` qui
 * accepte la connexion TCP puis ne répond jamais suspend `/send`/`/deploy`
 * pour la durée des délais par défaut du transport (plusieurs minutes),
 * multipliée par le nombre de lots. 10 s est large pour un POST JSON de
 * quelques dizaines de Ko vers un service qui répond, et court pour un
 * opérateur qui regarde `/send` tourner.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Configuration — lue dans l'environnement, jamais ailleurs (D11)
// ---------------------------------------------------------------------------

/**
 * `{ url, token }` si les DEUX variables sont présentes et non vides (espaces
 * seuls comptent comme absent) ; `null` sinon — jamais un objet à champ vide,
 * qui laisserait un appelant émettre une requête sans destination.
 */
export function resolveConfig(env = {}) {
  const rawUrl = env.SDD_PUSH_URL;
  const rawToken = env.SDD_PUSH_TOKEN;
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (url.length === 0 || token.length === 0) return null;
  return { url, token };
}

// ---------------------------------------------------------------------------
// Corpus — lecture seule de `<root>/cycles`
// ---------------------------------------------------------------------------

function defaultStderr(s) {
  process.stderr.write(s);
}

/**
 * Ramasse tous les fichiers `.json` sous `<root>/cycles`, à toute profondeur
 * (le rangement par mois de `review-log/write.mjs` — `cycles/<AAAA-MM>/…` — est
 * une convention de l'ÉCRIVAIN, pas une exigence de ce lecteur).
 *
 * `id` = nom de fichier sans `.json` (clé d'identité du contrat). `record` =
 * contenu du fichier, PARSÉ, jamais retouché — c'est ce qui rend le payload
 * verbatim (LE CONTRAT, § Corps).
 *
 * Racine absente, `cycles/` absent -> tableau vide, jamais une exception, et
 * SANS motif : c'est le cas nominal d'un poste sans dépôt de mesures. Toute
 * autre erreur de lecture — fichier illisible, JSON cassé, `schema` non
 * numérique, sous-dossier illisible (n° 4), doublon d'`id` (n° 5) — produit
 * TOUJOURS un motif sur stderr : le silence n'est réservé qu'au cas légitime.
 * `id` n'est PAS validé contre une forme (SKILL-60) : c'est le nom de fichier
 * sans `.json`, quel qu'il soit — le seul contrôle amont est `schema`.
 */
export function collectCycles(root, deps = {}) {
  const fsx = deps.fs || fs;
  const stderr = deps.stderr || defaultStderr;
  const cyclesDir = path.join(root, 'cycles');
  const cycles = [];
  const seen = new Map(); // id -> { record, path } — dédoublonnage (finding n° 5)

  // `isRoot` distingue les DEUX sémantiques qui partageaient un seul `catch` :
  // au premier appel, `cycles/` absent est le cas nominal documenté ci-dessus
  // (silence). À toute profondeur >= 1, le dossier vient d'être listé par le
  // `readdirSync` PARENT — il existe donc, sauf course ou incident (verrou
  // antivirus, EPERM/EBUSY, dossier déplacé) — jamais un cas légitime : motif
  // sur stderr, et on continue avec le reste du corpus (finding n° 4).
  function walk(dir, isRoot) {
    let entries;
    try {
      entries = fsx.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (!isRoot) {
        stderr(`[sdd-push] ${dir} illisible (${err.message}) — sous-dossier ignoré, le reste du corpus continue\n`);
      }
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, false);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue; // hors périmètre, silencieux

      let raw;
      try {
        raw = fsx.readFileSync(full, 'utf8');
      } catch (err) {
        stderr(`[sdd-push] ${full} illisible (${err.message}) — ignoré\n`);
        continue;
      }

      let record;
      try {
        record = JSON.parse(raw);
      } catch {
        stderr(`[sdd-push] ${full} : JSON illisible — ignoré\n`);
        continue;
      }

      if (typeof record?.schema !== 'number' || !Number.isFinite(record.schema)) {
        stderr(`[sdd-push] ${full} : champ \`schema\` absent ou non numérique — ignoré\n`);
        continue;
      }

      const id = entry.name.slice(0, -'.json'.length);

      // `id` non vide : exigence STRUCTURELLE du contrat (LE CONTRAT, § Corps),
      // pas une validation de forme (SKILL-60 ne l'a PAS réintroduite — un
      // fichier `.json` ou `<espaces>.json` produirait un `id` que le
      // consommateur rejette avec le LOT ENTIER, cf. `id.trim() === ''` de
      // `app/api/sdd/ingest/route.ts`). Motif sur stderr, comme pour `schema`.
      if (id.trim() === '') {
        stderr(`[sdd-push] ${full} : id vide — ignoré\n`);
        continue;
      }

      // Dédoublonnage par `id` (clé d'identité du contrat) : le balayage est
      // récursif à toute profondeur, or l'unicité du nom de fichier que
      // `writeRecord` garantit ne l'est que PAR RÉPERTOIRE (suffixe `-2`,
      // `-3`… « au sein du même dossier »). Deux fichiers de même basename
      // dans deux dossiers différents (copie, archive, résidu) partiraient
      // sinon dans le même lot avec le même `id` — invisible pour le
      // consommateur, en `ON CONFLICT DO NOTHING`. Ici c'est encore visible
      // et encore réparable : motif sur stderr, la PREMIÈRE occurrence
      // rencontrée est conservée, les suivantes sont ignorées.
      const previous = seen.get(id);
      if (previous) {
        const identical = JSON.stringify(previous.record) === JSON.stringify(record);
        stderr(
          `[sdd-push] ${full} : id "${id}" déjà vu (${previous.path}) — ` +
            `${identical ? 'doublon identique' : 'DOUBLON AVEC UN CONTENU DIFFÉRENT'}, ignoré\n`
        );
        continue;
      }
      seen.set(id, { record, path: full });

      cycles.push({ id, record });
    }
  }

  walk(cyclesDir, true);
  return cycles;
}

// ---------------------------------------------------------------------------
// Groupage par version, découpage en lots (LE CONTRAT, § Corps)
// ---------------------------------------------------------------------------

/**
 * Groupe les cycles par `record.schema`. « Un lot ne mêle jamais deux
 * versions » (LE CONTRAT) : c'est ce groupage qui le garantit en amont du
 * découpage en lots. Ordre déterministe (schémas croissants) — corpus vide ->
 * tableau vide.
 */
export function groupBySchema(cycles) {
  const bySchema = new Map();
  for (const cycle of cycles) {
    const schema = cycle.record.schema;
    if (!bySchema.has(schema)) bySchema.set(schema, []);
    bySchema.get(schema).push(cycle);
  }
  return [...bySchema.keys()]
    .sort((a, b) => a - b)
    .map((schema) => ({ schema, cycles: bySchema.get(schema) }));
}

/**
 * Découpe `items` en lots d'au plus `size` éléments, dans l'ordre. Longueur 0
 * -> aucun lot (et non un lot vide) : un corpus vide ne doit produire aucune
 * requête.
 */
export function chunk(items, size) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const lots = [];
  for (let i = 0; i < list.length; i += size) lots.push(list.slice(i, i + size));
  return lots;
}

/**
 * Assemble le corps du POST. Fonction PURE : ne recopie ni ne mute les
 * `cycles` reçus (donc les `record` qu'ils portent), conformément à la
 * promesse « `record` verbatim » du contrat.
 */
export function buildPayload(schema, cycles) {
  return { schema, cycles };
}

// ---------------------------------------------------------------------------
// Transport — un POST, jamais bloquant, jamais suspendu (LE CONTRAT, § Réponses
// / promesse n° 4)
// ---------------------------------------------------------------------------

/**
 * Émet un POST et rend `{ ok: true, ingested, skipped }` ou
 * `{ ok: false, error }` — JAMAIS une exception qui remonte : réseau coupé,
 * timeout, `4xx`, `5xx`, corps illisible sont tous traduits en résultat, pas en
 * rejet. C'est cette fonction qui porte la promesse n° 4 du contrat.
 *
 * `deps.timeoutMs` (défaut `DEFAULT_TIMEOUT_MS`) borne la requête via un
 * `AbortController` : un consommateur qui accepte la connexion puis ne répond
 * jamais est traduit en résultat en erreur au bout de ce délai, jamais une
 * suspension indéfinie — c'est la moitié « durée » de la promesse n° 4, que le
 * seul code de sortie ne suffisait pas à tenir (finding de gate SKILL-55 n° 1).
 */
export async function postBatch(url, token, payload, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const timeoutMs = typeof deps.timeoutMs === 'number' ? deps.timeoutMs : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`délai de garde dépassé (${timeoutMs} ms)`));
  }, timeoutMs);
  // Un `setTimeout` en attente empêcherait le process CLI de sortir de
  // lui-même ; `unref()` ne change rien tant que le timer n'est pas déclenché.
  if (typeof timer.unref === 'function') timer.unref();

  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = controller.signal.aborted && controller.signal.reason ? controller.signal.reason.message : err.message;
    return { ok: false, error: `transport indisponible : ${reason}` };
  } finally {
    clearTimeout(timer);
  }

  const status = res.status;
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null; // corps illisible : traité selon le status ci-dessous
  }

  if (status === 200) {
    if (!body || typeof body.ingested !== 'number' || typeof body.skipped !== 'number') {
      return { ok: false, error: 'réponse 200 au corps illisible ou incomplet' };
    }
    return { ok: true, ingested: body.ingested, skipped: body.skipped };
  }
  if (status === 400) {
    const reason = body && typeof body.error === 'string' ? body.error : 'schema inconnu';
    return { ok: false, error: `400 : ${reason}` };
  }
  if (status === 401) {
    return { ok: false, error: '401 : token absent ou invalide' };
  }
  return { ok: false, error: `HTTP ${status}` };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Codes de sortie : TOUJOURS 0 (promesse n° 4 du contrat — cf. LE CONTRAT,
 * « Ce que le producteur promet »). Config absente, corpus vide, requêtes en
 * échec : tout est un no-op ou un rapport sur stderr/stdout, jamais un échec
 * de sortie. `resolveMetricsRoot` (IMPORTÉE, pas recopiée — cf. en-tête)
 * distingue « dépôt absent » de « corpus vide » : deux motifs différents pour
 * deux causes différentes (finding de gate SKILL-55 n° 7).
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const fsx = deps.fs || fs;
  const homedir = deps.homedir || os.homedir();
  const env = deps.env || process.env;
  const fetchFn = deps.fetch || globalThis.fetch;
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || defaultStderr;

  const config = resolveConfig(env);
  if (!config) {
    stderr('[sdd-push] SDD_PUSH_URL / SDD_PUSH_TOKEN absent(s) ou vide(s) — poussée désactivée (no-op)\n');
    return 0;
  }

  const { root, reason: rootReason } = resolveMetricsRoot(homedir, { fs: fsx });
  if (!root) {
    stderr(`[sdd-push] ${rootReason}\n`);
    return 0;
  }

  const cycles = collectCycles(root, { fs: fsx, stderr });
  if (cycles.length === 0) {
    stderr(`[sdd-push] aucun cycle à pousser (${path.join(root, 'cycles')} absent ou vide) — no-op\n`);
    return 0;
  }

  const groups = groupBySchema(cycles);
  for (const group of groups) {
    const lots = chunk(group.cycles, MAX_BATCH_SIZE);
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      const payload = buildPayload(group.schema, lot);
      const result = await postBatch(config.url, config.token, payload, {
        fetch: fetchFn,
        timeoutMs: deps.timeoutMs,
      });
      const lotLabel = lots.length === 1 ? 'en 1 lot' : `en lot ${i + 1}/${lots.length}`;
      if (result.ok) {
        stdout(
          `[sdd-push] schema ${group.schema} : ${lot.length} cycles envoyés ${lotLabel} — ` +
            `${result.ingested} ingérés, ${result.skipped} déjà connus\n`
        );
      } else {
        stderr(
          `[sdd-push] schema ${group.schema} : ${lot.length} cycles, lot ${i + 1}/${lots.length} ` +
            `échoué — ${result.error}\n`
        );
      }
    }
  }

  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    // Promesse n° 4 du contrat jusque dans l'entrée CLI (finding de gate
    // SKILL-55 n° 6) : sans ce `.catch`, une exception qui échappe aux
    // `try/catch` internes (course de fichier entre `readdirSync` et
    // `readFileSync`, par exemple) deviendrait un rejet non intercepté que
    // Node traduit en code de sortie 1 — exactement ce que `/send` et
    // `/deploy` ont été câblés en tenant pour impossible.
    .catch((err) => {
      try {
        process.stderr.write(`[sdd-push] erreur inattendue, ignorée (sortie 0) : ${err?.message ?? err}\n`);
      } catch {
        // même l'écriture sur stderr peut échouer (flux fermé) : ne rien faire
        // de plus, la sortie 0 reste la promesse à tenir.
      }
      process.exitCode = 0;
    });
}
