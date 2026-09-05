import { describe, it, expect } from "vitest";
import {
  checkTripletCoherence,
  EXEC_EFFORT_MODEL_FLOOR,
  EXEC_EFFORTS,
  extractTicketIds,
  ticketIdFromSpecFilename,
  nextFreeTicketId,
  extractScopedTicketIds,
  parseTicketFile,
  serializeTicketFile,
  validateTicket,
  type TicketFrontmatter,
} from "@/lib/backlog/ticket-frontmatter";

const VALID_RAW = `---
id: INFRA-08
type: ticket
status: todo
priority: should
epic: backlog-as-data
exec:
  model: opus
  effort: high
  matured: 2026-06-08
---

# INFRA-08 — Titre

Corps de la spec.
`;

describe("ticket-frontmatter", () => {
  // F1 — parse sépare frontmatter et corps, champs typés corrects.
  it("F1 — parseTicketFile lit un ticket todo+exec valide", () => {
    const { frontmatter, body } = parseTicketFile(VALID_RAW);
    expect(frontmatter).toEqual({
      id: "INFRA-08",
      type: "ticket",
      status: "todo",
      priority: "should",
      epic: "backlog-as-data",
      exec: { model: "opus", effort: "high", matured: "2026-06-08" },
    });
    expect(body).toContain("# INFRA-08 — Titre");
    expect(body).toContain("Corps de la spec.");
  });

  // F2 — round-trip parse→serialize→parse stable et idempotent.
  it("F2 — serializeTicketFile est l'inverse de parseTicketFile (idempotent)", () => {
    const fm: TicketFrontmatter = {
      id: "OBS-01",
      type: "ticket",
      status: "wip",
      epic: "scryfall-resilience",
      exec: { model: "sonnet", effort: "low", matured: "2026-06-04" },
    };
    const body = "\n# OBS-01\n\nbla bla\n";
    const out = serializeTicketFile(fm, body);
    const reparsed = parseTicketFile(out);
    expect(reparsed.frontmatter).toEqual(fm);
    expect(reparsed.body).toBe(body);
    // idempotence byte-à-byte
    expect(serializeTicketFile(reparsed.frontmatter, reparsed.body)).toBe(out);
  });

  // F3 — id hors regex rejeté.
  it("F3 — validateTicket rejette un id mal formé", () => {
    for (const id of ["infra-08", "INFRA08", "8", "infra08"]) {
      const res = validateTicket({ id, type: "ticket", status: "parked" });
      expect(res.ok, `attendu invalide pour id=${id}`).toBe(false);
    }
    const ok = validateTicket({ id: "INFRA-08", type: "ticket", status: "parked" });
    expect(ok.ok).toBe(true);
  });

  // F4 — invariant exec présent ssi status ∈ {todo,wip,merged,shipped}.
  it("F4 — invariant exec ⇄ status", () => {
    // todo sans exec → invalide
    expect(
      validateTicket({ id: "X-01", type: "ticket", status: "todo" }).ok,
    ).toBe(false);
    // maturing AVEC exec → invalide
    expect(
      validateTicket({
        id: "X-01",
        type: "ticket",
        status: "maturing",
        exec: { model: "opus", effort: "none", matured: "2026-06-08" },
      }).ok,
    ).toBe(false);
    // maturing sans exec → valide
    expect(
      validateTicket({ id: "X-01", type: "ticket", status: "maturing" }).ok,
    ).toBe(true);
    // shipped avec exec → valide
    expect(
      validateTicket({
        id: "X-01",
        type: "ticket",
        status: "shipped",
        exec: { model: "haiku", effort: "think", matured: "2026-06-08" },
      }).ok,
    ).toBe(true);
  });

  // F5 — enums hors domaine, message citant le champ.
  it("F5 — enums hors domaine rejetés avec champ cité", () => {
    const badStatus = validateTicket({ id: "X-01", type: "ticket", status: "nope" });
    expect(badStatus.ok).toBe(false);
    if (!badStatus.ok) expect(badStatus.errors.join(" ")).toMatch(/status/);

    const badPriority = validateTicket({
      id: "X-01",
      type: "ticket",
      status: "parked",
      priority: "high",
    });
    expect(badPriority.ok).toBe(false);
    if (!badPriority.ok) expect(badPriority.errors.join(" ")).toMatch(/priority/);

    const badModel = validateTicket({
      id: "X-01",
      type: "ticket",
      status: "todo",
      exec: { model: "gpt", effort: "none", matured: "2026-06-08" },
    });
    expect(badModel.ok).toBe(false);
    if (!badModel.ok) expect(badModel.errors.join(" ")).toMatch(/model/);
  });

  // F6 — matured mal formé.
  it("F6 — matured doit être YYYY-MM-DD", () => {
    for (const matured of ["2026-6-8", "08-06-2026", "2026/06/08", "hier"]) {
      const res = validateTicket({
        id: "X-01",
        type: "ticket",
        status: "todo",
        exec: { model: "opus", effort: "none", matured },
      });
      expect(res.ok, `attendu invalide pour matured=${matured}`).toBe(false);
    }
  });

  // F7 — un id multi-segments (SEO-HUB-CURATED) est valide (grammaire partagée).
  it("F7 — validateTicket accepte un id multi-segments", () => {
    expect(
      validateTicket({ id: "SEO-HUB-CURATED", type: "ticket", status: "parked" }).ok,
    ).toBe(true);
  });

  // F11 — fable ∈ EXEC_MODELS (extension 2026-06-10 ; premier usage : INFRA-10,
  // migration irréversible). `fable` n'est classé dans aucune échelle (BLG-09) ;
  // `mature` le refuse désormais au-dessus du plancher opus (BLG-06 D3), mais la
  // LECTURE reste tolérante — c'est ce que cette assertion vérifie, sur le couple
  // exact que porte infra-10.md sur disque. Lecture tolérante vs écriture
  // contrôlée : les deux comportements coexistent sans contradiction.
  it("F11 — fable est un model exec valide", () => {
    const res = validateTicket({
      id: "X-01",
      type: "ticket",
      status: "todo",
      exec: { model: "fable", effort: "ultrathink", matured: "2026-06-10" },
    });
    expect(res.ok).toBe(true);
  });

  // T1 (INFRA-10 D4) — title optionnel : round-trip, y compris valeur contenant
  // un `:` et valeur entièrement quotée (le strip des quotes ne doit pas la manger).
  it("T1 — title round-trip parse/serialize", () => {
    const plain: TicketFrontmatter = {
      id: "X-01",
      type: "ticket",
      status: "maturing",
      title: "Bascule `defaultLocale: \"en\"` + URLs root EN",
    };
    const out = serializeTicketFile(plain, "\ncorps\n");
    const re = parseTicketFile(out);
    expect(re.frontmatter.title).toBe(plain.title);
    // idempotence byte-à-byte
    expect(serializeTicketFile(re.frontmatter, re.body)).toBe(out);

    const quoted: TicketFrontmatter = {
      id: "X-02",
      type: "ticket",
      status: "parked",
      title: '"Tu possèdes X% de ce deck"',
    };
    const out2 = serializeTicketFile(quoted, "");
    expect(parseTicketFile(out2).frontmatter.title).toBe(quoted.title);
  });

  // T1b — un title non round-trippable est REJETÉ à la validation (pas muté en
  // silence) : multi-ligne (clé injectée au re-parse) ou espaces de tête/queue
  // (trim du parser → mismatch H3). Revue /code-review high.
  it("T1b — title multi-ligne ou non-trimé rejeté", () => {
    for (const title of ["Bug\nstatus: wont", "Trailing ", " Leading", "a\r\nb"]) {
      const res = validateTicket({ id: "X-01", type: "ticket", status: "parked", title });
      expect(res.ok, `attendu invalide pour title=${JSON.stringify(title)}`).toBe(false);
    }
  });

  // INFRA-30 — parse + validation d'un exec.review présent.
  it("INFRA-30 — parse un frontmatter avec exec.review: deep", () => {
    const raw = `---
id: X-01
type: ticket
status: todo
exec:
  model: sonnet
  effort: think-hard
  review: deep
  matured: 2026-07-20
---

# X-01
`;
    const { frontmatter } = parseTicketFile(raw);
    // effort legacy `think-hard` du .md est NORMALISÉ en `high` à la lecture.
    expect(frontmatter.exec).toEqual({
      model: "sonnet",
      effort: "high",
      review: "deep",
      matured: "2026-07-20",
    });
  });

  // INFRA-30 — non-régression du strip silencieux : avant le correctif, Zod
  // (execSchema sans review déclaré) jetait la clé et serializeTicketFile ne la
  // réémettait pas. Ce test échoue sur le code d'avant ce ticket.
  it("INFRA-30 — serializeTicketFile conserve exec.review (ne le strippe plus)", () => {
    const fm: TicketFrontmatter = {
      id: "X-01",
      type: "ticket",
      status: "todo",
      exec: { model: "sonnet", effort: "high", review: "deep", matured: "2026-07-20" },
    };
    const out = serializeTicketFile(fm, "\n# X-01\n");
    expect(out).toContain("  review: deep");
    const reparsed = parseTicketFile(out);
    expect(reparsed.frontmatter.exec?.review).toBe("deep");
  });

  // INFRA-30 — valeur hors enum rejetée, message portant exec.review.
  it("INFRA-30 — exec.review hors enum rejeté", () => {
    const res = validateTicket({
      id: "X-01",
      type: "ticket",
      status: "todo",
      exec: { model: "sonnet", effort: "high", review: "medium", matured: "2026-07-20" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/exec\.review/);
  });

  // INFRA-30 — absence tolérée : exec sans review reste valide, se re-sérialise
  // sans ligne review (pas de défaut inventé dans la donnée).
  it("INFRA-30 — exec sans review reste valide et se sérialise sans la ligne", () => {
    const fm: TicketFrontmatter = {
      id: "X-01",
      type: "ticket",
      status: "todo",
      exec: { model: "sonnet", effort: "high", matured: "2026-07-20" },
    };
    const res = validateTicket(fm);
    expect(res.ok).toBe(true);
    const out = serializeTicketFile(fm, "\n# X-01\n");
    expect(out).not.toContain("review:");
  });

  // INFRA-30 — ordre de sérialisation model → effort → review → matured.
  it("INFRA-30 — ordre de sérialisation model/effort/review/matured", () => {
    const fm: TicketFrontmatter = {
      id: "X-01",
      type: "ticket",
      status: "todo",
      exec: { model: "sonnet", effort: "high", review: "light", matured: "2026-07-20" },
    };
    const out = serializeTicketFile(fm, "\n# X-01\n");
    const execLines = out
      .split("\n")
      .filter((l) => /^  (model|effort|review|matured): /.test(l))
      .map((l) => l.trim().split(":")[0]);
    expect(execLines).toEqual(["model", "effort", "review", "matured"]);
  });

  // INFRA-30 (H3) — round-trip parse(serialize(fm)) === fm, avec et sans review,
  // en entrée CRLF et LF (le parseur splitte en /\r?\n/, cf. INFRA-21).
  it("INFRA-30 — round-trip CRLF/LF avec et sans review", () => {
    const withReview: TicketFrontmatter = {
      id: "X-01",
      type: "ticket",
      status: "todo",
      exec: { model: "sonnet", effort: "high", review: "deep", matured: "2026-07-20" },
    };
    const withoutReview: TicketFrontmatter = {
      id: "X-02",
      type: "ticket",
      status: "todo",
      exec: { model: "sonnet", effort: "high", matured: "2026-07-20" },
    };
    for (const fm of [withReview, withoutReview]) {
      const lf = serializeTicketFile(fm, "\n# corps\n");
      expect(parseTicketFile(lf).frontmatter).toEqual(fm);

      const crlf = lf.replace(/\n/g, "\r\n");
      expect(parseTicketFile(crlf).frontmatter).toEqual(fm);
    }
  });

  // INFRA-41 — kind: bug|feature, optionnel (absent = feature, rétro-compat des
  // 758 tickets sans kind). Notion de bug first-class, persistante et queryable.
  it("K1 — kind accepte bug/feature, rejette autre chose, absent = valide", () => {
    expect(
      validateTicket({ id: "X-01", type: "ticket", status: "parked", kind: "bug" }).ok,
    ).toBe(true);
    expect(
      validateTicket({ id: "X-01", type: "ticket", status: "parked", kind: "feature" }).ok,
    ).toBe(true);
    const bad = validateTicket({ id: "X-01", type: "ticket", status: "parked", kind: "chore" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/kind/);
    // absent → valide (rétro-compat)
    expect(validateTicket({ id: "X-01", type: "ticket", status: "parked" }).ok).toBe(true);
  });

  it("K2 — kind round-trip serialize → parse", () => {
    const fm: TicketFrontmatter = {
      id: "X-01",
      type: "ticket",
      status: "maturing",
      kind: "bug",
    };
    const out = serializeTicketFile(fm, "\n# X\n");
    expect(out).toContain("kind: bug");
    const reparsed = parseTicketFile(out);
    expect(reparsed.frontmatter.kind).toBe("bug");
    // idempotence byte-à-byte
    expect(serializeTicketFile(reparsed.frontmatter, reparsed.body)).toBe(out);
  });

  // T2 (INFRA-10 D1) — invariant relâché : exec requis pour todo/wip/merged,
  // OPTIONNEL pour shipped (365 livrés historiques sans maturation tracée),
  // interdit pour parked/maturing/wont.
  it("T2 — exec optionnel pour shipped, requis todo/wip/merged, interdit sinon", () => {
    const exec = { model: "opus", effort: "low", matured: "2026-06-08" } as const;
    // shipped sans exec → VALIDE (relâchement)
    expect(
      validateTicket({ id: "X-01", type: "ticket", status: "shipped" }).ok,
    ).toBe(true);
    // shipped avec exec → valide (cycle INFRA-11)
    expect(
      validateTicket({ id: "X-01", type: "ticket", status: "shipped", exec }).ok,
    ).toBe(true);
    // todo/wip/merged sans exec → invalides
    for (const status of ["todo", "wip", "merged"]) {
      expect(
        validateTicket({ id: "X-01", type: "ticket", status }).ok,
        `attendu invalide pour ${status} sans exec`,
      ).toBe(false);
    }
    // parked/maturing/wont avec exec → invalides
    for (const status of ["parked", "maturing", "wont"]) {
      expect(
        validateTicket({ id: "X-01", type: "ticket", status, exec }).ok,
        `attendu invalide pour ${status} avec exec`,
      ).toBe(false);
    }
  });
});

// EFFORT-COMPAT — bascule vers la nomenclature d'effort OFFICIELLE
// (low|medium|high|xhigh|max) + retrait de haiku, SANS casser les tickets
// existants de tous les projets. Cœur : normaliser À LA LECTURE, ne jamais
// réécrire les .md ; haiku toléré en lecture mais refusé à un nouveau `mature`.
describe("nomenclature d'effort officielle + compat legacy (EFFORT-COMPAT)", () => {
  const base = { id: "X-01", type: "ticket", status: "todo" } as const;
  const withExec = (effort: string, model = "sonnet") => ({
    ...base,
    exec: { model, effort, matured: "2026-08-02" },
  });

  // E1 — les 5 valeurs officielles sont acceptées et conservées telles quelles.
  it("E1 — officiel accepté et conservé (low/medium/high/xhigh/max)", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      const res = validateTicket(withExec(effort));
      expect(res.ok, `attendu valide pour effort=${effort}`).toBe(true);
      if (res.ok) expect(res.value.exec?.effort).toBe(effort);
    }
  });

  // E2 — `xhigh` est un palier officiel NEUF (aucun antécédent legacy) : accepté
  // comme les autres, jamais réécrit par une normalisation.
  it("E2 — xhigh (officiel neuf, pas d'alias legacy) accepté tel quel", () => {
    const res = validateTicket(withExec("xhigh"));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.exec?.effort).toBe("xhigh");
  });

  // E3 — CRUX rétro-compat : chaque valeur legacy est ACCEPTÉE et NORMALISÉE vers
  // l'officiel à la lecture (via validateTicket). backlog.json ne verra donc que
  // de l'officiel, même si le .md dit encore `think-hard`.
  it("E3 — legacy accepté ET normalisé à la lecture (validateTicket)", () => {
    const pairs: Array<[string, string]> = [
      ["none", "low"],
      ["think", "medium"],
      ["think-hard", "high"],
      ["ultrathink", "max"],
    ];
    for (const [legacy, official] of pairs) {
      const res = validateTicket(withExec(legacy));
      expect(res.ok, `attendu valide pour effort legacy=${legacy}`).toBe(true);
      if (res.ok) expect(res.value.exec?.effort).toBe(official);
    }
  });

  // E4 — même normalisation par le chemin de parsing d'un .md historique.
  it("E4 — legacy dans un .md est normalisé par parseTicketFile", () => {
    const raw = `---
id: OLD-01
type: ticket
status: todo
exec:
  model: opus
  effort: think-hard
  matured: 2026-05-01
---

# OLD-01
`;
    const { frontmatter } = parseTicketFile(raw);
    expect(frontmatter.exec?.effort).toBe("high");
  });

  // E5 — une valeur d'effort inconnue (ni officielle ni legacy) est REJETÉE, avec
  // un message citant le champ.
  it("E5 — effort inconnu rejeté, message citant le champ", () => {
    for (const bad of ["think-harder", "gigathink", "hi", ""]) {
      const res = validateTicket(withExec(bad));
      expect(res.ok, `attendu invalide pour effort=${JSON.stringify(bad)}`).toBe(false);
      if (!res.ok) expect(res.errors.join(" ")).toMatch(/effort/);
    }
  });

  // E6 — model haiku RETIRÉ mais TOLÉRÉ à la lecture : un ticket historique
  // `model: haiku` reste valide et n'est pas réécrit (via validateTicket + parse).
  it("E6 — model haiku historique toléré à la lecture", () => {
    const res = validateTicket(withExec("high", "haiku"));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.exec?.model).toBe("haiku");

    const raw = `---
id: OLD-02
type: ticket
status: shipped
exec:
  model: haiku
  effort: think
  matured: 2026-03-01
---

# OLD-02
`;
    const { frontmatter } = parseTicketFile(raw);
    expect(frontmatter.exec?.model).toBe("haiku");
    // et l'effort legacy du même ticket est bien normalisé
    expect(frontmatter.exec?.effort).toBe("medium");
  });

  // E7 — un model franchement inconnu (jamais dans la nomenclature) reste rejeté.
  it("E7 — model inconnu rejeté", () => {
    const res = validateTicket(withExec("high", "gpt"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/model/);
  });

  // E8 — round-trip de MUTATION : une valeur normalisée qui repart en
  // serializeTicketFile s'écrit en OFFICIEL (donc toute mutation d'un vieux
  // ticket réécrit l'officiel dans le .md ; un simple snapshot, lui, ne réécrit
  // jamais le .md — cf. les tests round-trip côté CLI).
  it("E8 — serialize après lecture écrit l'officiel (mutation ⇒ .md officiel)", () => {
    const legacyRaw = `---
id: OLD-03
type: ticket
status: todo
exec:
  model: opus
  effort: ultrathink
  matured: 2026-05-01
---

# OLD-03
`;
    const { frontmatter, body } = parseTicketFile(legacyRaw);
    const out = serializeTicketFile(frontmatter, body);
    expect(out).toContain("effort: max");
    expect(out).not.toContain("ultrathink");
    // idempotent : re-lu, re-sérialisé, identique.
    const re = parseTicketFile(out);
    expect(serializeTicketFile(re.frontmatter, re.body)).toBe(out);
  });
});

