import { promises as fs } from "node:fs";
import path from "node:path";
import { splitFrontmatter, stripQuotes } from "./ticket-frontmatter";
import { byCodeUnit } from "./snapshot";

// BLG-08 — lecture des escalades E1/E3 loggées dans le corps des specs (D10,
// SKILL-31) + insertion du marqueur de clôture. Aucune I/O de CLI ici (flags,
// dispatch) : ça vit dans lib/backlog/cli.ts. Ce module ne lit/écrit QUE dans
// le `specsDir` qu'on lui passe — jamais `~/.claude` en dur.
//
// Grammaire lue (cf. spec § « Ce que SKILL-31 a réellement arrêté », D1, D2) :
//   - Famille A (post-SKILL-31) : une section `## Escalades (D10)` (suffixe
//     libre après), contenant un `###` par escalade dont le titre COMMENCE
//     PAR la grammaire E (E1, E3, E1/E3, éventuellement suffixé -a / (finding 2)).
//     Tout autre `###` de la section (ex. `### Leçon, à ne pas perdre`) est un
//     frère non-escalade, ignoré en silence (D2).
//   - Famille B (pré-SKILL-31, pas éteinte) : l'escalade elle-même en `##`
//     (`## Escalade E1 — <titre>`), sans section conteneur.
// ⛔ Rien d'autre n'est lu : ni les 4 éléments de contenu, ni les tableaux, ni
// les citations — c'est la prose que SKILL-31 laisse volontairement libre.

export interface EscalationClosure {
  by: string;
  date: string;
}

export interface Escalation {
  /** Ticket propriétaire de la spec où vit l'escalade (frontmatter `id`). */
  ticketId: string;
  /** Chemin relatif à `specsDir`, slashs normalisés. */
  file: string;
  /** Ligne 1-indexée du titre (`###`/`##`) dans le fichier complet. */
  line: number;
  /** Identifiant court reconnu par `--which` (ex. `E1`, `E1-a`, `E1 (finding 2)`). */
  which: string;
  /** Titre complet, tel qu'écrit après le marqueur `#`/`##`. */
  title: string;
  /** `null` = ouverte. Sinon lu dans le marqueur D3 (jamais dans la prose). */
  closed: EscalationClosure | null;
}

/**
 * BLG-11 (D2) — un `###` fils, sous conteneur, qui ne satisfait PAS
 * `GRAMMAR_TAG_RE` (donc n'est pas une escalade au sens D1) mais contient
 * néanmoins un token E isolé (`E1`, `E3`, `E1/E3`) : ça ressemble à une
 * escalade perdue plutôt qu'à de la prose (cf. spec § D2). Signalé, jamais
 * listé (D4) : `ticketId`/`file`/`line`/`title` suffisent à corriger le
 * titre à la source sans relancer d'inventaire.
 */
export interface EscalationWarning {
  ticketId: string;
  file: string;
  line: number;
  title: string;
}

/**
 * D3 — le seul motif reconnu, en lecture ET en écriture. Une clôture écrite à
 * la main (mention dans le titre, etc.) n'est PAS reconnue : elle reste listée
 * ouverte (conséquence assumée, cf. spec D3 point 2).
 */
const CLOSURE_RE = /^→ Traitée par (.+) \((\d{4}-\d{2}-\d{2})\)\.$/;

/**
 * BLG-11 (finding #4) — point unique de la liste des tokens de la grammaire E,
 * partagé par `GRAMMAR_TAG_RE` (ancrée en tête, D1) et `CONTAINS_E_TOKEN_RE`
 * (n'importe où dans le titre, D2) : recopier cette alternation à la main des
 * deux côtés a déjà été signalé comme un risque de silence — un futur `E2`
 * ajouté d'un seul côté rendrait le titre à la fois hors grammaire (jamais
 * listé) et hors détection (jamais signalé), soit le défaut même que ce
 * ticket ferme, réintroduit par construction. `E1/E3` en tête : sinon il
 * matcherait sur le seul `E1`, laissant `/E3` traîner non consommé.
 */
