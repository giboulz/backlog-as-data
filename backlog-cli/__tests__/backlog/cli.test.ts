import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { parseFlags, runBacklogCommand, type FlagSpec } from "@/lib/backlog/cli";
import {
  parseTicketFile,
  serializeTicketFile,
} from "@/lib/backlog/ticket-frontmatter";
import { TICKET_SPEC_SECTIONS } from "@/lib/backlog/ticket-brief";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "backlog-cli-"));
  await mkdir(path.join(root, "specs"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const file = () => path.join(root, "specs", "infra-99.md");
const fmOf = async () => parseTicketFile(await readFile(file(), "utf8")).frontmatter;
const snapshot = async () =>
  JSON.parse(await readFile(path.join(root, "backlog.json"), "utf8"));

describe("backlog CLI", () => {
  // C1 — new crée un ticket maturing à corps vide + régénère backlog.json.
  it("C1 — new crée un ticket maturing", async () => {
    const r = await runBacklogCommand(
      ["new", "INFRA-99", "--epic", "e", "--priority", "could"],
      { root },
    );
    expect(r.code).toBe(0);
    expect(await fmOf()).toMatchObject({
      id: "INFRA-99",
      type: "ticket",
      status: "maturing",
      epic: "e",
      priority: "could",
    });
    const snap = await snapshot();
    expect(snap.tickets.find((t: { id: string }) => t.id === "INFRA-99")).toBeTruthy();
  });

  // C2 — new sur un id existant échoue sans écraser.
  it("C2 — new sur id existant échoue", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(["new", "INFRA-99", "--epic", "x"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/existe|exist/i);
    // epic d'origine préservé
    expect((await fmOf()).epic).toBe("e");
  });

  // C3 — mature écrit exec et passe maturing → todo.
  it("C3 — mature passe maturing → todo", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "opus",
        "--effort",
        "high",
        "--review",
        "light",
        "--date",
        "2026-06-08",
      ],
      { root },
    );
    expect(r.code).toBe(0);
    const fm = await fmOf();
    expect(fm.status).toBe("todo");
    expect(fm.exec).toEqual({
      model: "opus",
      effort: "high",
      review: "light",
      matured: "2026-06-08",
    });
  });

  // C4 — set status=todo sans exec viole l'invariant : refus, fichier inchangé.
  it("C4 — set status=todo sans exec est refusé", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(["set", "INFRA-99", "status=todo"], { root });
    expect(r.code).not.toBe(0);
    expect((await fmOf()).status).toBe("maturing");
  });

  // C5 — set status=parked depuis maturing : OK + backlog.json à jour.
  it("C5 — set status=parked", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(["set", "INFRA-99", "status=parked"], { root });
    expect(r.code).toBe(0);
    const snap = await snapshot();
    expect(
      snap.tickets.find((t: { id: string }) => t.id === "INFRA-99").status,
    ).toBe("parked");
  });

  // C6 — snapshot idempotent (même bytes).
  it("C6 — snapshot est idempotent", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r1 = await runBacklogCommand(["snapshot"], { root });
    expect(r1.code).toBe(0);
    const j1 = await readFile(path.join(root, "backlog.json"), "utf8");
    await runBacklogCommand(["snapshot"], { root });
    const j2 = await readFile(path.join(root, "backlog.json"), "utf8");
    expect(j2).toBe(j1);
  });

  // C7 — mature sans --date échoue (le script n'invente pas la date).
  it("C7 — mature sans --date échoue", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "opus",
        "--effort",
        "think-hard",
        "--review",
        "light",
      ],
      { root },
    );
    expect(r.code).not.toBe(0);
  });

  // C8 — set vers un statut non-maturé dématuré : retire exec (pas de cul-de-sac).
  it("C8 — set status=parked sur un ticket maturé retire exec", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "opus",
        "--effort",
        "none",
        "--review",
        "none",
        "--date",
        "2026-06-08",
      ],
      { root },
    );
    const r = await runBacklogCommand(["set", "INFRA-99", "status=parked"], { root });
    expect(r.code).toBe(0);
    const fm = await fmOf();
    expect(fm.status).toBe("parked");
    expect(fm.exec).toBeUndefined();
  });

  // C9 — un fichier ticket invalide ne bloque pas les autres commandes.
  it("C9 — un fichier ticket invalide n'empoisonne pas le CLI", async () => {
    await writeFile(
      path.join(root, "specs", "bad.md"),
      "---\ntype: ticket\nid: bad id\nstatus: todo\n---\n# bad\n",
      "utf8",
    );
    const r = await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    expect(r.code).toBe(0);
    expect((await fmOf()).id).toBe("INFRA-99");
  });

  // C10 — mature sans --model donne une erreur claire (pas du Zod cryptique).
  it("C10 — mature sans --model : erreur claire", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      ["mature", "INFRA-99", "--effort", "none", "--date", "2026-06-08"],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/model/i);
  });

  // C12 (INFRA-13) — snapshot avec un fichier invalide : régénère quand même
  // backlog.json depuis les valides, MAIS signale l'invalide sur stderr + exit ≠0
  // (plus de faux succès silencieux qui ferait disparaître un ticket du board).
  it("C12 — snapshot signale les fichiers invalides (stderr + exit ≠0)", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    await writeFile(
      path.join(root, "specs", "bad.md"),
      "---\ntype: ticket\nid: INFRA-77\nstatus: done\n---\n# bad\n",
      "utf8",
    );

    const r = await runBacklogCommand(["snapshot"], { root });

    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/bad\.md/);
    // le ticket valide reste présent dans le snapshot régénéré
    const snap = await snapshot();
    expect(
      snap.tickets.find((t: { id: string }) => t.id === "INFRA-99"),
    ).toBeTruthy();
    // l'invalide n'y est pas (mais le signal stderr/exit le rend visible)
    expect(
      snap.tickets.find((t: { id: string }) => t.id === "INFRA-77"),
    ).toBeFalsy();
  });

  // C11 — id en double : la mutation refuse (ambigu) au lieu de muter au hasard.
  it("C11 — id ambigu : set refuse et ne mute rien", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    // second fichier, nom différent, MÊME id
    await writeFile(
      path.join(root, "specs", "dup-99.md"),
      "---\nid: INFRA-99\ntype: ticket\nstatus: maturing\nepic: e\n---\n# dup\n",
      "utf8",
    );
    const r = await runBacklogCommand(["set", "INFRA-99", "status=parked"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/ambig/i);
    // le fichier d'origine n'a pas bougé
    expect((await fmOf()).status).toBe("maturing");
  });

  // C13 (INFRA-10 D4) — new --title pose le titre dans le frontmatter et le snapshot.
  it("C13 — new --title propage le titre", async () => {
    const r = await runBacklogCommand(
      ["new", "INFRA-99", "--epic", "e", "--title", "Titre lisible du board"],
      { root },
    );
    expect(r.code).toBe(0);
    expect((await fmOf()).title).toBe("Titre lisible du board");
    const snap = await snapshot();
    expect(
      snap.tickets.find((t: { id: string }) => t.id === "INFRA-99").title,
    ).toBe("Titre lisible du board");
  });

  // INFRA-30 — mature --review deep écrit la ligne et passe maturing → todo.
  it("INFRA-30 — mature --review deep écrit exec.review", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "sonnet",
        "--effort",
        "medium",
        "--review",
        "deep",
        "--date",
        "2026-07-20",
      ],
      { root },
    );
    expect(r.code).toBe(0);
    const raw = await readFile(file(), "utf8");
    expect(raw).toContain("review: deep");
    const fm = await fmOf();
    expect(fm.status).toBe("todo");
    expect(fm.exec).toEqual({
      model: "sonnet",
      effort: "medium",
      review: "deep",
      matured: "2026-07-20",
    });
  });

  // INFRA-32 — --review fait désormais partie du triplet requis à la maturation :
  // sans lui, échec avec message citant le flag et les trois valeurs admises.
  // Remplace le cas INFRA-30 « sans --review → succès sans ligne review ».
  it("INFRA-32 — mature sans --review échoue", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      ["mature", "INFRA-99", "--model", "sonnet", "--effort", "think", "--date", "2026-07-20"],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/--review/);
    expect(r.stderr).toMatch(/none\|light\|deep/);
    // le fichier n'a pas été muté (le new précédent l'a laissé en maturing)
    expect((await fmOf()).status).toBe("maturing");
  });

  // INFRA-30 — --review bogus échoue via la validation Zod (comme model/effort).
  it("INFRA-30 — mature --review bogus échoue", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "sonnet",
        "--effort",
        "think",
        "--review",
        "bogus",
        "--date",
        "2026-07-20",
      ],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/review/i);
    // le fichier n'a pas été muté (le new précédent l'a laissé en maturing)
    expect((await fmOf()).status).toBe("maturing");
  });

  // INFRA-30 — le champ survit à un set status=… (round-trip via le chemin CLI,
  // distinct du test unitaire de serializeTicketFile).
  it("INFRA-30 — set status=wip conserve exec.review", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "sonnet",
        "--effort",
        "think",
        "--review",
        "light",
        "--date",
        "2026-07-20",
      ],
      { root },
    );
    const r = await runBacklogCommand(["set", "INFRA-99", "status=wip"], { root });
    expect(r.code).toBe(0);
    const fm = await fmOf();
    expect(fm.status).toBe("wip");
    expect(fm.exec?.review).toBe("light");
  });

  // INFRA-30 — la dématuration retire exec en entier, review compris.
  it("INFRA-30 — dématuration (set status=maturing) retire exec.review", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "sonnet",
        "--effort",
        "think",
        "--review",
        "deep",
        "--date",
        "2026-07-20",
      ],
      { root },
    );
    const r = await runBacklogCommand(["set", "INFRA-99", "status=maturing"], { root });
    expect(r.code).toBe(0);
    const fm = await fmOf();
    expect(fm.status).toBe("maturing");
    expect(fm.exec).toBeUndefined();
  });

  // INFRA-32 — l'obligation de --review vit dans le CLI (cmdMature), pas dans le
  // schéma : un ticket historique dont le frontmatter porte un exec SANS review
  // (maturé avant ce ticket) reste valide et traverse `set` sans perdre ni gagner
  // de champ.
  it("INFRA-32 — exec historique sans review reste valide au travers de set", async () => {
    // Frontmatter historique : effort legacy `think`, écrit à la main avant la
    // bascule EFFORT-COMPAT. Il traverse `set` sans être rejeté, et son effort est
    // normalisé vers l'officiel `medium` (le .md muté sort en officiel).
    await writeFile(
      file(),
      "---\nid: INFRA-99\ntype: ticket\nstatus: todo\nepic: e\nexec:\n  model: opus\n  effort: think\n  matured: 2026-05-01\n---\n# INFRA-99\n",
      "utf8",
    );
    const r = await runBacklogCommand(["set", "INFRA-99", "status=wip"], { root });
    expect(r.code).toBe(0);
    const fm = await fmOf();
    expect(fm.status).toBe("wip");
    expect(fm.exec).toEqual({
      model: "opus",
      effort: "medium",
      matured: "2026-05-01",
    });
  });

  // R3 (INFRA-10 D5) — toute mutation régénère specs/backlog.md (rendu généré)
  // en plus de backlog.json : les deux artefacts vivent d'un même geste.
  it("R3 — new/set/snapshot régénèrent specs/backlog.md avec sentinel", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const mdPath = path.join(root, "specs", "backlog.md");
    const afterNew = await readFile(mdPath, "utf8");
    expect(afterNew).toContain("INFRA-99");
    expect(afterNew).toContain("À maturer (1)");

    await runBacklogCommand(["set", "INFRA-99", "status=parked"], { root });
    const afterSet = await readFile(mdPath, "utf8");
    expect(afterSet).toContain("Parked (1)");
    expect(afterSet).toContain("À maturer (0)");
  });

  // R4 (INFRA-10 D5) — verrou : un specs/backlog.md existant SANS sentinel
  // (la source legacy, encore canonique avant migration) n'est JAMAIS écrasé
  // par une mutation CLI ; backlog.json est quand même régénéré.
  it("R4 — un backlog.md legacy (sans sentinel) n'est pas écrasé", async () => {
    const mdPath = path.join(root, "specs", "backlog.md");
    const legacy = "# Backlog\n\n## Must Have\n\n- **LEGACY-01 — Ticket**\n";
    await writeFile(mdPath, legacy, "utf8");

    const r = await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    expect(r.code).toBe(0);
    expect(await readFile(mdPath, "utf8")).toBe(legacy);
    // backlog.json, lui, est bien régénéré
    const snap = await snapshot();
    expect(snap.tickets.find((t: { id: string }) => t.id === "INFRA-99")).toBeTruthy();
  });

  // T3-cli (INFRA-10 D4) — le snapshot expose le chemin du fichier ticket
  // (relatif au root, slash normalisé) pour la lecture request-time du board.
  it("C14 — le snapshot porte file pour chaque ticket", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const snap = await snapshot();
    expect(
      snap.tickets.find((t: { id: string }) => t.id === "INFRA-99").file,
    ).toBe("specs/infra-99.md");
  });

  // EFFORT-COMPAT — `mature --model haiku` est REFUSÉ (haiku retiré, plancher =
  // sonnet) ; le ticket reste maturing, rien n'est écrit.
  it("EC1 — mature --model haiku est refusé (haiku retiré, plancher = sonnet)", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "haiku",
        "--effort",
        "medium",
        "--review",
        "light",
        "--date",
        "2026-08-02",
      ],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/haiku/i);
    expect(r.stderr).toMatch(/sonnet/i);
    // ticket intact : le refus précède l'écriture.
    const fm = await fmOf();
    expect(fm.status).toBe("maturing");
    expect(fm.exec).toBeUndefined();
  });

  // EFFORT-COMPAT — `mature` avec un effort legacy en entrée écrit l'OFFICIEL dans
  // le .md (normalisation à la validation) : le disque ne porte jamais de legacy neuf.
  // BLG-06 — model opus (pas sonnet) : think-hard normalise en `high`, qui exige le
  // plancher opus (sinon ce test se heurterait au contrôle de cohérence, testé à
  // part ci-dessous).
  it("EC2 — mature --effort think-hard écrit l'officiel high dans le .md", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "opus",
        "--effort",
        "think-hard",
        "--review",
        "light",
        "--date",
        "2026-08-02",
      ],
      { root },
    );
    expect(r.code).toBe(0);
    const raw = await readFile(file(), "utf8");
    expect(raw).toContain("effort: high");
    expect(raw).not.toContain("think-hard");
    expect((await fmOf()).exec?.effort).toBe("high");
  });

  // EFFORT-COMPAT (CRUX) — round-trip : un .md legacy (effort think-hard + model
  // haiku, écrits à la main) traverse un `snapshot` sans être rejeté ; backlog.json
  // montre l'OFFICIEL (high) et tolère haiku ; le .md sur disque n'est PAS réécrit.
  it("EC3 — snapshot d'un .md legacy → backlog.json officiel, .md intact", async () => {
    const legacy =
      "---\nid: INFRA-99\ntype: ticket\nstatus: todo\nepic: e\nexec:\n  model: haiku\n  effort: think-hard\n  matured: 2026-05-01\n---\n\n# INFRA-99\n";
    await writeFile(file(), legacy, "utf8");

    const r = await runBacklogCommand(["snapshot"], { root });
    expect(r.code).toBe(0);

    // backlog.json : effort normalisé en officiel, haiku toléré.
    const snap = await snapshot();
    const t = snap.tickets.find((t: { id: string }) => t.id === "INFRA-99");
    expect(t.exec.effort).toBe("high");
    expect(t.exec.model).toBe("haiku");

    // le .md sur disque n'a PAS été réécrit par le snapshot (legacy intact).
    expect(await readFile(file(), "utf8")).toBe(legacy);
  });

  // BLG-05 — set <ID> title=… : cœur mince de cmdSet au-dessus de
  // applyFieldAssignment. Le corps du .md doit rester intact octet pour octet.
  it("R1 — set title=… réécrit le .md, corps intact octet pour octet", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const bodyBefore = parseTicketFile(await readFile(file(), "utf8")).body;
    const r = await runBacklogCommand(
      ["set", "INFRA-99", "title=Nouveau titre"],
      { root },
    );
    expect(r.code).toBe(0);
    expect((await fmOf()).title).toBe("Nouveau titre");
    const bodyAfter = parseTicketFile(await readFile(file(), "utf8")).body;
    expect(bodyAfter).toBe(bodyBefore);
  });

  it("R2 — backlog.json porte le nouveau titre après set title=…", async () => {
    await runBacklogCommand(
      ["new", "INFRA-99", "--epic", "e", "--title", "Ancien titre"],
      { root },
    );
    const r = await runBacklogCommand(
      ["set", "INFRA-99", "title=Titre corrigé"],
      { root },
    );
    expect(r.code).toBe(0);
    const snap = await snapshot();
    expect(
      snap.tickets.find((t: { id: string }) => t.id === "INFRA-99").title,
    ).toBe("Titre corrigé");
  });

  it("R3 — set title=--review requis est accepté (D5 : positionnel après le =)", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      ["set", "INFRA-99", "title=--review requis"],
      { root },
    );
    expect(r.code).toBe(0);
    expect((await fmOf()).title).toBe("--review requis");
  });

  it("R4 — un titre à espace de tête est refusé par zod, le .md est inchangé", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const rawBefore = await readFile(file(), "utf8");
    const r = await runBacklogCommand(["set", "INFRA-99", "title= foo"], { root });
    expect(r.code).not.toBe(0);
    expect(await readFile(file(), "utf8")).toBe(rawBefore);
  });

  it("R5 — un titre déjà quoté est écrit puis relu identique (round-trip D3)", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(['set', "INFRA-99", 'title="foo"'], { root });
    expect(r.code).toBe(0);
    expect((await fmOf()).title).toBe('"foo"');
  });

  it("R6 — set priority=must échoue, message listant status et title", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(["set", "INFRA-99", "priority=must"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/status/);
    expect(r.stderr).toMatch(/title/);
  });

  it("R7 — set title= (vide) est refusé, le .md est inchangé", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const rawBefore = await readFile(file(), "utf8");
    const r = await runBacklogCommand(["set", "INFRA-99", "title="], { root });
    expect(r.code).not.toBe(0);
    expect(await readFile(file(), "utf8")).toBe(rawBefore);
  });

  // Finding BLG-05 #1 (reprise) — un titre multi-mots non quoté arrive en
  // plusieurs positionnels (le shell l'a déjà découpé avant que le CLI ne le
  // voie) : silencieusement jeter les positionnels 2+ écrirait un titre
  // tronqué avec exit 0. `set` doit refuser, comme `mature` le fait déjà
  // pour son propre superflu (BLG-06, cli.ts:428-434).
  it("R8 — set title=Titre corrigé (non quoté, positionnels superflus) est refusé", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const rawBefore = await readFile(file(), "utf8");
    const r = await runBacklogCommand(
      ["set", "INFRA-99", "title=Titre", "corrigé"],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/superflu/);
    expect(await readFile(file(), "utf8")).toBe(rawBefore);
  });

  // Finding BLG-05 #4 (reprise, niveau CLI) — un espace/CR de queue sur
  // `status` reste accepté (trim conservé, contrairement à `title`).
  it("R9 — set status=parked (espace de queue) reste accepté", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(["set", "INFRA-99", "status=parked "], { root });
    expect(r.code).toBe(0);
    expect((await fmOf()).status).toBe("parked");
  });

  // Finding BLG-05 #5 (reprise) — D4 exercé au niveau CLI (pas seulement sur
  // le module pur) : le découpage `assignment.indexOf("=")` de `cmdSet` doit
  // lire la clé avant le PREMIER `=`, la valeur étant tout le reste.
  it("R10 — set title=a=b (niveau CLI) : la clé se lit avant le premier =", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(["set", "INFRA-99", "title=a=b"], { root });
    expect(r.code).toBe(0);
    expect((await fmOf()).title).toBe("a=b");
  });

  // BLG-03 — set blockedBy=… réécrit le .md, corps intact octet pour octet,
  // et backlog.json porte le tableau.
  it("R11 — set blockedBy=SKILL-31 réécrit le .md et backlog.json", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const bodyBefore = parseTicketFile(await readFile(file(), "utf8")).body;
    const r = await runBacklogCommand(
      ["set", "INFRA-99", "blockedBy=SKILL-31"],
      { root },
    );
    expect(r.code).toBe(0);
    expect((await fmOf()).blockedBy).toEqual(["SKILL-31"]);
    const bodyAfter = parseTicketFile(await readFile(file(), "utf8")).body;
    expect(bodyAfter).toBe(bodyBefore);
    const snap = await snapshot();
    expect(
      snap.tickets.find((t: { id: string }) => t.id === "INFRA-99").blockedBy,
    ).toEqual(["SKILL-31"]);
  });

  // BLG-03 — round-trip : le scalaire comma-séparé écrit par le sérialiseur
  // se re-parse à l'identique.
  it("R12 — set blockedBy=A-01, B-02 round-trip identique après relecture", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      ["set", "INFRA-99", "blockedBy=A-01, B-02"],
      { root },
    );
    expect(r.code).toBe(0);
    expect((await fmOf()).blockedBy).toEqual(["A-01", "B-02"]);
  });

  // BLG-03 D4 — set blockedBy= (vide) retire la ligne du frontmatter, le
  // ticket reste valide.
  it("R13 — set blockedBy= (vide) retire le champ, le ticket reste valide", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    await runBacklogCommand(["set", "INFRA-99", "blockedBy=SKILL-31"], { root });
    const r = await runBacklogCommand(["set", "INFRA-99", "blockedBy="], { root });
    expect(r.code).toBe(0);
    const fm = await fmOf();
    expect(fm.blockedBy).toBeUndefined();
    expect(await readFile(file(), "utf8")).not.toContain("blockedBy:");
  });

  // BLG-03, finding #3 (reprise) — la sortie doit signaler explicitement le
  // retrait : sinon `BLG-08 → blockedBy=` est indiscernable d'un ticket qui
  // n'avait déjà aucune dépendance (même exit 0, même .md réécrit).
  it("R13b — set blockedBy= (vide) sur un ticket bloqué annonce le retrait dans stdout", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    await runBacklogCommand(["set", "INFRA-99", "blockedBy=SKILL-31"], { root });
    const r = await runBacklogCommand(["set", "INFRA-99", "blockedBy="], { root });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/retiré/);
  });

  // BLG-03 D4 — refus → .md inchangé.
  it("R14 — set blockedBy=, (aucun id) est refusé, le .md est inchangé", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const rawBefore = await readFile(file(), "utf8");
    const r = await runBacklogCommand(["set", "INFRA-99", "blockedBy=,"], { root });
    expect(r.code).not.toBe(0);
    expect(await readFile(file(), "utf8")).toBe(rawBefore);
  });

  // BLG-03, finding #4 (reprise) — parité niveau CLI : une valeur quotée
  // (échappement recommandé par CHEATSHEET/ADOPTION_README pour éviter le
  // découpage shell sur la virgule-espace) doit être acceptée comme le
  // parseur de frontmatter l'accepte déjà (stripQuotes).
  it('R15 — set blockedBy="A-01, B-02" (valeur quotée) est acceptée, deux ids', async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      ["set", "INFRA-99", 'blockedBy="A-01, B-02"'],
      { root },
    );
    expect(r.code).toBe(0);
    expect((await fmOf()).blockedBy).toEqual(["A-01", "B-02"]);
  });
});