describe("extractTicketIds", () => {
  // F8 — capture l'id COMPLET, segments multiples inclus (régression INFRA-11 :
  // l'ancien matcher tronquait SEO-HUB-CURATED en SEO-HUB → merge ratait le ticket).
  it("F8 — capture les ids multi-segments en entier", () => {
    expect(extractTicketIds("feat(SEO-HUB-CURATED): pipeline")).toEqual([
      "SEO-HUB-CURATED",
    ]);
    expect(extractTicketIds("docs(ANALYTICS-02-PLAYABILITY): note")).toEqual([
      "ANALYTICS-02-PLAYABILITY",
    ]);
  });

  // F9 — ids simples dans un sujet de commit, suffixe minuscule, déduplication.
  it("F9 — ids simples, suffixe minuscule, dédup, ordre d'apparition", () => {
    expect(extractTicketIds("feat(INFRA-11): cycle\n\nrelié à EDHREC-01f")).toEqual([
      "INFRA-11",
      "EDHREC-01f",
    ]);
    // déduplication : un même id mentionné deux fois → une seule entrée
    expect(extractTicketIds("INFRA-11 puis INFRA-11 encore")).toEqual(["INFRA-11"]);
  });

  // F10 — pas de faux positif sur des mots non-id (minuscule, scope seul).
  it("F10 — n'extrait pas les non-ids", () => {
    expect(extractTicketIds("well-known Spec-Driven dans le repo INFRA tout seul")).toEqual([]);
  });
});

