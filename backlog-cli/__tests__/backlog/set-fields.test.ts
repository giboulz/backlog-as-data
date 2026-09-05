import { describe, it, expect } from "vitest";
import { applyFieldAssignment } from "@/lib/backlog/set-fields";
import type { TicketFrontmatter } from "@/lib/backlog/ticket-frontmatter";

// BLG-05 — Cœur pur `applyFieldAssignment` : objets littéraux, ni tmpdir ni
// fs (D2, assertion structurelle : le module ne doit connaître aucune I/O).

const maturedTicket: TicketFrontmatter = {
  id: "INFRA-99",
  title: "Titre initial",
  type: "ticket",
  status: "todo",
  exec: { model: "opus", effort: "high", review: "light", matured: "2026-06-08" },
};

describe("applyFieldAssignment (cœur pur)", () => {
  // status=todo sur un ticket maturé → next.status === "todo", exec conservé.
  it("status=todo conserve exec (statut cible identique, maturé)", () => {
    const res = applyFieldAssignment(maturedTicket, "status", "todo");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.status).toBe("todo");
    expect(res.next.exec).toEqual(maturedTicket.exec);
  });

  // status=parked sur un ticket maturé → exec retiré, note non vide (dématuration).
  it("status=parked sur un ticket maturé retire exec (dématuration)", () => {
    const res = applyFieldAssignment(maturedTicket, "status", "parked");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.status).toBe("parked");
    expect(res.next.exec).toBeUndefined();
    expect(res.note).not.toBe("");
  });

  // status=shipped → exec conservé (invariant INFRA-10 D1).
  it("status=shipped conserve exec", () => {
    const res = applyFieldAssignment(maturedTicket, "status", "shipped");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.status).toBe("shipped");
    expect(res.next.exec).toEqual(maturedTicket.exec);
  });

  // title=Nouveau titre → next.title, et aucun autre champ ne bouge.
  it("title=Nouveau titre change le titre et rien d'autre", () => {
    const res = applyFieldAssignment(maturedTicket, "title", "Nouveau titre");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.title).toBe("Nouveau titre");
    const { title: _t, ...restNext } = res.next;
    const { title: _t2, ...restOrig } = maturedTicket;
    expect(restNext).toEqual(restOrig);
  });

  // clé inconnue (priority=must) → refus, message nommant la clé ET listant
  // les champs mutables. Mutation-témoin : un message qui ne liste pas
  // `title` laisse l'utilisateur devant le cul-de-sac que ce ticket ferme.
  it("priority=must est refusé et le message liste status et title", () => {
    const res = applyFieldAssignment(maturedTicket, "priority", "must");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/priority/);
    expect(res.error).toMatch(/status/);
    expect(res.error).toMatch(/title/);
  });

  // title= (valeur vide) → refus. Jamais de titre vide écrit.
  it("title= (vide) est refusé", () => {
    const res = applyFieldAssignment(maturedTicket, "title", "");
    expect(res.ok).toBe(false);
  });

  // title=a=b → titre a=b (D4 : la clé se lit avant le premier `=`, ici déjà
  // acquis en amont — ce test épingle que la valeur passée telle quelle n'est
  // pas re-coupée sur un second `=`).
  it("title=a=b pose le titre a=b", () => {
    const res = applyFieldAssignment(maturedTicket, "title", "a=b");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.title).toBe("a=b");
  });

  // Finding #4 (reprise) — `status` reste trim, contrairement à `title` : un
  // espace/CR de queue (copié-collé, fichier lu sous Windows) n'a jamais été
  // un statut fautif à signaler, et le trim ne masquait aucune erreur pour un
  // enum fermé (contrairement à `title`, cf. test suivant).
  it("status=parked (espace de queue) est accepté, trim conservé pour status", () => {
    const res = applyFieldAssignment(maturedTicket, "status", "parked ");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.status).toBe("parked");
  });

  // Finding #4 (reprise) — `title` reste NON trim : un espace de tête doit
  // atteindre zod tel quel pour être refusé (D3), pas être absorbé ici.
  it("title= foo (espace de tête) est refusé, pas silencieusement trim", () => {
    const res = applyFieldAssignment(maturedTicket, "title", " foo");
    expect(res.ok).toBe(false);
  });

  // BLG-03 — blockedBy=SKILL-31 → next.blockedBy === ["SKILL-31"].
  it("blockedBy=SKILL-31 pose next.blockedBy", () => {
    const res = applyFieldAssignment(maturedTicket, "blockedBy", "SKILL-31");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.blockedBy).toEqual(["SKILL-31"]);
  });

  // BLG-03 — blockedBy=A-01, B-02 → deux ids, trimmés.
  it("blockedBy=A-01, B-02 pose deux ids trimmés", () => {
    const res = applyFieldAssignment(maturedTicket, "blockedBy", "A-01, B-02");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.blockedBy).toEqual(["A-01", "B-02"]);
  });

  // BLG-03 D4 — blockedBy= (vide) retire la clé. Mutation-témoin : la poser à
  // [] ferait rougir (le .min(1) du zod refuse un tableau vide).
  it("blockedBy= (vide) retire la clé (D4)", () => {
    const fmWithBlocked: TicketFrontmatter = { ...maturedTicket, blockedBy: ["SKILL-31"] };
    const res = applyFieldAssignment(fmWithBlocked, "blockedBy", "");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.blockedBy).toBeUndefined();
    expect("blockedBy" in res.next).toBe(false);
  });

  // BLG-03, finding #3 (reprise) — la suppression est signalée par `note`,
  // sinon `blockedBy=` sur un ticket qui vient réellement de lever son
  // blocage est indiscernable, en sortie CLI, d'un ticket qui n'en portait
  // déjà aucun (même chemin, même message, exit 0).
  it("blockedBy= (vide) sur un ticket bloqué pose une note de retrait", () => {
    const fmWithBlocked: TicketFrontmatter = { ...maturedTicket, blockedBy: ["SKILL-31"] };
    const res = applyFieldAssignment(fmWithBlocked, "blockedBy", "");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.note).not.toBe("");
  });

  // BLG-03, finding #3 (reprise) — symétrie : rien à retirer, rien à signaler.
  it("blockedBy= (vide) sur un ticket déjà non bloqué ne pose aucune note", () => {
    const res = applyFieldAssignment(maturedTicket, "blockedBy", "");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.note).toBe("");
  });

  // BLG-03, finding #4 (reprise) — parité avec le parseur de frontmatter, qui
  // accepte `blockedBy: "SKILL-31"` (stripQuotes) : la valeur CLI quotée doit
  // se lire de la même façon, pas être refusée par l'ID_RE sur des guillemets
  // littéraux.
  it('blockedBy="SKILL-31" (valeur quotée) est acceptée comme SKILL-31 (parité parseur)', () => {
    const res = applyFieldAssignment(maturedTicket, "blockedBy", '"SKILL-31"');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.blockedBy).toEqual(["SKILL-31"]);
  });

  // BLG-03 D4 — blockedBy=, (valeur non-vide sans id) → refus, parité avec le
  // parseur (lib/backlog/ticket-frontmatter.ts:428-436).
  it("blockedBy=, (aucun id) est refusé (D4, parité parseur)", () => {
    const res = applyFieldAssignment(maturedTicket, "blockedBy", ",");
    expect(res.ok).toBe(false);
  });

  // BLG-03 — blockedBy=pas un id → refus (ID_RE du zod, via validateTicket).
  it("blockedBy=pas un id est refusé (ID_RE)", () => {
    const res = applyFieldAssignment(maturedTicket, "blockedBy", "pas un id");
    expect(res.ok).toBe(false);
  });

  // BLG-03 D5 — un id bien formé mais inexistant est accepté : le champ est
  // une annotation, pas un contrôle d'existence (cas d'usage d'origine :
  // blocage cross-dépôt, cf. specs/blg-08.md dans claude-config).
  it("blockedBy=SKILL-999 (id inexistant, bien formé) est accepté (D5)", () => {
    const res = applyFieldAssignment(maturedTicket, "blockedBy", "SKILL-999");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.blockedBy).toEqual(["SKILL-999"]);
  });
});
