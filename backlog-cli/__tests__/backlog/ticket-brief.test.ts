import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBacklogCommand } from "@/lib/backlog/cli";
import { parseTicketFile } from "@/lib/backlog/ticket-frontmatter";
import {
  TICKET_SPEC_SECTIONS,
  resolveCoreSections,
} from "@/lib/backlog/ticket-brief";

// INFRA-41 — verbe `ticket brief <ID>` : scaffolde le `*.core` du kind du ticket
// (feature par défaut, bug si kind: bug, --kind en override ponctuel), avec
// override projet par `.claude/ticket-sections.json`. Idempotent, non destructif.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ticket-brief-"));
  await mkdir(path.join(root, "specs"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bodyOf = async (id: string) =>
  readFile(path.join(root, "specs", `${id.toLowerCase()}.md`), "utf8");

const FEATURE_HEADINGS = TICKET_SPEC_SECTIONS.feature.core.map((s) => s.heading);
const BUG_HEADINGS = TICKET_SPEC_SECTIONS.bug.core.map((s) => s.heading);

describe("resolveCoreSections (pur, INFRA-41)", () => {
  it("sans override → défaut global du kind", () => {
    expect(resolveCoreSections("feature", null).map((s) => s.heading)).toEqual(
      FEATURE_HEADINGS,
    );
    expect(resolveCoreSections("bug", null).map((s) => s.heading)).toEqual(
      BUG_HEADINGS,
    );
  });

  it("override présent → SES sections pour le kind demandé", () => {
    const override = { feature: ["Contexte", "But"], bug: ["Bug"], optional: [] };
    expect(resolveCoreSections("feature", override).map((s) => s.heading)).toEqual([
      "Contexte",
      "But",
    ]);
  });

  it("override partiel (kind absent) → repli sur le défaut global", () => {
    const override = { bug: ["Bug"] };
    expect(resolveCoreSections("feature", override).map((s) => s.heading)).toEqual(
      FEATURE_HEADINGS,
    );
  });

  it("override d'un kind sans section valide → repli sur le défaut (pas 0 section)", () => {
    // Array vide, éléments tous non-string, ou strings vides : aucun ne doit
    // produire un brief vide — sinon « 0 section scaffoldée » en code 0.
    for (const bad of [[], [42, {}], ["", "   "], [null, false]]) {
      expect(
        resolveCoreSections("feature", { feature: bad }).map((s) => s.heading),
        `attendu repli défaut pour override=${JSON.stringify(bad)}`,
      ).toEqual(FEATURE_HEADINGS);
    }
    // sanity : un tableau partiellement valide garde ses éléments string non vides
    expect(
      resolveCoreSections("feature", { feature: [42, "Vrai titre", ""] }).map((s) => s.heading),
    ).toEqual(["Vrai titre"]);
  });
});

describe("backlog CLI — ticket brief (INFRA-41)", () => {
  it("brief sur un ticket kind feature (absent) → 6 sections feature", async () => {
    await runBacklogCommand(["new", "FOO-01"], { root });
    const r = await runBacklogCommand(["brief", "FOO-01"], { root });
    expect(r.code).toBe(0);
    const raw = await bodyOf("FOO-01");
    for (const h of FEATURE_HEADINGS) expect(raw).toContain(`## ${h}`);
    expect(raw).toContain("## Problème");
    expect(raw).not.toContain("## Symptôme");
  });

  it("brief sur un ticket kind bug → 6 sections bug", async () => {
    await runBacklogCommand(["new", "BUG-01", "--kind", "bug"], { root });
    const r = await runBacklogCommand(["brief", "BUG-01"], { root });
    expect(r.code).toBe(0);
    const raw = await bodyOf("BUG-01");
    for (const h of BUG_HEADINGS) expect(raw).toContain(`## ${h}`);
    expect(raw).toContain("## Symptôme");
    expect(raw).toContain("## Cause racine");
    expect(raw).toContain("## Correction attendue");
    expect(raw).not.toContain("## Décision");
  });

  it("--kind bug override ponctuel sur un ticket sans kind → sections bug", async () => {
    await runBacklogCommand(["new", "FOO-02"], { root });
    const r = await runBacklogCommand(["brief", "FOO-02", "--kind", "bug"], { root });
    expect(r.code).toBe(0);
    const raw = await bodyOf("FOO-02");
    // brief --kind bug pose bien les sections bug…
    expect(raw).toContain("## Symptôme");
    // …de façon additive et non destructive : le squelette feature posé par `new`
    // (INFRA-42) coexiste. (Avant INFRA-42, `new` produisait un corps vide → Problème
    // absent ; le pré-scaffold de `new` fait désormais cohabiter les deux jeux.)
    expect(raw).toContain("## Problème");
  });

  it("override projet (.claude/ticket-sections.json) → ce sont SES sections", async () => {
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(
      path.join(root, ".claude", "ticket-sections.json"),
      JSON.stringify({
        feature: ["Contexte projet", "But", "Tests"],
        bug: ["Bug constaté", "Fix"],
        optional: [],
      }),
      "utf8",
    );
    await runBacklogCommand(["new", "FOO-03"], { root });
    const r = await runBacklogCommand(["brief", "FOO-03"], { root });
    expect(r.code).toBe(0);
    const raw = await bodyOf("FOO-03");
    expect(raw).toContain("## Contexte projet");
    expect(raw).toContain("## But");
    // le défaut global n'est PAS posé quand un override existe
    expect(raw).not.toContain("## Problème");
    expect(raw).not.toContain("## Décision");
  });

  it("id inconnu → code ≠ 0", async () => {
    const r = await runBacklogCommand(["brief", "NOPE-99"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/introuvable/i);
  });

  it("idempotence CLI : deux brief ne dupliquent aucune section", async () => {
    await runBacklogCommand(["new", "FOO-04"], { root });
    await runBacklogCommand(["brief", "FOO-04"], { root });
    await runBacklogCommand(["brief", "FOO-04"], { root });
    const raw = await bodyOf("FOO-04");
    for (const h of FEATURE_HEADINGS) {
      expect(raw.split(`## ${h}`).length - 1).toBe(1);
    }
  });

  it("brief non destructif : préserve le contenu déjà rédigé d'une section", async () => {
    await runBacklogCommand(["new", "FOO-05"], { root });
    // `new` a déjà scaffoldé la section Problème (INFRA-42) ; on y rédige (remplace le
    // 1er placeholder, sous Problème) puis brief : le contenu doit survivre, sans dupliquer.
    const p = path.join(root, "specs", "foo-05.md");
    const cur = await readFile(p, "utf8");
    await writeFile(p, cur.replace("_(à remplir)_", "vrai contenu métier"), "utf8");
    const r = await runBacklogCommand(["brief", "FOO-05"], { root });
    expect(r.code).toBe(0);
    const raw = await readFile(p, "utf8");
    expect(raw).toContain("vrai contenu métier");
    expect(raw.split("## Problème").length - 1).toBe(1);
  });

  it("--kind invalide → code ≠ 0", async () => {
    await runBacklogCommand(["new", "FOO-06"], { root });
    const r = await runBacklogCommand(["brief", "FOO-06", "--kind", "chore"], { root });
    expect(r.code).not.toBe(0);
  });
});

describe("backlog CLI — new --kind (INFRA-41)", () => {
  it("new --kind bug pose kind: bug dans le frontmatter", async () => {
    const r = await runBacklogCommand(["new", "BUG-02", "--kind", "bug"], { root });
    expect(r.code).toBe(0);
    const fm = parseTicketFile(await bodyOf("BUG-02")).frontmatter;
    expect(fm.kind).toBe("bug");
  });

  it("new --kind invalide échoue sans rien créer", async () => {
    const r = await runBacklogCommand(["new", "BUG-03", "--kind", "nope"], { root });
    expect(r.code).not.toBe(0);
    await expect(bodyOf("BUG-03")).rejects.toThrow();
  });

  it("new sans --kind → frontmatter sans kind (rétro-compat)", async () => {
    await runBacklogCommand(["new", "FOO-07"], { root });
    const fm = parseTicketFile(await bodyOf("FOO-07")).frontmatter;
    expect(fm.kind).toBeUndefined();
  });
});