// INFRA-18 — scope conventionnel des commits d'implémentation. Sert au hook
// `merge` : un ticket n'est `merged` que si un commit `type(<id>): …` est sur la
// branche, PAS un simple `chore(backlog): start <id>` ni une mention en corps.
describe("extractScopedTicketIds", () => {
  // G1 — un commit d'implémentation → son scope est l'id.
  it("G1 — extrait l'id du scope d'un feat", () => {
    expect(extractScopedTicketIds(["feat(GROWTH-01): vue funnel"])).toEqual([
      "GROWTH-01",
    ]);
  });

  // G2 — RÉGRESSION CENTRALE : le commit de cycle `start` ne compte plus.
  it("G2 — chore(backlog): start <id> n'est PAS un merge", () => {
    expect(extractScopedTicketIds(["chore(backlog): start GROWTH-02"])).toEqual([]);
    expect(extractScopedTicketIds(["chore(backlog): plan GROWTH-05/06"])).toEqual([]);
    expect(extractScopedTicketIds(["chore(backlog): merge"])).toEqual([]);
  });

  // G3 — ids multi-segments capturés en entier.
  it("G3 — scopes multi-segments", () => {
    expect(extractScopedTicketIds(["fix(SETS-UX-02): ligne cliquable"])).toEqual([
      "SETS-UX-02",
    ]);
    expect(extractScopedTicketIds(["feat(SEO-HUB-CURATED): pipeline"])).toEqual([
      "SEO-HUB-CURATED",
    ]);
  });

  // G4 — seuls les sujets comptent : pas de faux positif depuis un corps.
  it("G4 — une mention hors-scope (corps) n'est pas captée", () => {
    // Sujet seul (le caller ne passe que des sujets via --format=%s).
    expect(extractScopedTicketIds(["feat(INFRA-11): cycle"])).toEqual(["INFRA-11"]);
  });

  // G5 — commit sans scope id → rien.
  it("G5 — pas de scope ou scope non-id → []", () => {
    expect(extractScopedTicketIds(["docs: pas de scope", "chore: rien"])).toEqual([]);
  });

  // G6 — marqueur breaking `!` toléré.
  it("G6 — feat(<id>)! breaking", () => {
    expect(extractScopedTicketIds(["feat(GROWTH-01)!: x"])).toEqual(["GROWTH-01"]);
  });

  // G7 — déduplication.
  it("G7 — dédup d'un même id", () => {
    expect(
      extractScopedTicketIds(["feat(INFRA-11): a", "fix(INFRA-11): b"]),
    ).toEqual(["INFRA-11"]);
  });

  // G8 — scénario complet du bug : seul le ticket implémenté est promu.
  it("G8 — historique mixte → seul l'id implémenté, pas le start parallèle", () => {
    expect(
      extractScopedTicketIds([
        "feat(GROWTH-01): vue funnel",
        "chore(backlog): start GROWTH-02",
        "chore(backlog): start GROWTH-01",
      ]),
    ).toEqual(["GROWTH-01"]);
  });

  // G9 — INFRA-25 : régression du bug vécu — chore(<TICKET-ID>) scopé à un id
  // (ex. maturation `chore(PKG-04): maturation …`) n'est PAS une implémentation.
  it("G9 — chore(<TICKET-ID>) scopé à un id n'est PAS un merge", () => {
    expect(
      extractScopedTicketIds(["chore(PKG-04): maturation éditeur"]),
    ).toEqual([]);
  });

  // G10 — idem pour les autres types non-implémentation scopés à un id.
  it("G10 — docs/refactor/test scopés à un id n'implémentent pas", () => {
    expect(
      extractScopedTicketIds([
        "docs(INFRA-25): notes",
        "refactor(SETS-UX-02): x",
        "test(GROWTH-01): y",
      ]),
    ).toEqual([]);
  });

  // G11 — cas mixte : le feat promeut, le chore scopé au même id est ignoré.
  it("G11 — feat promeut, chore scopé au même id est ignoré (dédup)", () => {
    expect(
      extractScopedTicketIds([
        "feat(PKG-04): impl",
        "chore(PKG-04): maturation",
      ]),
    ).toEqual(["PKG-04"]);
  });
});

