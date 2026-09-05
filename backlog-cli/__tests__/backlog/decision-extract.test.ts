import { describe, it, expect } from "vitest";
import {
  extractDecidedAt,
  extractDecision,
  extractReviewTriggers,
} from "@/lib/backlog/decision-extract";

// INFRA-15 — extraction ADR pure (date + triggers de réouverture) déplacée de
// decisions-parser.ts pour tourner à la génération du snapshot (lib/backlog/),
// sans dépendance lib/backlog → lib/admin. Cas hérités d'ADMIN-08.

describe("extractDecidedAt (DE1)", () => {
  it("extrait depuis '_(obsolète, YYYY-MM-DD)_'", () => {
    expect(extractDecidedAt("_(obsolète, 2026-05-21)_\nblah")).toBe("2026-05-21");
  });
  it("extrait depuis '**Archivé le YYYY-MM-DD —**'", () => {
    expect(extractDecidedAt("Ticket.\n**Archivé le 2026-05-21 —** obsolète.")).toBe(
      "2026-05-21",
    );
  });
  it("extrait depuis 'Décision YYYY-MM-DD :'", () => {
    expect(extractDecidedAt("Décision 2026-05-10 : exclu.")).toBe("2026-05-10");
  });
  it("retourne la première date si plusieurs", () => {
    expect(extractDecidedAt("Décidé le 2026-01-01.\nMis à jour 2026-02-02.")).toBe(
      "2026-01-01",
    );
  });
  it("retourne null si aucune date", () => {
    expect(extractDecidedAt("Périmètre à définir.")).toBeNull();
  });
});

describe("extractReviewTriggers (DE2)", () => {
  it("extrait les bullets après '**À ré-évaluer si :**'", () => {
    const body = [
      "Idée.",
      "",
      "**À ré-évaluer si :**",
      "- Indexation > 30 %",
      "- Contributeur externe se propose",
      "- Pivot éditorial",
    ].join("\n");
    expect(extractReviewTriggers(body)).toEqual([
      "Indexation > 30 %",
      "Contributeur externe se propose",
      "Pivot éditorial",
    ]);
  });

  it("reconnaît 'À reconsidérer si :'", () => {
    expect(
      extractReviewTriggers("Body.\n\nÀ reconsidérer si :\n- Critère A\n- Critère B"),
    ).toEqual(["Critère A", "Critère B"]);
  });

  it("reconnaît 'Re-trigger :'", () => {
    expect(extractReviewTriggers("Body.\n\nRe-trigger :\n- Trig 1")).toEqual([
      "Trig 1",
    ]);
  });

  it("s'arrête au premier non-bullet après le bloc", () => {
    const body = [
      "Body.",
      "",
      "**À ré-évaluer si :**",
      "- Bullet 1",
      "- Bullet 2",
      "",
      "Texte de prose après.",
    ].join("\n");
    expect(extractReviewTriggers(body)).toEqual(["Bullet 1", "Bullet 2"]);
  });

  it("retourne [] si pas de bloc trigger", () => {
    expect(extractReviewTriggers("Périmètre à définir.")).toEqual([]);
  });

  // INFRA-21 — robustesse CRLF : un corps lu en CRLF (working tree Windows) doit
  // donner exactement les mêmes triggers qu'en LF. Sans `split(/\r?\n/)`, le `\r`
  // final fait échouer BULLET_RE (`.`/`$` n'absorbent pas `\r`) → [] sous Windows,
  // ce qui désync backlog.json et casse H3 sur le CI Linux.
  it("est CRLF-invariant (corps Windows)", () => {
    const lf = [
      "Idée.",
      "",
      "**À ré-évaluer si :**",
      "- Indexation > 30 %",
      "- Contributeur externe se propose",
      "- Pivot éditorial",
    ].join("\n");
    const crlf = lf.replace(/\n/g, "\r\n");
    const expected = [
      "Indexation > 30 %",
      "Contributeur externe se propose",
      "Pivot éditorial",
    ];
    expect(extractReviewTriggers(crlf)).toEqual(expected);
    expect(extractReviewTriggers(crlf)).toEqual(extractReviewTriggers(lf));
  });
});

describe("extractDecision (DE3)", () => {
  it("combine date + triggers", () => {
    const body = "Décision 2026-05-10 : exclu.\n\nRe-trigger :\n- Besoin remonte";
    expect(extractDecision(body)).toEqual({
      decidedAt: "2026-05-10",
      reviewTriggers: ["Besoin remonte"],
    });
  });
  it("corps sans rien → null + []", () => {
    expect(extractDecision("Juste une idée.")).toEqual({
      decidedAt: null,
      reviewTriggers: [],
    });
  });
});
