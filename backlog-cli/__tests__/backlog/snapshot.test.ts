import { describe, it, expect } from "vitest";
import {
  buildSnapshot,
  deriveTitleFromBody,
  extractScope,
  serializeSnapshot,
  type SnapshotSource,
} from "@/lib/backlog/snapshot";
import type { TicketFrontmatter } from "@/lib/backlog/ticket-frontmatter";

function src(
  id: string,
  status: TicketFrontmatter["status"],
  extra: Partial<TicketFrontmatter> = {},
  file = `specs/${id.toLowerCase()}.md`,
  body = "",
): SnapshotSource {
  return { frontmatter: { id, type: "ticket", status, ...extra }, file, body };
}

describe("snapshot", () => {
  // S1 — label FR dérivé du statut.
  it("S1 — buildSnapshot calcule le label FR", () => {
    const snap = buildSnapshot([src("X-01", "merged", {
      exec: { model: "opus", effort: "low", matured: "2026-06-08" },
    })]);
    expect(snap.tickets[0]?.label).toBe("Mergé");
    expect(snap.generatedFrom).toBe("frontmatter");
  });

  // S2 — stats par statut, statut absent = 0, toutes les clés présentes.
  it("S2 — stats compte par statut avec toutes les clés", () => {
    const snap = buildSnapshot([
      src("A-01", "todo", {
        exec: { model: "opus", effort: "low", matured: "2026-06-08" },
      }),
      src("A-02", "todo", {
        exec: { model: "opus", effort: "low", matured: "2026-06-08" },
      }),
      src("A-03", "parked"),
    ]);
    expect(snap.stats.todo).toBe(2);
    expect(snap.stats.parked).toBe(1);
    expect(snap.stats.wip).toBe(0);
    expect(snap.stats.shipped).toBe(0);
    // les 7 statuts présents
    expect(Object.keys(snap.stats).sort()).toEqual(
      ["maturing", "merged", "parked", "shipped", "todo", "wip", "wont"].sort(),
    );
  });

  // INFRA-30 — exec.review traverse la projection sans code dédié
  // (`...(t.exec ? { exec: { ...t.exec } } : {})` le copie tel quel).
  it("INFRA-30 — buildSnapshot propage exec.review", () => {
    const snap = buildSnapshot([
      src("X-01", "todo", {
        exec: { model: "sonnet", effort: "high", review: "deep", matured: "2026-07-20" },
      }),
    ]);
    expect(snap.tickets[0]?.exec?.review).toBe("deep");
  });

  // S3 — extractScope + scopes distincts.
  it("S3 — extractScope dérive le préfixe", () => {
    expect(extractScope("INFRA-08")).toBe("INFRA");
    expect(extractScope("EDHREC-01f")).toBe("EDHREC");
    expect(extractScope("SEO-HUB-CURATED")).toBe("SEO-HUB");
    const snap = buildSnapshot([
      src("INFRA-08", "parked"),
      src("INFRA-09", "parked"),
      src("OBS-01", "parked"),
    ]);
    expect(snap.scopes).toEqual(["INFRA", "OBS"]);
  });

  // S4 — sortie déterministe, indépendante de l'ordre d'entrée.
  it("S4 — snapshot trié par id, JSON stable", () => {
    const a = src("A-01", "parked");
    const b = src("B-02", "parked");
    const fromAB = serializeSnapshot(buildSnapshot([a, b]));
    const fromBA = serializeSnapshot(buildSnapshot([b, a]));
    expect(fromAB).toBe(fromBA);
    const snap = buildSnapshot([b, a]);
    expect(snap.tickets.map((t) => t.id)).toEqual(["A-01", "B-02"]);
    // terminé par un newline (diff git propre)
    expect(fromAB.endsWith("\n")).toBe(true);
  });

  // SN-DEC (INFRA-15) — buildSnapshot embarque `decision` (date + triggers
  // extraits du body) UNIQUEMENT pour parked/wont ; absent pour les autres
  // statuts (pas de `decision` parasite dans le JSON).
  it("SN-DEC — decision embarqué pour parked/wont seulement", () => {
    const parkedBody = [
      "Idée éditoriale.",
      "",
      "Décision 2026-05-10 : en attente.",
      "",
      "**À ré-évaluer si :**",
      "- Indexation > 30 %",
      "- Contributeur se propose",
    ].join("\n");
    const snap = buildSnapshot([
      src("PARK-01", "parked", {}, "specs/park-01.md", parkedBody),
      src("WONT-01", "wont", {}, "specs/wont-01.md", "Refusé.\n**Archivé le 2026-04-02 —** non."),
      src("TODO-01", "todo", {
        exec: { model: "opus", effort: "low", matured: "2026-06-08" },
      }, "specs/todo-01.md", "Décision 2026-01-01 : un corps avec une date."),
    ]);
    const byId = Object.fromEntries(snap.tickets.map((t) => [t.id, t]));

    expect(byId["PARK-01"]!.decision).toEqual({
      decidedAt: "2026-05-10",
      reviewTriggers: ["Indexation > 30 %", "Contributeur se propose"],
    });
    expect(byId["WONT-01"]!.decision).toEqual({
      decidedAt: "2026-04-02",
      reviewTriggers: [],
    });
    // todo : pas de champ decision même si le corps contient une date
    expect(byId["TODO-01"]).not.toHaveProperty("decision");
  });

  // T3 (INFRA-10 D4) — title propagé, file normalisé en slashs `/` quel que
  // soit l'OS de génération (déterminisme du backlog.json committé).
  it("T3 — title propagé et file normalisé en slash", () => {
    const snap = buildSnapshot([
      src("A-01", "shipped", { title: "Titre du board" }, "specs\\a-01.md"),
      src("B-02", "parked"),
    ]);
    expect(snap.tickets[0]).toMatchObject({
      id: "A-01",
      title: "Titre du board",
      file: "specs/a-01.md",
    });
    // pas de title → champ absent (pas de "" parasite dans le JSON)
    expect(snap.tickets[1]).not.toHaveProperty("title");
    expect(snap.tickets[1]?.file).toBe("specs/b-02.md");
  });
});