// INFRA-12 — annotations de pilotage migrées depuis RoadmapTicketRef.
describe("ticket-frontmatter — surface / blockedBy / note (INFRA-12)", () => {
  const RAW = `---
id: COMBO-03
type: ticket
status: shipped
epic: COMBO
surface: public
blockedBy: COMBO-01, COMBO-05
---

# COMBO-03
`;

  it("parse surface (enum) et blockedBy (scalaire comma-séparé → string[])", () => {
    const { frontmatter } = parseTicketFile(RAW);
    expect(frontmatter.surface).toBe("public");
    expect(frontmatter.blockedBy).toEqual(["COMBO-01", "COMBO-05"]);
  });

  it("round-trip serialize → parse préserve surface + blockedBy", () => {
    const fm: TicketFrontmatter = {
      id: "ANALYTICS-04",
      type: "ticket",
      status: "shipped",
      epic: "ANALYTICS",
      surface: "private",
      blockedBy: ["ANALYTICS-02", "COMBO-05"],
    };
    const reparsed = parseTicketFile(serializeTicketFile(fm, "\n# X\n"));
    expect(reparsed.frontmatter.blockedBy).toEqual(["ANALYTICS-02", "COMBO-05"]);
    expect(reparsed.frontmatter.surface).toBe("private");
  });

  it("rejette une surface hors enum et un blockedBy à id invalide", () => {
    expect(validateTicket({ id: "A-01", type: "ticket", status: "shipped", surface: "x" }).ok).toBe(
      false,
    );
    expect(
      validateTicket({ id: "A-01", type: "ticket", status: "shipped", blockedBy: ["pas-un-id-!"] })
        .ok,
    ).toBe(false);
  });

  it("blockedBy vide (`blockedBy:` sans valeur) → champ omis, pas de clé fantôme", () => {
    const raw = `---\nid: A-01\ntype: ticket\nstatus: shipped\nblockedBy:\n---\n\n# A\n`;
    const { frontmatter } = parseTicketFile(raw);
    expect(frontmatter.blockedBy).toBeUndefined();
  });

  it("blockedBy mal formé (`blockedBy: ,`, que des virgules) → erreur, pas un-gating silencieux", () => {
    const raw = `---\nid: A-01\ntype: ticket\nstatus: shipped\nblockedBy: ,\n---\n\n# A\n`;
    expect(() => parseTicketFile(raw)).toThrow(/mal formé/i);
  });

  it("note mono-ligne acceptée, multi-ligne refusée", () => {
    expect(
      validateTicket({ id: "A-01", type: "ticket", status: "shipped", note: "annotation" }).ok,
    ).toBe(true);
    expect(
      validateTicket({ id: "A-01", type: "ticket", status: "shipped", note: "deux\nlignes" }).ok,
    ).toBe(false);
  });
});