// INFRA-23 — garde de collision d'id contre main. Dépôt git RÉEL (précédent
// execFileSync : bundle.test.ts) : le cas ne se reproduit qu'avec un arbre git où main
// porte un ticket que le worktree ne voit pas (branche forkée avant sa livraison).
describe("backlog CLI — new vs main (INFRA-23)", () => {
  let gitRoot: string;
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: gitRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

  beforeEach(async () => {
    gitRoot = await mkdtemp(path.join(os.tmpdir(), "backlog-git-"));
    await mkdir(path.join(gitRoot, "specs"), { recursive: true });
    git(["init", "-b", "main"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    await writeFile(path.join(gitRoot, "backlog.json"), '{"tickets":[]}');
    await writeFile(
      path.join(gitRoot, "specs", "infra-99.md"),
      "---\nid: INFRA-99\ntype: ticket\nstatus: shipped\n---\n\n# INFRA-99\n",
    );
    // Spec de DOMAINE (mono-segment) : ne doit jamais être prise pour un id de ticket.
    await writeFile(path.join(gitRoot, "specs", "backlog.md"), "# vue générée\n");
    git(["add", "-A"]);
    git(["commit", "-m", "seed"]);
    // Simule une branche forkée AVANT la livraison d'INFRA-99 : le worktree ne le voit pas.
    await rm(path.join(gitRoot, "specs", "infra-99.md"));
  });

  afterEach(async () => {
    await rm(gitRoot, { recursive: true, force: true });
  });

  it("C-new-main-collision — refuse un id livré sur main (invisible du worktree) + suggère", async () => {
    const r = await runBacklogCommand(["new", "INFRA-99"], { root: gitRoot });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/existe déjà sur main/i);
    expect(r.stderr).toMatch(/INFRA-100/);
    // Aucun fichier créé : le refus précède l'écriture.
    await expect(
      readFile(path.join(gitRoot, "specs", "infra-99.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("C-new-main-ok — un id libre sur main passe", async () => {
    const r = await runBacklogCommand(["new", "INFRA-50"], { root: gitRoot });
    expect(r.code).toBe(0);
    expect(
      await readFile(path.join(gitRoot, "specs", "infra-50.md"), "utf8"),
    ).toMatch(/id: INFRA-50/);
  });
});

// INFRA-33 — parseFlags déclaratif. Avant : un flag valué sans valeur (ou dont la
// valeur commence par `--`) recevait la chaîne "true", qui passe le z.string() de
// `title` → ticket créé avec `title: true`, code 0, aucun signal (vécu le 2026-07-20).
describe("parseFlags (INFRA-33)", () => {
  const TITLE: FlagSpec = { title: "value" };

  // P1 — verrou du bug d'origine : une valeur qui COMMENCE par `--` est une valeur.
  it("P1 — consomme une valeur commençant par --", () => {
    const r = parseFlags(["--title", "--review obligatoire a la maturation"], TITLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.flags.title).toBe("--review obligatoire a la maturation");
    expect(r.value.positionals).toEqual([]);
  });

  // P2 — flag valué en fin d'args : échec explicite, plus de fallback "true".
  it("P2 — flag valué sans valeur échoue", () => {
    const r = parseFlags(["--title"], TITLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("--title attend une valeur");
  });

  // P3 — oubli de valeur détecté parce que le token suivant est un flag DÉCLARÉ.
  it("P3 — flag valué suivi d'un autre flag de la commande échoue", () => {
    const r = parseFlags(["--model", "--effort", "think"], {
      model: "value",
      effort: "value",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("--model");
    expect(r.error).toContain("--effort");
  });

  // P4 — échappement `--k=v` : seule issue pour une valeur commençant par un flag
  // de la même commande (cf. P3).
  it("P4 — la forme --k=v accepte une valeur commençant par un flag déclaré", () => {
    const r = parseFlags(["--title=--priority urgente"], {
      title: "value",
      priority: "value",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.flags.title).toBe("--priority urgente");
  });

  it("P5 — --k= (valeur vide) échoue", () => {
    const r = parseFlags(["--title="], TITLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("--title attend une valeur");
  });

  // P6 — un flag booléen ne consomme JAMAIS le token suivant.
  it("P6 — flag booléen : pas de consommation du token suivant", () => {
    const r = parseFlags(["--with-test", "INFRA-1"], { "with-test": "boolean" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.flags["with-test"]).toBe("true");
    expect(r.value.positionals).toEqual(["INFRA-1"]);
  });

  it("P7 — flag booléen avec =valeur échoue", () => {
    const r = parseFlags(["--with-test=1"], { "with-test": "boolean" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("--with-test n'attend pas de valeur");
  });

  // P8 — typo aujourd'hui ignorée en silence : elle devient une erreur.
  it("P8 — flag inconnu échoue et liste les attendus", () => {
    const r = parseFlags(["--titre", "x"], TITLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("flag inconnu : --titre");
    expect(r.error).toContain("--title");
  });

  it("P9 — flag sur une commande sans flag échoue", () => {
    const r = parseFlags(["--x"], {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("n'accepte aucun flag");
  });

  it("P10 — positionnels et flags mélangés : ordre des positionnels préservé", () => {
    const r = parseFlags(["A", "--title", "t", "B"], TITLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.positionals).toEqual(["A", "B"]);
    expect(r.value.flags.title).toBe("t");
  });

  it("P11 — flag répété : la dernière occurrence gagne", () => {
    const r = parseFlags(["--title", "a", "--title", "b"], TITLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.flags.title).toBe("b");
  });

  // P12b — la spec est consultée en propriété PROPRE : sans ça, `spec["toString"]`
  // renvoie la fonction héritée d'Object.prototype → le flag passe pour déclaré,
  // avale le token suivant et recrée le silence que ce ticket supprime.
  it("P12b — un nom hérité d'Object.prototype reste un flag inconnu", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty"]) {
      const r = parseFlags([`--${name}`, "x"], TITLE);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toContain(`flag inconnu : --${name}`);
    }
    // Symétrique : côté « token suivant », un nom hérité n'est pas un flag déclaré,
    // donc il reste une VALEUR légitime (pas de faux « est un flag de cette commande »).
    const v = parseFlags(["--title", "--toString"], TITLE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.flags.title).toBe("--toString");
  });

  it("P12 — le = n'est coupé qu'une fois", () => {
    const bare = parseFlags(["--title", "a=b=c"], TITLE);
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.value.flags.title).toBe("a=b=c");
    const eq = parseFlags(["--title=a=b"], TITLE);
    expect(eq.ok).toBe(true);
    if (eq.ok) expect(eq.value.flags.title).toBe("a=b");
  });
});

// INFRA-33 — même défaut vu depuis la surface de commande : la valeur absurde ne
// doit jamais atteindre le disque.
describe("backlog CLI — valeurs de flag (INFRA-33)", () => {
  let root: string;
  const specFile = () => path.join(root, "specs", "infra-99.md");

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-flags-"));
    await mkdir(path.join(root, "specs"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // P13 — reproduction exacte du 2026-07-20 : le titre commence par `--`.
  it("P13 — new --title « --review … » pose le vrai titre", async () => {
    const title = "--review obligatoire a la maturation";
    const r = await runBacklogCommand(
      ["new", "INFRA-99", "--title", title, "--priority", "should"],
      { root },
    );
    expect(r.code).toBe(0);
    const fm = parseTicketFile(await readFile(specFile(), "utf8")).frontmatter;
    expect(fm.title).toBe(title);
    expect(fm.priority).toBe("should");
  });

  it("P14 — new --title sans valeur échoue sans rien créer", async () => {
    const r = await runBacklogCommand(["new", "INFRA-99", "--title"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--title attend une valeur");
    await expect(readFile(specFile(), "utf8")).rejects.toThrow();
  });

  it("P15 — new --priority sans valeur échoue sans rien créer", async () => {
    const r = await runBacklogCommand(["new", "INFRA-99", "--title", "t", "--priority"], {
      root,
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--priority attend une valeur");
    await expect(readFile(specFile(), "utf8")).rejects.toThrow();
  });

  it("P16 — mature --date sans valeur échoue et laisse le ticket intact", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      ["mature", "INFRA-99", "--model", "sonnet", "--effort", "think", "--review", "none", "--date"],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--date attend une valeur");
    const fm = parseTicketFile(await readFile(specFile(), "utf8")).frontmatter;
    expect(fm.status).toBe("maturing");
    expect(fm.exec).toBeUndefined();
  });

  it("P17 — mature --model suivi d'un flag échoue et laisse le ticket intact", async () => {
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
    const r = await runBacklogCommand(
      ["mature", "INFRA-99", "--model", "--effort", "think", "--review", "none", "--date", "2026-07-20"],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--model");
    const fm = parseTicketFile(await readFile(specFile(), "utf8")).frontmatter;
    expect(fm.status).toBe("maturing");
    expect(fm.exec).toBeUndefined();
  });

  it("P18 — new avec un flag inconnu échoue sans rien créer", async () => {
    const r = await runBacklogCommand(["new", "INFRA-99", "--titre", "t"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("flag inconnu");
    await expect(readFile(specFile(), "utf8")).rejects.toThrow();
  });
});

// BLG-06 — mature valide la cohérence du triplet (effort high|xhigh|max ⇒ opus),
// avec override explicite --override-coherence (geste, pas de justification écrite).
describe("backlog CLI — mature cohérence du triplet (BLG-06)", () => {
  let root: string;
  const file = () => path.join(root, "specs", "infra-99.md");
  const fmOf = async () => parseTicketFile(await readFile(file(), "utf8")).frontmatter;
  const snapshot = async () =>
    JSON.parse(await readFile(path.join(root, "backlog.json"), "utf8"));

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-cli-coherence-"));
    await mkdir(path.join(root, "specs"), { recursive: true });
    await runBacklogCommand(["new", "INFRA-99", "--epic", "e"], { root });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const mature = (extra: string[]) =>
    runBacklogCommand(
      ["mature", "INFRA-99", "--review", "light", "--date", "2026-08-23", ...extra],
      { root },
    );

  // BC1 — les trois paliers du plancher (high/xhigh/max) refusent sonnet.
  for (const effort of ["high", "xhigh", "max"]) {
    it(`BC1 — --effort ${effort} --model sonnet refusé, ticket intact`, async () => {
      const r = await mature(["--model", "sonnet", "--effort", effort]);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/sonnet/i);
      expect(r.stderr).toMatch(/opus/i);
      const fm = await fmOf();
      expect(fm.status).toBe("maturing");
      expect(fm.exec).toBeUndefined();
    });
  }

  // BC2 — high + opus : accepté (satisfait le plancher).
  it("BC2 — --effort high --model opus accepté", async () => {
    const r = await mature(["--model", "opus", "--effort", "high"]);
    expect(r.code).toBe(0);
    expect((await fmOf()).exec?.model).toBe("opus");
  });

  // BC3 — low + opus : accepté, la réciproque n'est jamais contrôlée (D1).
  it("BC3 — --effort low --model opus accepté (réciproque non contrôlée)", async () => {
    const r = await mature(["--model", "opus", "--effort", "low"]);
    expect(r.code).toBe(0);
    expect((await fmOf()).exec?.model).toBe("opus");
  });

  // BC4 — medium + sonnet : accepté, aucun plancher à cet effort.
  it("BC4 — --effort medium --model sonnet accepté", async () => {
    const r = await mature(["--model", "sonnet", "--effort", "medium"]);
    expect(r.code).toBe(0);
    expect((await fmOf()).exec?.model).toBe("sonnet");
  });

  // BC5 — le contrôle voit l'effort NORMALISÉ, pas la chaîne brute legacy (D1) :
  // think-hard vaut high, donc sonnet est refusé exactement comme --effort high.
  it("BC5 — --effort think-hard --model sonnet refusé (normalisé en high)", async () => {
    const r = await mature(["--model", "sonnet", "--effort", "think-hard"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/sonnet/i);
    const fm = await fmOf();
    expect(fm.status).toBe("maturing");
    expect(fm.exec).toBeUndefined();
  });

  // BC6 — fable n'est pas classé dans l'échelle (D3) : refusé sous le plancher,
  // avec un message DISTINCT de celui de sonnet (below-floor vs unclassified).
  it("BC6 — --effort high --model fable refusé, message distinct de sonnet", async () => {
    const rFable = await mature(["--model", "fable", "--effort", "high"]);
    expect(rFable.code).not.toBe(0);
    const rSonnet = await mature(["--model", "sonnet", "--effort", "high"]);
    expect(rSonnet.code).not.toBe(0);
    expect(rFable.stderr).not.toBe(rSonnet.stderr);
    expect(rFable.stderr).toMatch(/fable/i);
    // messages distincts : fable est « non classé », sonnet est « sous le plancher ».
    expect(rFable.stderr).toMatch(/class/i);
    expect(rSonnet.stderr).not.toMatch(/class/i);
    const fm = await fmOf();
    expect(fm.status).toBe("maturing");
    expect(fm.exec).toBeUndefined();
  });

  // BC7 — --override-coherence fait passer chacun des cas refusés, et écrit le ticket.
  it("BC7 — --override-coherence fait passer un triplet incohérent", async () => {
    const r = await mature([
      "--model",
      "sonnet",
      "--effort",
      "high",
      "--override-coherence",
    ]);
    expect(r.code).toBe(0);
    const fm = await fmOf();
    expect(fm.status).toBe("todo");
    expect(fm.exec).toEqual({
      model: "sonnet",
      effort: "high",
      review: "light",
      matured: "2026-08-23",
    });
  });

  // BC7b — --override-coherence fait passer AUSSI le cas unclassified (fable),
  // pas seulement below-floor (sonnet) — D4 ne distingue pas les deux raisons.
  it("BC7b — --override-coherence fait passer le cas fable (unclassified)", async () => {
    const r = await mature([
      "--model",
      "fable",
      "--effort",
      "high",
      "--override-coherence",
    ]);
    expect(r.code).toBe(0);
    const fm = await fmOf();
    expect(fm.status).toBe("todo");
    expect(fm.exec).toEqual({
      model: "fable",
      effort: "high",
      review: "light",
      matured: "2026-08-23",
    });
  });

  // BC8 — --override-coherence sur un triplet DÉJÀ cohérent est accepté sans effet
  // (pas d'erreur « override inutile »).
  it("BC8 — --override-coherence sur triplet cohérent n'échoue pas", async () => {
    const r = await mature([
      "--model",
      "opus",
      "--effort",
      "high",
      "--override-coherence",
    ]);
    expect(r.code).toBe(0);
    expect((await fmOf()).exec?.model).toBe("opus");
  });

  // BC9 — le drapeau ne prend pas de valeur : mal formé comme tout flag booléen.
  it("BC9 — --override-coherence=oui échoue (flag mal formé)", async () => {
    const r = await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "opus",
        "--effort",
        "high",
        "--review",
        "light",
        "--date",
        "2026-08-23",
        "--override-coherence=oui",
      ],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--override-coherence n'attend pas de valeur");
    const fm = await fmOf();
    expect(fm.status).toBe("maturing");
    expect(fm.exec).toBeUndefined();
  });

  // BC10 — `--override-coherence` est booléen : il ne consomme JAMAIS le token
  // suivant. `false` derrière lui devient donc un positionnel superflu — un
  // opérateur qui tape `--override-coherence false` pour dire « non » doit être
  // REFUSÉ, pas voir son intention inversée en silence (l'override s'activerait
  // quand même puisque le flag est présent).
  it("BC10 — --override-coherence suivi d'un token positionnel échoue, ticket intact", async () => {
    const r = await runBacklogCommand(
      [
        "mature",
        "INFRA-99",
        "--model",
        "sonnet",
        "--effort",
        "high",
        "--review",
        "light",
        "--date",
        "2026-08-23",
        "--override-coherence",
        "false",
      ],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("false");
    const fm = await fmOf();
    expect(fm.status).toBe("maturing");
    expect(fm.exec).toBeUndefined();
  });

  // BC11 — périmètre RÉEL du contrôle (portée BLG-06 : « propre à `mature` ») :
  // un `.md` déjà maturé avec un triplet incohérent (écrit à la main, ticket
  // historique) traverse `snapshot` sans être rejeté, ET le `.md` sur disque
  // reste OCTET POUR OCTET intact — pas seulement « validateTicket ne throw
  // pas », mais le chemin CLI réel emprunté par /deploy en routine.
  it("BC11 — snapshot d'un .md déjà maturé au triplet incohérent : accepté, .md intact", async () => {
    const legacy =
      "---\nid: INFRA-99\ntype: ticket\nstatus: todo\nepic: e\nexec:\n  model: sonnet\n  effort: high\n  matured: 2026-05-01\n---\n\n# INFRA-99\n";
    await writeFile(file(), legacy, "utf8");

    const r = await runBacklogCommand(["snapshot"], { root });

    expect(r.code).toBe(0);
    expect(await readFile(file(), "utf8")).toBe(legacy);
    const snap = await snapshot();
    const t = snap.tickets.find((t: { id: string }) => t.id === "INFRA-99");
    expect(t).toBeTruthy();
    expect(t.exec).toEqual({ model: "sonnet", effort: "high", matured: "2026-05-01" });
  });
});

// INFRA-42 — `new` scaffolde le squelette de sections (par kind + override projet)
// dans le corps, à la création. Réutilise resolveCoreSections + scaffoldSections
// (INFRA-41) : la structure appartient à l'outil, pas à la mémoire de l'agent.
describe("backlog CLI — new scaffolde le squelette (INFRA-42)", () => {
  let root: string;
  const bodyOf = async (id: string) =>
    readFile(path.join(root, "specs", `${id.toLowerCase()}.md`), "utf8");

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-new-scaffold-"));
    await mkdir(path.join(root, "specs"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const FEATURE_HEADINGS = TICKET_SPEC_SECTIONS.feature.core.map((s) => s.heading);
  const BUG_HEADINGS = TICKET_SPEC_SECTIONS.bug.core.map((s) => s.heading);

  it("Q1 — new sans kind → le corps porte les 6 sections feature", async () => {
    const r = await runBacklogCommand(["new", "FOO-01"], { root });
    expect(r.code).toBe(0);
    const raw = await bodyOf("FOO-01");
    for (const h of FEATURE_HEADINGS) expect(raw).toContain(`## ${h}`);
    expect(raw).toContain("## Problème");
    expect(raw).not.toContain("## Symptôme");
  });

  it("Q2 — new --kind bug → 6 sections bug + kind: bug au frontmatter", async () => {
    const r = await runBacklogCommand(["new", "BUG-01", "--kind", "bug"], { root });
    expect(r.code).toBe(0);
    const raw = await bodyOf("BUG-01");
    for (const h of BUG_HEADINGS) expect(raw).toContain(`## ${h}`);
    expect(raw).toContain("## Symptôme");
    expect(raw).not.toContain("## Problème");
    expect(parseTicketFile(raw).frontmatter.kind).toBe("bug");
  });

  it("Q3 — override projet présent → new pose LES sections de l'override", async () => {
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(
      path.join(root, ".claude", "ticket-sections.json"),
      JSON.stringify({
        feature: ["Contexte projet", "But", "Tests"],
        bug: ["Bug", "Fix"],
        optional: [],
      }),
      "utf8",
    );
    const r = await runBacklogCommand(["new", "FOO-02"], { root });
    expect(r.code).toBe(0);
    const raw = await bodyOf("FOO-02");
    expect(raw).toContain("## Contexte projet");
    expect(raw).toContain("## But");
    // le défaut global n'est PAS posé quand un override existe
    expect(raw).not.toContain("## Problème");
    expect(raw).not.toContain("## Décision");
  });

  it("Q4 — cohérence new ↔ brief : new produit déjà le corps que brief re-poserait", async () => {
    await runBacklogCommand(["new", "FOO-03"], { root });
    const afterNew = await bodyOf("FOO-03");
    // brief (idempotent) sur le ticket fraîchement créé ne change RIEN → preuve que
    // `new` a posé exactement le squelette d'INFRA-41 (même réutilisation, même kind).
    const r = await runBacklogCommand(["brief", "FOO-03"], { root });
    expect(r.code).toBe(0);
    expect(await bodyOf("FOO-03")).toBe(afterNew);
  });

  it("Q5 — non-régression : new sur id existant échoue ; le shell scaffoldé round-trip", async () => {
    await runBacklogCommand(["new", "FOO-04"], { root });
    const dup = await runBacklogCommand(["new", "FOO-04"], { root });
    expect(dup.code).not.toBe(0);
    expect(dup.stderr).toMatch(/existe|exist/i);
    // parse → serialize du corps scaffoldé : round-trip stable (pas de shell cassé)
    const raw = await bodyOf("FOO-04");
    const parsed = parseTicketFile(raw);
    expect(parsed.frontmatter.id).toBe("FOO-04");
    expect(serializeTicketFile(parsed.frontmatter, parsed.body)).toBe(raw);
  });
});

// BLG-08 (finding #11, reprise) — les tests de câblage `escalations` ont
// déménagé dans escalations-cli.test.ts, en face du fichier qui les câble
// réellement (lib/backlog/escalations-cli.ts, extrait de cli.ts pour ne pas
// ajouter au fichier déjà > 800 lignes — CLAUDE.md global).
