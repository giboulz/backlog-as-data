import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  closeEscalation,
  findEscalations,
  findEscalationWarnings,
  insertClosureMarker,
  parseEscalationsFromFile,
  parseEscalationWarningsFromFile,
} from "@/lib/backlog/escalations";

// BLG-08 — fixtures ÉCRITES PAR LE TEST, jamais sur `~/.claude` (§ Portée).

let root: string;
let specsDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "backlog-escalations-"));
  specsDir = path.join(root, "specs");
  await mkdir(specsDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSpec(id: string, filename: string, body: string): Promise<string> {
  const filePath = path.join(specsDir, filename);
  const raw = `---\nid: ${id}\ntype: ticket\nstatus: shipped\n---\n${body}`;
  await writeFile(filePath, raw, "utf8");
  return filePath;
}

describe("parseEscalationsFromFile — grammaire D1/D2 (cœur pur)", () => {
  // T1 — Famille A : deux ### sous "## Escalades (D10)" → 2 escalades, avec leurs lignes.
  it("T1 — famille A : deux escalades dans une section conteneur", () => {
    const raw = [
      "---",
      "id: SKILL-99",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "### E1 (finding 2) — promotion d'un helper",
      "constat…",
      "",
      "### E1 (finding 3) — le geste B fait l'inverse",
      "constat…",
      "",
    ].join("\n");
    const found = parseEscalationsFromFile(raw, "skill-99.md", "SKILL-99");
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      ticketId: "SKILL-99",
      which: "E1 (finding 2)",
      title: "E1 (finding 2) — promotion d'un helper",
      closed: null,
    });
    expect(found[1]).toMatchObject({
      which: "E1 (finding 3)",
      title: "E1 (finding 3) — le geste B fait l'inverse",
    });
    // lignes 1-indexées, exactes dans le fichier COMPLET (frontmatter compris)
    expect(found[0]!.line).toBe(raw.split("\n").indexOf("### E1 (finding 2) — promotion d'un helper") + 1);
    expect(found[1]!.line).toBe(raw.split("\n").indexOf("### E1 (finding 3) — le geste B fait l'inverse") + 1);
  });

  // T2 — Famille B : "## Escalade E1 — …" seul, sans section conteneur → 1 escalade.
  it("T2 — famille B : escalade en ## sans conteneur", () => {
    const raw = [
      "---",
      "id: SKILL-50",
      "type: ticket",
      "---",
      "",
      "## Escalade E1 — deux documents périmés",
      "constat…",
      "",
    ].join("\n");
    const found = parseEscalationsFromFile(raw, "skill-50.md", "SKILL-50");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      which: "E1",
      title: "Escalade E1 — deux documents périmés",
      closed: null,
    });
  });

  // T3 — le frère non-escalade (D2) : "### Leçon, à ne pas perdre" n'est pas compté.
  it("T3 — un ### frère non-escalade est ignoré en silence", () => {
    const raw = [
      "---",
      "id: SKILL-48",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "### E1 — trois défauts nés du ticket",
      "constat…",
      "",
      "### Leçon, à ne pas perdre",
      "texte…",
      "",
    ].join("\n");
    const found = parseEscalationsFromFile(raw, "skill-48.md", "SKILL-48");
    expect(found).toHaveLength(1);
    expect(found[0]!.which).toBe("E1");
  });

  // T4 — suffixes de la grammaire E reconnus ; mutation-témoin "Escalade évitée" rejeté.
  it("T4 — suffixes E1/E3/E1-a/E1 (finding 2) reconnus, faux positif rejeté", () => {
    const raw = [
      "---",
      "id: SKILL-51",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "### E1 — sans suffixe",
      "x",
      "### E3 — sans suffixe",
      "x",
      "### E1/E3 — les deux",
      "x",
      "### E1-a — suffixe lettre",
      "x",
      "### E1 (finding 2) — suffixe parenthèse",
      "x",
      "### Escalade évitée — pas la grammaire",
      "x",
      "",
    ].join("\n");
    const found = parseEscalationsFromFile(raw, "skill-51.md", "SKILL-51");
    expect(found.map((e) => e.which)).toEqual(["E1", "E3", "E1/E3", "E1-a", "E1 (finding 2)"]);
  });

  // T5 — fichier sans escalade → liste vide, jamais une erreur.
  it("T5 — fichier sans escalade rend une liste vide", () => {
    const raw = ["---", "id: SKILL-52", "type: ticket", "---", "", "## Rien à voir", "prose", ""].join(
      "\n",
    );
    expect(parseEscalationsFromFile(raw, "skill-52.md", "SKILL-52")).toEqual([]);
  });

  // T6 — section "## Escalades (D10)" vide (aucun ###) → 0, sans planter.
  it("T6 — section conteneur vide rend 0 sans planter", () => {
    const raw = [
      "---",
      "id: SKILL-53",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "## Une autre section",
      "prose",
      "",
    ].join("\n");
    expect(() => parseEscalationsFromFile(raw, "skill-53.md", "SKILL-53")).not.toThrow();
    expect(parseEscalationsFromFile(raw, "skill-53.md", "SKILL-53")).toEqual([]);
  });
});