// INFRA-23 — cœur PUR de la garde de collision d'id contre main. Testé exhaustivement
// ici (idiome planTransitions/hook.test.ts) ; l'I/O git reste un wrapper mince et
// tolérant côté cli.ts.
describe("ticketIdFromSpecFilename (INFRA-23)", () => {
  it("mappe un nom de fichier de ticket vers son id", () => {
    expect(ticketIdFromSpecFilename("value-40.md")).toBe("VALUE-40");
    expect(ticketIdFromSpecFilename("infra-08.md")).toBe("INFRA-08");
  });

  it("gère le multi-segment (grammaire ID_BODY)", () => {
    expect(ticketIdFromSpecFilename("seo-hub-curated.md")).toBe("SEO-HUB-CURATED");
  });

  it("rejette les specs de domaine et les non-.md → null", () => {
    expect(ticketIdFromSpecFilename("backlog.md")).toBeNull(); // mono-segment
    expect(ticketIdFromSpecFilename("value.md")).toBeNull();
    expect(ticketIdFromSpecFilename("mcp.md")).toBeNull();
    expect(ticketIdFromSpecFilename("notes.txt")).toBeNull();
  });

  it("robustesse : jamais un throw", () => {
    expect(ticketIdFromSpecFilename("")).toBeNull();
    expect(() => ticketIdFromSpecFilename("....md")).not.toThrow();
  });
});