const E_TOKEN_ALT = "E1/E3|E1|E3";

/**
 * Grammaire E : suffixe optionnel `-<alnum>` (`E1-a`), `.<alnum>` (`E1.a`,
 * forme réellement employée sur `specs/skill-41.md`/`skill-44.md`) OU
 * ` (<...>)` (`E1 (finding 2)`). Frontière négative après le match : refuse
 * `E10`/`E1x` (pas un vrai token de grammaire E), mais accepte fin de chaîne,
 * espace, tiret cadratin, etc.
 */
const GRAMMAR_TAG_RE = new RegExp(
  `^(${E_TOKEN_ALT})(-[A-Za-z0-9]+|\\.[A-Za-z0-9]+|\\s+\\([^)]*\\))?(?![A-Za-z0-9])`,
);

const CONTAINER_RE = /^Escalades \(D10\)/;
const FAMILY_B_RE = /^Escalade\s+(.*)$/;
const FENCE_RE = /^\s*```/;

/**
 * BLG-11 (D2) — un token E « isolé » : ni collé à un mot avant (`PIPE1`), ni
 * suivi d'un caractère alphanum (`E10`, `E1x` — pas un vrai token). Volontai-
 * rement plus permissif que `GRAMMAR_TAG_RE` (pas d'ancrage en tête, pas de
 * suffixe `-a`/`.a`/`(…)` à reconnaître) : ce n'est pas une grammaire, c'est
 * un signal « ça ressemble à ».
 */
const CONTAINS_E_TOKEN_RE = new RegExp(`(?<![A-Za-z0-9])(${E_TOKEN_ALT})(?![A-Za-z0-9])`);

/**
 * `id:` du frontmatter, lu en tolérant un frontmatter non strictement valide.
 * Trois garde-fous alignés sur le parseur partagé (`ticket-frontmatter.ts`,
 * dérapage documenté par BLG-03 finding #4) :
 *   1. `type: ticket` requis — un `specs/epics/*.md` (`type: epic`) a aussi un
 *      `id:`, mais `discoverTickets` ne le voit dans AUCUNE autre commande.
 *   2. `stripQuotes` — un `id: "SKILL-41"` ne doit pas rendre l'id guillemets
 *      collés (sinon `close SKILL-41` ne retrouve jamais l'entrée affichée).
 *   3. `[ \t]*` (jamais `\s*`) après `id:` — `\s` matche aussi `\n` : un `id:`
 *      sans valeur laisserait le `.+` engloutir la ligne SUIVANTE (`title: …`)
 *      comme si elle était la valeur de `id`.
 */
function readFrontmatterId(raw: string): string | null {
  const split = splitFrontmatter(raw);
  if (!split) return null;
  if (!/^type:\s*ticket\s*$/m.test(split.fmRaw)) return null;
  const m = /^id:[ \t]*(.+)$/m.exec(split.fmRaw);
  return m ? stripQuotes(m[1]!.trim()) : null;
}

interface CoreEscalation {
  line: number;
  which: string;
  title: string;
  closed: EscalationClosure | null;
}

interface CoreWarning {
  line: number;
  title: string;
}

/**
 * Cœur pur, partagé par `parseEscalationsFromFile` et
 * `parseEscalationWarningsFromFile` (unitaires, un fichier à la fois) ET par
 * `findEscalationsAndWarnings` (BLG-11 finding #3 : le seul appelant réel,
 * `cmdEscalations`, passe par LUI — une seule passe par fichier alimentant
 * les deux listes, jamais deux passes séparées comme avant ce correctif).
 * Parse le corps COMPLET du fichier (frontmatter compris — les numéros de
 * ligne rendus par `escalations` doivent correspondre au fichier réel, pas
 * au seul corps après strip du frontmatter).
 */
