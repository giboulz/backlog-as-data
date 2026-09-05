import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBacklogCommand } from "@/lib/backlog/cli";
import { parseEpicFile } from "@/lib/backlog/epic-frontmatter";
import {
  scaffoldBriefSections,
  EPIC_BRIEF_SECTIONS,
  missingCoreSections,
  isBriefManaged,
} from "@/lib/backlog/epic-cli";
import { scaffoldSections } from "@/lib/backlog/brief-sections";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "epic-cli-"));
  await mkdir(path.join(root, "specs"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const epicFm = async (id: string) =>
  parseEpicFile(await readFile(path.join(root, "specs", "epics", `${id}.md`), "utf8")).frontmatter;
const epicsJson = async () =>
  JSON.parse(await readFile(path.join(root, "epics.json"), "utf8"));

describe("backlog CLI — sous-commandes épic (INFRA-12)", () => {
  it("epic new crée un épic possibilité + régénère epics.json", async () => {
    const r = await runBacklogCommand(
      ["epic", "new", "PACKAGE", "--kind", "chain", "--title", "Card Packages"],
      { root },
    );
    expect(r.code).toBe(0);
    expect(await epicFm("package")).toMatchObject({
      id: "PACKAGE",
      type: "epic",
      phase: "possibilité",
      started: false,
      abandoned: false,
    });
    const snap = await epicsJson();
    expect(snap.epics.find((e: { id: string }) => e.id === "PACKAGE")).toBeTruthy();
  });

  it("epic start bascule started:true", async () => {
    await runBacklogCommand(["epic", "new", "COMBO", "--title", "Combo"], { root });
    const r = await runBacklogCommand(["epic", "start", "COMBO"], { root });
    expect(r.code).toBe(0);
    expect((await epicFm("combo")).started).toBe(true);
  });

  it("epic abandon bascule abandoned:true + started:false", async () => {
    await runBacklogCommand(["epic", "new", "EDIT", "--title", "Edit"], { root });
    await runBacklogCommand(["epic", "start", "EDIT"], { root });
    const r = await runBacklogCommand(["epic", "abandon", "EDIT"], { root });
    expect(r.code).toBe(0);
    const fm = await epicFm("edit");
    expect(fm.abandoned).toBe(true);
    expect(fm.started).toBe(false);
  });

  it("epic set phase=à-venir mute la phase", async () => {
    await runBacklogCommand(["epic", "new", "SOCIAL", "--title", "Social"], { root });
    const r = await runBacklogCommand(["epic", "set", "SOCIAL", "phase=à-venir"], { root });
    expect(r.code).toBe(0);
    expect((await epicFm("social")).phase).toBe("à-venir");
  });

  it("epic set rejette une phase hors enum et un champ non mutable", async () => {
    await runBacklogCommand(["epic", "new", "MOBILE", "--title", "Mobile"], { root });
    expect((await runBacklogCommand(["epic", "set", "MOBILE", "phase=jamais"], { root })).code).not.toBe(0);
    expect((await runBacklogCommand(["epic", "set", "MOBILE", "started=true"], { root })).code).not.toBe(0);
  });

  it("epic new sur id existant échoue", async () => {
    await runBacklogCommand(["epic", "new", "COMBO", "--title", "Combo"], { root });
    const r = await runBacklogCommand(["epic", "new", "COMBO", "--title", "Autre"], { root });
    expect(r.code).not.toBe(0);
  });

  it("epic new ne clobbe pas un fichier du même slug (collision de casse)", async () => {
    await runBacklogCommand(["epic", "new", "combo", "--title", "Premier"], { root });
    // id distinct (COMBO !== combo) mais même fichier combo.md → doit refuser.
    const r = await runBacklogCommand(["epic", "new", "COMBO", "--title", "Écrase"], { root });
    expect(r.code).not.toBe(0);
    expect((await epicFm("combo")).title).toBe("Premier");
  });

  it("epic set order rejette une valeur non-entière (vide, hex, exposant)", async () => {
    await runBacklogCommand(["epic", "new", "PRICING", "--title", "Pricing"], { root });
    for (const bad of ["", "0x10", "1e3", "abc", "1.5"]) {
      expect((await runBacklogCommand(["epic", "set", "PRICING", `order=${bad}`], { root })).code).not.toBe(0);
    }
    // une valeur entière passe
    expect((await runBacklogCommand(["epic", "set", "PRICING", "order=42"], { root })).code).toBe(0);
    expect((await epicFm("pricing")).order).toBe(42);
  });

  it("epic new --number pose l'ordinal d'une phase ; --number non-entier refusé", async () => {
    expect(
      (await runBacklogCommand(["epic", "new", "PHASE-4", "--kind", "phase", "--number", "x"], { root })).code,
    ).not.toBe(0);
    const r = await runBacklogCommand(
      ["epic", "new", "PHASE-4", "--kind", "phase", "--title", "P4", "--number", "4"],
      { root },
    );
    expect(r.code).toBe(0);
    expect((await epicFm("phase-4")).number).toBe(4);
  });

  it("epic set number mute l'ordinal (entier validé comme order)", async () => {
    await runBacklogCommand(["epic", "new", "PHASE-5", "--kind", "phase", "--title", "P5"], { root });
    expect((await runBacklogCommand(["epic", "set", "PHASE-5", "number=1.5"], { root })).code).not.toBe(0);
    expect((await runBacklogCommand(["epic", "set", "PHASE-5", "number=5"], { root })).code).toBe(0);
    expect((await epicFm("phase-5")).number).toBe(5);
  });

  it("epic sous-commande inconnue → code 2", async () => {
    const r = await runBacklogCommand(["epic", "frobnicate"], { root });
    expect(r.code).toBe(2);
  });

  it("epic-snapshot régénère epics.json depuis specs/epics/", async () => {
    await runBacklogCommand(["epic", "new", "PRINTOPT", "--title", "Printing"], { root });
    const r = await runBacklogCommand(["epic", "epic-snapshot"], { root });
    expect(r.code).toBe(0);
    expect((await epicsJson()).epics.length).toBe(1);
  });

  // P19/P20 (INFRA-33) — les sous-commandes épic héritent du parsing déclaratif :
  // plus de titre "true" en silence, et un titre commençant par `--` est un titre.
  it("P19 — epic new --title sans valeur échoue sans rien créer", async () => {
    const r = await runBacklogCommand(["epic", "new", "E1", "--title"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--title attend une valeur");
    await expect(
      readFile(path.join(root, "specs", "epics", "e1.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("P20 — epic new --title « --phase … » pose le vrai titre", async () => {
    const title = "--phase 2 du store";
    const r = await runBacklogCommand(
      ["epic", "new", "E1", "--kind", "chain", "--title", title],
      { root },
    );
    expect(r.code).toBe(0);
    expect((await epicFm("e1")).title).toBe(title);
  });
});

// INFRA-39 — verbe `epic brief` : squelette de sections déterministe.
describe("scaffoldBriefSections (fonction pure)", () => {
  const CORE = EPIC_BRIEF_SECTIONS.core.map((s) => `## ${s.heading}`);

  it("corps vide → les 8 sections core apparaissent en ordre canonique", () => {
    const out = scaffoldBriefSections("\n# Titre\n");
    const positions = CORE.map((h) => out.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const s of EPIC_BRIEF_SECTIONS.core) {
      expect(out).toContain(`## ${s.heading}\n\n${s.placeholder}`);
    }
  });

  it("idempotence : re-scaffolder ne duplique aucun titre core", () => {
    const once = scaffoldBriefSections("\n# Titre\n");
    const twice = scaffoldBriefSections(once);
    expect(twice).toBe(once);
    for (const h of CORE) {
      expect(once.split(h).length - 1).toBe(1);
    }
  });

  it("scaffolding partiel : n'ajoute que les sections manquantes, préserve l'existant", () => {
    const present = ["Hors-scope", "Découpage"];
    const body = "\n# Titre\n\n## Hors-scope\n\nmobile hors scope\n\n## Découpage\n\n- FOO-01\n";
    const out = scaffoldBriefSections(body);
    // Les deux présentes gardent leur contenu, sans doublon.
    expect(out).toContain("mobile hors scope");
    expect(out).toContain("- FOO-01");
    // Chaque section core (présente ou ajoutée) apparaît exactement une fois —
    // verrouille le compte exact « 6 ajoutées » (8 core - 2 présentes) plutôt
    // qu'un simple toContain.
    for (const s of EPIC_BRIEF_SECTIONS.core) {
      expect(out.split(`## ${s.heading}`).length - 1).toBe(1);
    }
    // Les 6 manquantes ont bien reçu leur placeholder ; les 2 présentes non.
    for (const s of EPIC_BRIEF_SECTIONS.core) {
      const scaffolded = !present.includes(s.heading);
      expect(out.includes(`## ${s.heading}\n\n${s.placeholder}`)).toBe(scaffolded);
    }
  });

  it("robuste au CRLF : une section présente en \\r\\n n'est pas dupliquée", () => {
    const body = "\r\n# Titre\r\n\r\n## Hors-scope\r\n\r\nmobile\r\n";
    const out = scaffoldBriefSections(body);
    expect(out.split("## Hors-scope").length - 1).toBe(1);
  });

  it("prose libre entre # Titre et le 1er ## est conservée", () => {
    const out = scaffoldBriefSections("\n# Titre\n\nintro libre du sujet\n");
    expect(out).toContain("intro libre du sujet");
  });

  it("les sections optionnelles ne sont jamais auto-ajoutées", () => {
    const out = scaffoldBriefSections("\n# Titre\n");
    expect(out).not.toContain("## Gate");
    expect(out).not.toContain("## Rattachements");
  });
});

// INFRA-40 — helpers purs de complétude/marqueur consommés par le test de cohérence.
describe("missingCoreSections / isBriefManaged (fonctions pures, INFRA-40)", () => {
  const CORE_HEADINGS = EPIC_BRIEF_SECTIONS.core.map((s) => s.heading);

  it("missingCoreSections — corps vide → les 8 headings core en ordre canonique", () => {
    expect(missingCoreSections("")).toEqual(CORE_HEADINGS);
  });

  it("missingCoreSections — brief complet scaffoldé → []", () => {
    expect(missingCoreSections(scaffoldBriefSections("\n# T\n"))).toEqual([]);
  });

  it("missingCoreSections — brief amputé de ## Challenge → [\"Challenge\"]", () => {
    const complete = scaffoldBriefSections("\n# T\n");
    // Retire le bloc ## Challenge (dernière section scaffoldée) jusqu'à la fin.
    const amputated = complete.replace(/## Challenge[\s\S]*$/, "");
    expect(missingCoreSections(amputated)).toEqual(["Challenge"]);
  });

  // BLG-03 (§ Tests de la spec, et finding #6 de la reprise) — un épic
  // brief-managé SCAFFOLDÉ AVANT ce ticket (les 7 anciennes sections core,
  // ## Challenge inclus, mais sans « Décisions transverses ») est le cas réel
  // de rattrapage que D2 désigne (`prompt-hors-skill`, claude-config). Fixture
  // construite en scaffoldant les 8 sections MOINS la neuve, pour ne pas
  // dupliquer à la main un texte de heading — le point testé est
  // `missingCoreSections`, pas la fixture.
  const LEGACY_SEVEN = EPIC_BRIEF_SECTIONS.core.filter(
    (s) => s.heading !== "Décisions transverses",
  );
  const legacyBriefBody = () => scaffoldSections("\n# T\n", LEGACY_SEVEN);

  it("missingCoreSections — brief legacy (7 sections, sans la section neuve) → [\"Décisions transverses\"]", () => {
    expect(missingCoreSections(legacyBriefBody())).toEqual(["Décisions transverses"]);
  });

  // BLG-03 (finding #5 de la reprise) — le remède prescrit par D2 est
  // `epic brief` : rejoué sur ce corps legacy, la section neuve doit
  // atterrir à sa place canonique (D1 : entre « Contraintes & risques archi »
  // et « Hors-scope »), pas après ## Challenge (dernière section, en queue).
  it("epic brief sur un brief legacy insère Décisions transverses à sa place canonique, pas en queue", () => {
    const out = scaffoldBriefSections(legacyBriefBody());
    const idx = (heading: string) => out.indexOf(`## ${heading}`);
    expect(idx("Décisions transverses")).toBeGreaterThan(idx("Contraintes & risques archi"));
    expect(idx("Décisions transverses")).toBeLessThan(idx("Hors-scope"));
    expect(idx("Décisions transverses")).toBeLessThan(idx("Challenge"));
    expect(missingCoreSections(out)).toEqual([]);
  });

  it("isBriefManaged — vrai ssi ## Challenge présent", () => {
    expect(isBriefManaged(scaffoldBriefSections("\n# T\n"))).toBe(true);
    // Headings core partiels mais pas Challenge → legacy, exempté.
    expect(isBriefManaged("\n# T\n\n## Hors-scope\n")).toBe(false);
  });
});

describe("backlog CLI — epic brief (INFRA-39)", () => {
  const epicBody = async (id: string) =>
    readFile(path.join(root, "specs", "epics", `${id}.md`), "utf8");

  it("epic brief scaffolde les 8 titres core + régénère epics.json", async () => {
    await runBacklogCommand(["epic", "new", "CART", "--title", "Cart"], { root });
    const r = await runBacklogCommand(["epic", "brief", "CART"], { root });
    expect(r.code).toBe(0);
    const raw = await epicBody("cart");
    for (const s of EPIC_BRIEF_SECTIONS.core) {
      expect(raw).toContain(`## ${s.heading}`);
    }
    expect((await epicsJson()).epics.find((e: { id: string }) => e.id === "CART")).toBeTruthy();
  });

  it("epic brief sur un id inconnu échoue", async () => {
    const r = await runBacklogCommand(["epic", "brief", "NOPE"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("introuvable");
  });

  it("idempotence CLI : deux epic brief ne dupliquent aucune section", async () => {
    await runBacklogCommand(["epic", "new", "COMBO", "--title", "Combo"], { root });
    await runBacklogCommand(["epic", "brief", "COMBO"], { root });
    await runBacklogCommand(["epic", "brief", "COMBO"], { root });
    const raw = await epicBody("combo");
    for (const s of EPIC_BRIEF_SECTIONS.core) {
      expect(raw.split(`## ${s.heading}`).length - 1).toBe(1);
    }
  });
});