describe("nextFreeTicketId (INFRA-23)", () => {
  it("cœur : renvoie max+1 du même préfixe (cas VALUE-40 → VALUE-46)", () => {
    const taken = ["VALUE-40", "VALUE-41", "VALUE-42", "VALUE-43", "VALUE-44", "VALUE-45"];
    expect(nextFreeTicketId("VALUE-40", taken)).toBe("VALUE-46");
  });

  it("ignore les autres scopes", () => {
    expect(nextFreeTicketId("VALUE-40", ["VALUE-40", "INFRA-99", "SEO-77"])).toBe("VALUE-41");
  });

  it("conserve le padding (≥2 chiffres)", () => {
    expect(nextFreeTicketId("VALUE-06", ["VALUE-06"])).toBe("VALUE-07");
    expect(nextFreeTicketId("INFRA-08", ["INFRA-08", "INFRA-09"])).toBe("INFRA-10");
  });

  it("passe à 3 chiffres sans tronquer", () => {
    expect(nextFreeTicketId("INFRA-99", ["INFRA-99"])).toBe("INFRA-100");
  });

  it("dernier segment non numérique → null (pas de suggestion)", () => {
    expect(nextFreeTicketId("SEO-HUB-CURATED", ["SEO-HUB-CURATED"])).toBeNull();
  });

  it("taken vide → l'id demandé lui-même reste le suivant libre", () => {
    expect(nextFreeTicketId("VALUE-40", [])).toBe("VALUE-40");
  });

  it("déterministe, insensible à l'ordre", () => {
    const a = nextFreeTicketId("VALUE-40", ["VALUE-45", "VALUE-40"]);
    const b = nextFreeTicketId("VALUE-40", ["VALUE-40", "VALUE-45"]);
    expect(a).toBe(b);
    expect(a).toBe("VALUE-46");
  });
});

