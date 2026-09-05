import { describe, it, expect } from "vitest";
import {
  scaffoldSections,
  hasHeading,
  type BriefSection,
} from "@/lib/backlog/brief-sections";
import { EPIC_BRIEF_SECTIONS } from "@/lib/backlog/epic-cli";

// INFRA-41 — `scaffoldSections` généralise `scaffoldBriefSections` (INFRA-39) :
// même contrat pur/idempotent/non-destructif, mais paramétré par une liste de
// sections → partagé entre `epic brief` et `ticket brief`. Une seule impl testée.

const FEATURE: BriefSection[] = [
  { heading: "Problème", placeholder: "_(à remplir)_" },
  { heading: "Décision", placeholder: "_(à remplir)_" },
  { heading: "Portée", placeholder: "_(à remplir)_" },
  { heading: "Hors-scope", placeholder: "_(à remplir)_" },
  { heading: "Tests", placeholder: "_(à remplir)_" },
  { heading: "Vérification", placeholder: "_(à remplir)_" },
];

describe("scaffoldSections (fonction pure partagée, INFRA-41)", () => {
  const HEADINGS = FEATURE.map((s) => `## ${s.heading}`);

  it("corps vide + sections feature → les 6 headings en ordre canonique", () => {
    const out = scaffoldSections("\n# Titre\n", FEATURE);
    const positions = HEADINGS.map((h) => out.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const s of FEATURE) {
      expect(out).toContain(`## ${s.heading}\n\n${s.placeholder}`);
    }
  });

  it("idempotence : rejeu = corps identique (référentiellement égal)", () => {
    const once = scaffoldSections("\n# Titre\n", FEATURE);
    const twice = scaffoldSections(once, FEATURE);
    expect(twice).toBe(once);
    for (const h of HEADINGS) {
      expect(once.split(h).length - 1).toBe(1);
    }
  });

  it("partiel non destructif : n'ajoute que les manquantes, préserve l'existant", () => {
    const present = ["Portée", "Tests"];
    const body =
      "\n# Titre\n\n## Portée\n\nle module foo\n\n## Tests\n\n- cas A\n";
    const out = scaffoldSections(body, FEATURE);
    expect(out).toContain("le module foo");
    expect(out).toContain("- cas A");
    for (const s of FEATURE) {
      expect(out.split(`## ${s.heading}`).length - 1).toBe(1);
    }
    for (const s of FEATURE) {
      const scaffolded = !present.includes(s.heading);
      expect(out.includes(`## ${s.heading}\n\n${s.placeholder}`)).toBe(scaffolded);
    }
  });

  it("robuste au CRLF : une section présente en \\r\\n n'est pas dupliquée", () => {
    const body = "\r\n# Titre\r\n\r\n## Portée\r\n\r\nfoo\r\n";
    const out = scaffoldSections(body, FEATURE);
    expect(out.split("## Portée").length - 1).toBe(1);
  });

  it("hasHeading détecte un titre ## trimé, robuste au CRLF", () => {
    expect(hasHeading("## Tests\n", "Tests")).toBe(true);
    expect(hasHeading("## Tests\r\n", "Tests")).toBe(true);
    expect(hasHeading("### Tests\n", "Tests")).toBe(false);
    expect(hasHeading("du texte", "Tests")).toBe(false);
  });

  // Non-régression INFRA-39 : le helper généralisé, nourri des sections d'épic,
  // produit toujours les 8 sections core d'un brief d'épic (BLG-03 : +
  // « Décisions transverses », D1). L'ordre sur un corps VIDE est déjà vérifié
  // par `epic-cli.test.ts` (« corps vide → les 8 sections core en ordre
  // canonique ») ; l'insertion positionnelle sur un corps PARTIEL (le cas
  // réel de rattrapage, D2) l'est par « epic brief sur un brief legacy… »,
  // même fichier — ce test-ci ne verrouille que le compte, pour ne pas
  // dupliquer ces deux angles (finding #9 de la reprise BLG-03).
  it("non-régression epic : scaffoldSections(body, EPIC core) → les 8 sections d'épic", () => {
    const out = scaffoldSections("\n# Épic\n", EPIC_BRIEF_SECTIONS.core);
    for (const s of EPIC_BRIEF_SECTIONS.core) {
      expect(out).toContain(`## ${s.heading}\n\n${s.placeholder}`);
    }
    expect(EPIC_BRIEF_SECTIONS.core.length).toBe(8);
  });
});
