import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { discoverTickets } from "@/lib/backlog/cli";
import { buildSnapshot, serializeSnapshot } from "@/lib/backlog/snapshot";
import {
  discoverEpics,
  isBriefManaged,
  missingCoreSections,
  scaffoldBriefSections,
} from "@/lib/backlog/epic-cli";

const ROOT = process.cwd();
const SPECS = path.join(ROOT, "specs");
const EPICS = path.join(SPECS, "epics");

const lf = (s: string) => s.replace(/\r\n/g, "\n");

async function mdCount(): Promise<number> {
  const names = (await readdir(SPECS, { recursive: true })) as string[];
  return names.filter((n) => n.endsWith(".md")).length;
}

describe("backlog coherence", () => {
  // H1 — tout fichier type:ticket est valide (aucun dans `invalid`).
  it("H1 — tous les tickets frontmatter sont valides", async () => {
    const { invalid } = await discoverTickets(SPECS);
    const report = invalid.map((f) => `${f.relPath}: ${f.error}`).join("\n");
    expect(invalid, report).toEqual([]);
  });

  // H2 — ids uniques.
  it("H2 — pas d'id en double", async () => {
    const { tickets } = await discoverTickets(SPECS);
    const ids = tickets.map((t) => t.frontmatter.id);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(dupes, `doublons: ${dupes.join(", ")}`).toEqual([]);
  });

  // H3 — backlog.json en phase avec les fichiers (anti-drift), tolérant CRLF.
  it("H3 — backlog.json est en phase avec le frontmatter", async () => {
    const { tickets } = await discoverTickets(SPECS);
    const expected = serializeSnapshot(
      buildSnapshot(
        tickets.map((t) => ({
          frontmatter: t.frontmatter,
          file: path.join("specs", t.relPath),
          body: t.body,
        })),
      ),
    );
    const actual = await readFile(path.join(ROOT, "backlog.json"), "utf8");
    // Normalise les fins de ligne : git autocrlf peut matérialiser backlog.json
    // en CRLF au checkout, alors que serializeSnapshot émet du LF.
    expect(lf(actual)).toBe(lf(expected));
  });

  // H4 — les fichiers legacy (sans frontmatter ticket) coexistent, ignorés.
  it("H4 — les specs legacy sont ignorées sans erreur", async () => {
    const { tickets } = await discoverTickets(SPECS);
    expect(await mdCount()).toBeGreaterThan(tickets.length);
  });
});

describe("epic brief coherence (INFRA-40)", () => {
  // H5 — tout épic brief-managé (## Challenge présent) possède les 8 sections
  // core (BLG-03 : + « Décisions transverses »). Verrouille « brief scaffoldé
  // ↔ sections core présentes » : attrape une suppression manuelle d'une
  // section core dans specs/epics/*.md. Vert aujourd'hui — aucun épic legacy
  // n'est brief-managé (forward-only).
  it("H5 — tout épic brief-managé possède les 8 sections core", async () => {
    const { epics } = await discoverEpics(EPICS);
    const failures = epics
      .filter((e) => isBriefManaged(e.body))
      .map((e) => ({ id: e.frontmatter.id, missing: missingCoreSections(e.body) }))
      .filter((r) => r.missing.length > 0);
    const report = failures.map((f) => `${f.id}: manque ${f.missing.join(", ")}`).join("\n");
    expect(failures, report).toEqual([]);
  });

  // Garde-fou anti-tautologie : l'invariant rejette bien un brief-managé amputé
  // d'une section core (Hors-scope), sans rien écrire sur disque. Sans lui, H5
  // pourrait passer vert par vacuité (aucun épic brief-managé) même bugué.
  it("l'invariant rejette un brief-managé amputé d'une section core", () => {
    const complete = scaffoldBriefSections("\n# T\n");
    // Retire le titre ## Hors-scope tout en gardant ## Challenge → reste
    // brief-managé mais devient incomplet.
    const amputated = complete.replace(/^## Hors-scope\s*$/m, "");
    expect(isBriefManaged(amputated)).toBe(true);
    expect(missingCoreSections(amputated)).toEqual(["Hors-scope"]);
  });
});