function scanFile(raw: string): { escalations: CoreEscalation[]; warnings: CoreWarning[] } {
  const lines = raw.split(/\r?\n/);
  const escalations: CoreEscalation[] = [];
  const warnings: CoreWarning[] = [];
  let inSection = false;
  // Un titre cité DANS un bloc ``` (ex. un gabarit D10 documenté par le
  // SKILL-NN propriétaire du format) n'est pas un vrai titre : on suspend
  // toute lecture (titres ET marqueur de clôture) tant qu'on est dans une
  // fence, sinon une citation devient une « escalade fantôme » qu'un `close`
  // pourrait même corrompre en écrivant DANS le bloc de code.
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      const text = h2[1]!;
      if (CONTAINER_RE.test(text)) {
        inSection = true;
        continue;
      }
      inSection = false;
      const famB = FAMILY_B_RE.exec(text);
      if (famB) {
        const tag = GRAMMAR_TAG_RE.exec(famB[1]!);
        if (tag) {
          escalations.push({ line: i + 1, which: tag[0], title: text, closed: closureAt(lines, i) });
        }
      }
      continue;
    }

    if (inSection) {
      const h3 = /^###\s+(.*)$/.exec(line);
      if (h3) {
        const text = h3[1]!;
        const tag = GRAMMAR_TAG_RE.exec(text);
        // D2 (BLG-08) — un `###` fils qui ne commence pas par la grammaire E est
        // un frère non-escalade (`### Leçon, à ne pas perdre`) : ignoré en
        // silence, SAUF s'il contient un token E isolé (D2 de BLG-11) — signe
        // que la prose n'en est peut-être pas.
        if (tag) {
          escalations.push({ line: i + 1, which: tag[0], title: text, closed: closureAt(lines, i) });
        } else if (CONTAINS_E_TOKEN_RE.test(text)) {
          warnings.push({ line: i + 1, title: text });
        }
      }
    }
  }

  return { escalations, warnings };
}

/**
 * Cœur pur : parse le corps COMPLET du fichier (frontmatter compris — les
 * numéros de ligne rendus par `escalations` doivent correspondre au fichier
 * réel, pas au seul corps après strip du frontmatter).
 */
export function parseEscalationsFromFile(
  raw: string,
  file: string,
  ticketId: string,
): Escalation[] {
  const { escalations } = scanFile(raw);
  return dedupeWhich(escalations.map((e) => ({ ...e, ticketId, file })));
}

/**
 * BLG-11 (D2) — les `###` sous conteneur qui RESSEMBLENT à une escalade
 * (token E isolé) sans en satisfaire la grammaire (D1). Ne change rien à
 * `parseEscalationsFromFile` : ces entrées ne sont jamais listées (D4).
 */
export function parseEscalationWarningsFromFile(
  raw: string,
  file: string,
  ticketId: string,
): EscalationWarning[] {
  const { warnings } = scanFile(raw);
  return warnings.map((w) => ({ ...w, file, ticketId }));
}

/**
 * `which` n'est un identifiant utilisable pour `--which` que s'il est UNIQUE
 * dans le fichier. Le préfixe de grammaire seul ne l'est pas toujours sur le
 * corpus réel (plusieurs `### E1 — finding N : …` dans un même `## Escalades
 * (D10)`, sans suffixe) : sans ce repli, `close` devient inatteignable — le
 * filtre `--which E1` rendrait alors CES MÊMES doublons, jamais une entrée
 * unique. Repli : pour tout groupe de `which` en collision, on retombe sur le
 * titre complet (déjà affiché par `escalations`, donc recopiable tel quel).
 */
function dedupeWhich(entries: Escalation[]): Escalation[] {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.which, (counts.get(e.which) ?? 0) + 1);
  return entries.map((e) =>
    (counts.get(e.which) ?? 0) > 1 ? { ...e, which: e.title } : e,
  );
}