// BLG-06 — cohérence du triplet model/effort : table + fonction de contrôle,
// et son PÉRIMÈTRE (propre à `mature`, jamais à la lecture/validation générale).
describe("checkTripletCoherence / EXEC_EFFORT_MODEL_FLOOR (BLG-06)", () => {
  // D — la table couvre EXACTEMENT EXEC_EFFORTS : un palier ajouté un jour sans
  // entrée ici fait rougir ce test plutôt que de passer silencieusement.
  it("EXEC_EFFORT_MODEL_FLOOR couvre exactement EXEC_EFFORTS", () => {
    expect(Object.keys(EXEC_EFFORT_MODEL_FLOOR).sort()).toEqual([...EXEC_EFFORTS].sort());
  });

  // D1/D2 — high/xhigh/max exigent opus (plancher) ; low/medium n'en ont aucun.
  it("high/xhigh/max exigent opus, low/medium n'ont pas de plancher", () => {
    expect(EXEC_EFFORT_MODEL_FLOOR.low).toBeNull();
    expect(EXEC_EFFORT_MODEL_FLOOR.medium).toBeNull();
    expect(EXEC_EFFORT_MODEL_FLOOR.high).toBe("opus");
    expect(EXEC_EFFORT_MODEL_FLOOR.xhigh).toBe("opus");
    expect(EXEC_EFFORT_MODEL_FLOOR.max).toBe("opus");
  });

  // D1 — sonnet sous le plancher : violation « below-floor ».
  it("sonnet sous le plancher (high) → below-floor", () => {
    expect(checkTripletCoherence("sonnet", "high")).toEqual({
      floor: "opus",
      reason: "below-floor",
    });
  });

  // D3 — fable n'est pas classé dans l'échelle : violation « unclassified »,
  // distincte de celle de sonnet.
  it("fable sous le plancher (high) → unclassified, distinct de sonnet", () => {
    expect(checkTripletCoherence("fable", "high")).toEqual({
      floor: "opus",
      reason: "unclassified",
    });
  });

  // opus satisfait son propre plancher : cohérent.
  it("opus sur high/xhigh/max : cohérent (null)", () => {
    for (const effort of ["high", "xhigh", "max"] as const) {
      expect(checkTripletCoherence("opus", effort)).toBeNull();
    }
  });

  // D1 — aucun plancher sous high : sonnet ET opus sont cohérents à low/medium
  // (la réciproque, opus sur un effort bas, n'est JAMAIS contrôlée).
  it("low/medium : tout modèle est cohérent (aucun plancher)", () => {
    for (const effort of ["low", "medium"] as const) {
      expect(checkTripletCoherence("sonnet", effort)).toBeNull();
      expect(checkTripletCoherence("opus", effort)).toBeNull();
      expect(checkTripletCoherence("fable", effort)).toBeNull();
    }
  });

  // Périmètre (portée du ticket) — le contrôle est propre à `mature` : ni le schéma
  // Zod (validateTicket) ni le chemin de lecture (parseTicketFile, utilisé par
  // `snapshot`) ne le voient. Un .md dont le triplet est incohérent doit rester
  // LISIBLE, exactement comme `model: haiku` l'est resté (BLG-01) — sinon un
  // ticket historique deviendrait irrécupérable par un `snapshot` de routine.
  it("un .md au triplet incohérent (sonnet + high) reste lisible (parseTicketFile)", () => {
    const raw = `---
id: OLD-06
type: ticket
status: todo
exec:
  model: sonnet
  effort: high
  matured: 2026-05-01
---

# OLD-06
`;
    const { frontmatter } = parseTicketFile(raw);
    expect(frontmatter.exec).toEqual({
      model: "sonnet",
      effort: "high",
      matured: "2026-05-01",
    });
    // validateTicket, lui non plus, ne rejette pas l'incohérence.
    const res = validateTicket({
      id: "OLD-06",
      type: "ticket",
      status: "todo",
      exec: { model: "sonnet", effort: "high", matured: "2026-05-01" },
    });
    expect(res.ok).toBe(true);
  });
});