describe("deriveTitleFromBody (INFRA-16)", () => {
  // DT-1 — séparateur tiret cadratin (—)
  it("DT-1 — retire préfixe id + séparateur tiret cadratin", () => {
    expect(
      deriveTitleFromBody("# GROWTH-01 — Vue funnel signup dans /admin", "GROWTH-01"),
    ).toBe("Vue funnel signup dans /admin");
  });

  // DT-2 — séparateur trait d'union ( - )
  it("DT-2 — retire préfixe id + séparateur trait d'union", () => {
    expect(
      deriveTitleFromBody("# GROWTH-01 - Vue funnel signup dans /admin", "GROWTH-01"),
    ).toBe("Vue funnel signup dans /admin");
  });

  // DT-3 — H1 contenant uniquement l'id, pas de séparateur → undefined
  it("DT-3 — H1 sans séparateur après l'id → undefined", () => {
    expect(deriveTitleFromBody("# INFRA-16", "INFRA-16")).toBeUndefined();
  });

  // DT-4 — corps sans H1 → undefined
  it("DT-4 — corps sans aucun H1 → undefined", () => {
    expect(
      deriveTitleFromBody("## Sous-titre\nDu texte sans H1.", "X-01"),
    ).toBeUndefined();
  });

  // DT-5 — H1 ne commençant pas par l'id → retourne tout le texte après "# "
  it("DT-5 — H1 sans préfixe id → retourne tout le texte après # ", () => {
    expect(
      deriveTitleFromBody("# Un titre libre", "GROWTH-01"),
    ).toBe("Un titre libre");
  });

  // DT-6 — "## Sous-titre" avant tout "# " → ignoré (niveau 2, pas level 1)
  it("DT-6 — ## ignoré, seul # compte", () => {
    expect(
      deriveTitleFromBody("## Sous-titre\n# X-01 — Vrai titre", "X-01"),
    ).toBe("Vrai titre");
  });

  // DT-7 — corps en CRLF → pas de \r résiduel dans le titre
  it("DT-7 — CRLF : titre sans \\r résiduel", () => {
    expect(
      deriveTitleFromBody("# ID-01 — Titre\r\nAutre ligne", "ID-01"),
    ).toBe("Titre");
  });

  // DT-8 — blockquote et lignes vides avant le H1 → ignorées, H1 trouvé
  it("DT-8 — blockquote et lignes vides avant H1 → ignorées", () => {
    const body = [
      "> Une note contextuelle.",
      "",
      "Du texte libre.",
      "",
      "# GROWTH-02 — Titre après blockquote",
      "",
      "Corps du ticket.",
    ].join("\n");
    expect(deriveTitleFromBody(body, "GROWTH-02")).toBe("Titre après blockquote");
  });
});

describe("buildSnapshot — fallback titre H1 (INFRA-16)", () => {
  // BS-F1 — frontmatter title prioritaire sur le H1
  it("BS-F1 — frontmatter title gagne sur le H1", () => {
    const snap = buildSnapshot([
      src(
        "X-01",
        "shipped",
        { title: "Titre frontmatter" },
        "specs/x-01.md",
        "# X-01 — Titre H1 différent\n",
      ),
    ]);
    expect(snap.tickets[0]?.title).toBe("Titre frontmatter");
  });

  // BS-F2 — pas de frontmatter title, H1 conforme → titre dérivé présent
  it("BS-F2 — sans title frontmatter, H1 conforme → titre dérivé", () => {
    const snap = buildSnapshot([
      src(
        "GROWTH-01",
        "shipped",
        {},
        "specs/growth-01.md",
        "# GROWTH-01 — Vue funnel signup dans /admin\n",
      ),
    ]);
    expect(snap.tickets[0]?.title).toBe("Vue funnel signup dans /admin");
  });

  // BS-F3 — ni frontmatter title ni H1 exploitable → champ absent
  it("BS-F3 — ni frontmatter title ni H1 → champ title absent", () => {
    const snap = buildSnapshot([
      src(
        "Y-01",
        "parked",
        {},
        "specs/y-01.md",
        "## Sous-titre sans H1\nDu texte.",
      ),
    ]);
    expect(snap.tickets[0]).not.toHaveProperty("title");
  });
});