/** Marqueur D3 lu s'il occupe EXACTEMENT la ligne suivant le titre. */
function closureAt(lines: string[], headingIdx: number): EscalationClosure | null {
  const next = lines[headingIdx + 1];
  if (next === undefined) return null;
  const m = CLOSURE_RE.exec(next);
  return m ? { by: m[1]!, date: m[2]! } : null;
}

interface FileEntry {
  filePath: string;
  relFile: string;
  raw: string;
  ticketId: string | null;
}

async function scanFiles(specsDir: string): Promise<FileEntry[]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(specsDir, { recursive: true })) as string[];
  } catch {
    return [];
  }
  const mdNames = names.filter(
    (n): n is string => typeof n === "string" && n.endsWith(".md"),
  );
  const entries: FileEntry[] = [];
  await Promise.all(
    mdNames.map(async (name) => {
      const filePath = path.join(specsDir, name);
      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch {
        return;
      }
      entries.push({
        filePath,
        relFile: name.split(path.sep).join("/"),
        raw,
        ticketId: readFrontmatterId(raw),
      });
    }),
  );
  return entries;
}

/**
 * BLG-11 (finding #1) — ordre déterministe, point unique : `byCodeUnit` sur
 * `ticketId` puis `file` puis `line`, le même comparateur PARTAGÉ que
 * `buildSnapshot` (jamais recodé à la main). Sans ce tri, l'ordre rendu par
 * `scanFiles` dépend de la résolution du `Promise.all` sur les `fs.readFile`
 * — un ordre d'I/O, pas un ordre stable — et un test qui l'asserte devient
 * flaky (cf. spec § test 7 : « ordre déterministe, byCodeUnit »).
 */
function sortByTicketFileLine<T extends { ticketId: string; file: string; line: number }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const byId = byCodeUnit(a.ticketId, b.ticketId);
    if (byId !== 0) return byId;
    const byFile = byCodeUnit(a.file, b.file);
    if (byFile !== 0) return byFile;
    return a.line - b.line;
  });
}

/**
 * BLG-11 (finding #3) — cœur de `findEscalations`/`findEscalationWarnings` :
 * UN `scanFiles` (readdir + readFile), UNE passe `scanFile` par fichier,
 * alimentant les deux listes en parallèle — jamais deux scans complets du
 * corpus pour une seule invocation de `escalations`. Les deux listes sont
 * triées (voir `sortByTicketFileLine`) avant d'être rendues.
 */
export async function findEscalationsAndWarnings(
  specsDir: string,
): Promise<{ escalations: Escalation[]; warnings: EscalationWarning[] }> {
  const files = await scanFiles(specsDir);
  const escalations: Escalation[] = [];
  const warnings: EscalationWarning[] = [];
  for (const f of files) {
    if (!f.ticketId) continue;
    const core = scanFile(f.raw);
    escalations.push(
      ...dedupeWhich(core.escalations.map((e) => ({ ...e, ticketId: f.ticketId!, file: f.relFile }))),
    );
    warnings.push(...core.warnings.map((w) => ({ ...w, ticketId: f.ticketId!, file: f.relFile })));
  }
  return {
    escalations: sortByTicketFileLine(escalations),
    warnings: sortByTicketFileLine(warnings),
  };
}

/** Toutes les escalades (ouvertes et closes) trouvées sous `specsDir`. */
export async function findEscalations(specsDir: string): Promise<Escalation[]> {
  return (await findEscalationsAndWarnings(specsDir)).escalations;
}

/**
 * BLG-11 — toutes les touches D2 (titres qui ressemblent à une escalade sans
 * en satisfaire la grammaire) trouvées sous `specsDir`. Même filtre que
 * `findEscalations` (fichier `type: ticket` avec `id:` valide) : un fichier
 * hors board n'a pas de ticket à qui rattacher l'avertissement.
 */
export async function findEscalationWarnings(specsDir: string): Promise<EscalationWarning[]> {
  return (await findEscalationsAndWarnings(specsDir)).warnings;
}

export interface CloseOptions {
  by: string;
  date: string;
  which?: string;
}