describe("findEscalations — scan de specsDir", () => {
  // T7 — les deux familles sont lues ensemble sur plusieurs fichiers.
  it("T7 — lit famille A et famille B sur des fichiers distincts", async () => {
    await writeSpec("SKILL-60", "skill-60.md", "\n## Escalades (D10)\n\n### E1 — a\nx\n");
    await writeSpec("SKILL-61", "skill-61.md", "\n## Escalade E3 — b\nx\n");
    const found = await findEscalations(specsDir);
    expect(found).toHaveLength(2);
    expect(found.map((e) => e.ticketId).sort()).toEqual(["SKILL-60", "SKILL-61"]);
  });
});

describe("insertClosureMarker + closeEscalation — clôture D3/D4", () => {
  // T8 — close insère la ligne immédiatement sous le titre, reste inchangé octet pour octet.
  it("T8 — close insère le marqueur sous le titre, reste identique", async () => {
    const body = "\n## Escalades (D10)\n\n### E1 — axe model non épinglé\nconstat…\nsuite…\n";
    const filePath = await writeSpec("SKILL-70", "skill-70.md", body);
    const before = await readFile(filePath, "utf8");

    const res = await closeEscalation(specsDir, "SKILL-70", { by: "SKILL-71", date: "2026-08-21" });
    expect(res.ok).toBe(true);

    const after = await readFile(filePath, "utf8");
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    const titleIdx = beforeLines.indexOf("### E1 — axe model non épinglé");
    expect(afterLines[titleIdx + 1]).toBe("→ Traitée par SKILL-71 (2026-08-21).");
    // le reste du fichier est inchangé : en retirant la ligne insérée on retrouve l'original
    const reconstructed = [...afterLines.slice(0, titleIdx + 1), ...afterLines.slice(titleIdx + 2)].join(
      "\n",
    );
    expect(reconstructed).toBe(before);
  });

  // T9 — l'escalade close disparaît de la liste ouverte, apparaît dans --all avec son traitant.
  it("T9 — close disparaît des ouvertes, apparaît dans --all", async () => {
    await writeSpec("SKILL-72", "skill-72.md", "\n## Escalades (D10)\n\n### E1 — x\nc\n");
    await closeEscalation(specsDir, "SKILL-72", { by: "SKILL-73", date: "2026-08-22" });

    const open = (await findEscalations(specsDir)).filter((e) => !e.closed);
    expect(open).toHaveLength(0);

    const all = await findEscalations(specsDir);
    expect(all).toHaveLength(1);
    expect(all[0]!.closed).toEqual({ by: "SKILL-73", date: "2026-08-22" });
  });

  // T10 — re-fermer une escalade déjà close → erreur explicite, fichier inchangé.
  it("T10 — refermer une escalade déjà close échoue sans toucher le fichier", async () => {
    const filePath = await writeSpec("SKILL-74", "skill-74.md", "\n## Escalades (D10)\n\n### E1 — x\nc\n");
    await closeEscalation(specsDir, "SKILL-74", { by: "SKILL-75", date: "2026-08-22" });
    const afterFirstClose = await readFile(filePath, "utf8");

    const res = await closeEscalation(specsDir, "SKILL-74", { by: "SKILL-76", date: "2026-08-23" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/déjà close/);

    const afterSecondAttempt = await readFile(filePath, "utf8");
    expect(afterSecondAttempt).toBe(afterFirstClose);
  });

  // T11 — ticket à plusieurs escalades sans --which → refus, sortie liste les candidates.
  it("T11 — plusieurs escalades sans --which : refus avec la liste des candidates", async () => {
    await writeSpec(
      "SKILL-77",
      "skill-77.md",
      "\n## Escalades (D10)\n\n### E1 — première\nc\n\n### E3 — deuxième\nc\n",
    );
    const res = await closeEscalation(specsDir, "SKILL-77", { by: "SKILL-78", date: "2026-08-24" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/--which/);
      expect(res.error).toMatch(/E1/);
      expect(res.error).toMatch(/E3/);
    }
  });

  // T11b — avec --which, la bonne escalade est fermée (parité positive de T11).
  it("T11b — --which cible la bonne escalade parmi plusieurs", async () => {
    await writeSpec(
      "SKILL-79",
      "skill-79.md",
      "\n## Escalades (D10)\n\n### E1 — première\nc\n\n### E3 — deuxième\nc\n",
    );
    const res = await closeEscalation(specsDir, "SKILL-79", {
      by: "SKILL-80",
      date: "2026-08-24",
      which: "E3",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.escalation.which).toBe("E3");

    const all = await findEscalations(specsDir);
    const e1 = all.find((e) => e.which === "E1")!;
    const e3 = all.find((e) => e.which === "E3")!;
    expect(e1.closed).toBeNull();
    expect(e3.closed).toEqual({ by: "SKILL-80", date: "2026-08-24" });
  });

  // T12 — une clôture écrite à la main (cas réel skill-40.md) est listée ouverte.
  // ⚠️ Conséquence ASSUMÉE de D3 (motif unique, écrit ET lu par l'outil) : ce
  // n'est PAS un bug — apprendre à l'outil à reconnaître la prose rouvrirait le
  // parseur que SKILL-31 ferme délibérément (cf. spec § D3 point 2).
  it("T12 — une clôture écrite à la main reste listée ouverte (voulu, pas un bug)", () => {
    // Structure fidèle au fichier réel (skill-40.md:240) : la parenthèse de
    // levée manuscrite est en FIN de titre, pas collée au tag — sinon elle
    // matcherait l'alternative de suffixe ` (…)` de GRAMMAR_TAG_RE et `which`
    // deviendrait "E1 (⚠️ LEVÉE…)" au lieu de "E1", ce que le fichier réel ne
    // produit pas (finding #8 : la fixture précédente divergeait du cas cité).
    const raw = [
      "---",
      "id: SKILL-40",
      "type: ticket",
      "---",
      "",
      "## Escalade E1 — l'axe model reste le seul non épinglé (⚠️ LEVÉE — voir SKILL-41/SKILL-52)",
      "constat…",
      "",
    ].join("\n");
    const found = parseEscalationsFromFile(raw, "skill-40.md", "SKILL-40");
    expect(found).toHaveLength(1);
    expect(found[0]!.which).toBe("E1");
    expect(found[0]!.closed).toBeNull();
  });

  // T13 — insertClosureMarker préserve les eol CRLF quand le fichier en porte.
  it("T13 — insertClosureMarker respecte un fichier CRLF", () => {
    const raw = "### E1 — x\r\nconstat\r\n";
    const next = insertClosureMarker(raw, 1, "→ Traitée par SKILL-1 (2026-08-24).");
    expect(next).toBe("### E1 — x\r\n→ Traitée par SKILL-1 (2026-08-24).\r\nconstat\r\n");
  });

  // T14 (finding #1) — plusieurs escalades SANS suffixe rendent le MÊME tag
  // ("E1" partout, cas réel skill-46.md/skill-53.md) : `which` retombe alors
  // sur le titre complet (unique), et `--which "<titre>"` referme la bonne.
  it("T14 — which retombe sur le titre quand le tag seul est en collision", async () => {
    await writeSpec(
      "SKILL-46",
      "skill-46.md",
      [
        "",
        "## Escalades (D10)",
        "",
        "### E1 — finding 5 : a",
        "c",
        "",
        "### E1 — finding 8 : b",
        "c",
        "",
        "### E1 — finding 9 : c",
        "c",
        "",
      ].join("\n"),
    );
    const found = await findEscalations(specsDir);
    expect(found.map((e) => e.which)).toEqual([
      "E1 — finding 5 : a",
      "E1 — finding 8 : b",
      "E1 — finding 9 : c",
    ]);

    const res = await closeEscalation(specsDir, "SKILL-46", {
      by: "SKILL-99",
      date: "2026-08-24",
      which: "E1 — finding 8 : b",
    });
    expect(res.ok).toBe(true);
    const after = await findEscalations(specsDir);
    const closedOne = after.find((e) => e.which === "E1 — finding 8 : b")!;
    const stillOpen = after.filter((e) => e.which !== "E1 — finding 8 : b");
    expect(closedOne.closed).toEqual({ by: "SKILL-99", date: "2026-08-24" });
    expect(stillOpen.every((e) => e.closed === null)).toBe(true);
  });

  // T15 (finding #1) — le suffixe `.a`/`.b`/`.c` (skill-41.md/skill-44.md, forme
  // réellement employée) est reconnu au même titre que `-a` et ` (…)`.
  it("T15 — suffixe .a/.b/.c reconnu", () => {
    const raw = [
      "---",
      "id: SKILL-41",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "### E1.a — première moitié",
      "x",
      "### E1.b — deuxième moitié",
      "x",
      "",
    ].join("\n");
    const found = parseEscalationsFromFile(raw, "skill-41.md", "SKILL-41");
    expect(found.map((e) => e.which)).toEqual(["E1.a", "E1.b"]);
  });

  // T16 (finding #9) — la liste de candidates n'affiche pas le tag en double
  // (which unique et court ici : E1/E3 ne collisionnent pas → pas de repli titre).
  it("T16 — la liste de candidates ne duplique pas which/title", async () => {
    await writeSpec(
      "SKILL-81",
      "skill-81.md",
      "\n## Escalades (D10)\n\n### E1 — première\nc\n\n### E3 — deuxième\nc\n",
    );
    const res = await closeEscalation(specsDir, "SKILL-81", { by: "SKILL-82", date: "2026-08-24" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('"E1"');
      expect(res.error).toContain('"E3"');
      // which n'est jamais préfixé une seconde fois par lui-même.
      expect(res.error).not.toMatch(/E1.*E1 —|E1 —.*E1 —/);
    }
  });

  // T16b (finding #9) — quand which retombe sur le titre (collision), la
  // liste de candidates n'affiche PAS non plus de doublon.
  it("T16b — pas de doublon même quand which retombe sur le titre", async () => {
    await writeSpec(
      "SKILL-82",
      "skill-82.md",
      "\n## Escalades (D10)\n\n### E1 — première\nc\n\n### E1 — deuxième\nc\n",
    );
    const res = await closeEscalation(specsDir, "SKILL-82", { by: "SKILL-83", date: "2026-08-24" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const occurrences = (res.error.match(/E1 — première/g) ?? []).length;
      expect(occurrences).toBe(1);
    }
  });

  // T17 (finding #3/#6) — id quoté : stripQuotes s'applique, close le retrouve.
  it("T17 — un id quoté (id: \"SKILL-77\") est lu sans guillemets", async () => {
    await writeFile(
      path.join(specsDir, "skill-77.md"),
      '---\nid: "SKILL-77"\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### E1 — x\nc\n',
      "utf8",
    );
    const found = await findEscalations(specsDir);
    expect(found).toHaveLength(1);
    expect(found[0]!.ticketId).toBe("SKILL-77");

    const res = await closeEscalation(specsDir, "SKILL-77", { by: "SKILL-78", date: "2026-08-24" });
    expect(res.ok).toBe(true);
  });

  // T18 (finding #6) — un fichier `type: epic` n'est PAS scanné (parité discoverTickets).
  it("T18 — un frontmatter type: epic est ignoré", async () => {
    await mkdir(path.join(specsDir, "epics"), { recursive: true });
    await writeFile(
      path.join(specsDir, "epics", "foo.md"),
      "---\nid: foo\ntype: epic\n---\n\n## Escalades (D10)\n\n### E1 — x\nc\n",
      "utf8",
    );
    const found = await findEscalations(specsDir);
    expect(found).toEqual([]);
  });

  // T19 (finding #3) — un `id:` sans valeur ne fait pas remonter la ligne suivante.
  it("T19 — un id vide ne capture pas la ligne suivante", async () => {
    await writeFile(
      path.join(specsDir, "empty-id.md"),
      "---\nid:\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### E1 — x\nc\n",
      "utf8",
    );
    const found = await findEscalations(specsDir);
    expect(found).toEqual([]);
  });

  // T20 (finding #10) — un titre CITÉ dans un bloc ``` n'est pas une vraie escalade.
  it("T20 — un titre dans un bloc de code fencé est ignoré", () => {
    const raw = [
      "---",
      "id: SKILL-56",
      "type: ticket",
      "---",
      "",
      "Gabarit documenté pour SKILL-31 :",
      "",
      "```markdown",
      "## Escalades (D10)",
      "",
      "### E1 (finding 2) — <titre>",
      "```",
      "",
      "## Escalades (D10)",
      "",
      "### E1 — vraie escalade",
      "constat…",
      "",
    ].join("\n");
    const found = parseEscalationsFromFile(raw, "skill-56.md", "SKILL-56");
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("E1 — vraie escalade");
  });
});

describe("parseEscalationWarningsFromFile — D2 (BLG-11)", () => {
  // Test 1 (spec) — un ### sous conteneur, titre "Finding 2 de la gate — E1"
  // (ne commence pas par le tag, le contient) → 1 avertissement, et l'entrée
  // n'apparaît PAS dans les escalades (D4).
  it("test 1 — titre finissant par E1 sans commencer par lui : 1 avertissement, pas listé", () => {
    const raw = [
      "---",
      "id: SKILL-56",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "### Finding 2 de la gate — E1",
      "constat…",
      "",
    ].join("\n");
    const warnings = parseEscalationWarningsFromFile(raw, "skill-56.md", "SKILL-56");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      ticketId: "SKILL-56",
      file: "skill-56.md",
      title: "Finding 2 de la gate — E1",
      line: raw.split("\n").indexOf("### Finding 2 de la gate — E1") + 1,
    });
    expect(parseEscalationsFromFile(raw, "skill-56.md", "SKILL-56")).toEqual([]);
  });

  // Test 2 (spec) — prose légitime (cas D2 de BLG-08), sans token E → 0 avertissement.
  it("test 2 — prose légitime sans token E : 0 avertissement", () => {
    const raw = [
      "---",
      "id: SKILL-48",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "### Leçon, à ne pas perdre",
      "texte…",
      "",
    ].join("\n");
    expect(parseEscalationWarningsFromFile(raw, "skill-48.md", "SKILL-48")).toEqual([]);
  });

  // Test 3 (spec) — chemin nominal (titre commence par le tag) : 0 avertissement,
  // 1 escalade, aucune régression.
  it("test 3 — chemin nominal (titre commence par le tag) : 0 avertissement, 1 escalade", () => {
    const raw = [
      "---",
      "id: SKILL-57",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "### E1 — un titre normal",
      "constat…",
      "",
    ].join("\n");
    expect(parseEscalationWarningsFromFile(raw, "skill-57.md", "SKILL-57")).toEqual([]);
    expect(parseEscalationsFromFile(raw, "skill-57.md", "SKILL-57")).toHaveLength(1);
  });

  // Test 4 (spec) — un ### HORS conteneur portant E1 dans son titre : 0 avertissement
  // (seul le contenu sous "## Escalades (D10)" est surveillé).
  it("test 4 — ### hors conteneur avec E1 dans le titre : 0 avertissement", () => {
    const raw = [
      "---",
      "id: SKILL-58",
      "type: ticket",
      "---",
      "",
      "## Une autre section",
      "",
      "### Un souci — E1",
      "texte…",
      "",
    ].join("\n");
    expect(parseEscalationWarningsFromFile(raw, "skill-58.md", "SKILL-58")).toEqual([]);
  });

  // Test 5 (spec) — un token E collé à un mot (pas isolé) : 0 avertissement.
  it("test 5 — token E collé à un mot : 0 avertissement", () => {
    const raw = [
      "---",
      "id: SKILL-59",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "### Voir PIPE1 pour le contexte",
      "texte…",
      "",
      "### section E10",
      "texte…",
      "",
    ].join("\n");
    expect(parseEscalationWarningsFromFile(raw, "skill-59.md", "SKILL-59")).toEqual([]);
  });

  // Test 6 (spec) — titre cité dans un bloc fencé : 0 avertissement (parité
  // avec la suspension de lecture de BLG-08 finding 10).
  it("test 6 — titre dans un bloc fencé : 0 avertissement", () => {
    const raw = [
      "---",
      "id: SKILL-56",
      "type: ticket",
      "---",
      "",
      "## Escalades (D10)",
      "",
      "```markdown",
      "### Finding 2 de la gate — E1",
      "```",
      "",
    ].join("\n");
    expect(parseEscalationWarningsFromFile(raw, "skill-56.md", "SKILL-56")).toEqual([]);
  });
});

describe("findEscalationWarnings — deux fichiers, ordre déterministe (BLG-11)", () => {
  // Test 7 (spec) — deux touches dans deux fichiers → 2 lignes, ordre
  // déterministe (byCodeUnit, comme la sortie).
  it("test 7 — deux touches dans deux fichiers, ordre par ticketId", async () => {
    await writeSpec(
      "SKILL-99",
      "skill-99.md",
      "\n## Escalades (D10)\n\n### Finding — E1\nc\n",
    );
    await writeSpec(
      "SKILL-56",
      "skill-56.md",
      "\n## Escalades (D10)\n\n### Finding 2 de la gate — E1\nc\n",
    );
    const found = await findEscalationWarnings(specsDir);
    expect(found).toHaveLength(2);
    expect(found.map((w) => w.ticketId)).toEqual(["SKILL-56", "SKILL-99"]);
  });
});