export type CloseResult =
  | { ok: true; escalation: Escalation }
  | { ok: false; error: string };

/**
 * D3/D4 — insère `→ Traitée par <by> (<date>).` immédiatement sous la ligne
 * `line` (1-indexée), sans toucher au reste du fichier. Reconstruit via des
 * segments « ligne + sa terminaison d'origine » (jamais un split/join naïf
 * qui uniformiserait un éventuel CRLF) : le reste du fichier reste identique
 * octet pour octet.
 */
export function insertClosureMarker(raw: string, line: number, markerText: string): string {
  const chunks = raw.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const idx = line - 1;
  if (idx < 0 || idx >= chunks.length) {
    throw new Error(`insertClosureMarker: ligne ${line} hors du fichier`);
  }
  let headingChunk = chunks[idx]!;
  const eolMatch = /\r?\n$/.exec(headingChunk);
  const eol = eolMatch ? eolMatch[0] : "\n";
  if (!eolMatch) {
    // Titre sur la dernière ligne du fichier (sans retour final) : on lui en
    // donne un pour pouvoir insérer le marqueur juste après.
    headingChunk = headingChunk + eol;
  }
  const next = chunks.slice();
  next[idx] = headingChunk;
  next.splice(idx + 1, 0, markerText + eol);
  return next.join("");
}

/**
 * D4 — clôture UNE escalade : `--which` requis dès que le ticket en porte
 * plusieurs (toutes, ouvertes ou closes — cf. spec, littéral). Une escalade
 * déjà close → erreur explicite, fichier inchangé. N'écrit JAMAIS ailleurs
 * que la ligne du marqueur (D4 : « n'écrit que sa ligne »).
 */
export async function closeEscalation(
  specsDir: string,
  ticketId: string,
  opts: CloseOptions,
): Promise<CloseResult> {
  const files = await scanFiles(specsDir);
  const matches = files.filter((f) => f.ticketId === ticketId);
  if (matches.length === 0) {
    return { ok: false, error: `${ticketId} : aucune spec portant cet id sous ${specsDir}` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `${ticketId} ambigu : ${matches.length} fichiers portent cet id (${matches
        .map((m) => m.relFile)
        .join(", ")})`,
    };
  }
  const file = matches[0]!;
  const escalations = parseEscalationsFromFile(file.raw, file.relFile, ticketId);
  if (escalations.length === 0) {
    return { ok: false, error: `${ticketId} : aucune escalade dans ${file.relFile}` };
  }

  let candidates = escalations;
  if (opts.which !== undefined) {
    candidates = escalations.filter((e) => e.which === opts.which);
    if (candidates.length === 0) {
      const avail = escalations.map((e) => e.which).join(", ");
      return {
        ok: false,
        error: `${ticketId} : aucune escalade « ${opts.which} » — disponibles : ${avail}`,
      };
    }
  }
  if (candidates.length > 1) {
    // `which` (après dedupeWhich) EST déjà la valeur à recopier telle quelle
    // dans --which — pas de préfixe supplémentaire (en famille A, `which`
    // commence déjà par le titre quand il retombe dessus : le préfixer une
    // deuxième fois produisait un doublon incopiable, cf. finding #9).
    const list = candidates.map((e) => JSON.stringify(e.which)).join(", ");
    return {
      ok: false,
      error: `${ticketId} : plusieurs escalades, --which requis parmi : ${list}`,
    };
  }

  const target = candidates[0]!;
  if (target.closed) {
    return {
      ok: false,
      error: `${ticketId} : escalade « ${target.which} » déjà close (par ${target.closed.by}, ${target.closed.date})`,
    };
  }

  const marker = `→ Traitée par ${opts.by} (${opts.date}).`;
  const nextRaw = insertClosureMarker(file.raw, target.line, marker);
  await fs.writeFile(file.filePath, nextRaw, "utf8");
  return {
    ok: true,
    escalation: { ...target, closed: { by: opts.by, date: opts.date } },
  };
}
