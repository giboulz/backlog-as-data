import {
  ok,
  err,
  parseFlags,
  type CliResult,
  type FlagSpec,
} from "./cli";
import {
  closeEscalation,
  findEscalationsAndWarnings,
  type EscalationWarning,
} from "./escalations";

// BLG-08 — Sous-commandes `npm run backlog -- escalations <…>`, extraites de
// cli.ts (déjà > 800 lignes avant ce ticket — CLAUDE.md global § « Fichier >
// 800 lignes à découper AVANT d'y ajouter ») pour ne pas y ajouter de
// fonctions. Parité avec epic-cli.ts.

const ESCALATIONS_FLAGS: FlagSpec = { all: "boolean" };
const ESCALATIONS_CLOSE_FLAGS: FlagSpec = { by: "value", date: "value", which: "value" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * BLG-11 (D3, finding #1/#3) — une ligne par touche D2, écrite sur stderr :
 * fichier, ligne, titre — de quoi corriger sans relancer d'inventaire.
 * N'affecte ni stdout ni le code de retour (posés par l'appelant). `warnings`
 * arrive déjà trié (`findEscalationsAndWarnings`, point unique — pas de
 * second tri ici, sans quoi le tri redevient un détail d'appelant plutôt
 * qu'une garantie de la lib).
 */
function formatWarnings(warnings: EscalationWarning[]): string {
  return warnings
    .map(
      (w) =>
        `${w.file}:${w.line} : le titre « ${w.title} » contient un token d'escalade (E1/E3) sans commencer par lui — signalé, non listé (corriger le titre à la source)`,
    )
    .join("\n");
}

/**
 * `escalations [--all]` — D5 : liste triée par id de ticket (comparateur
 * PARTAGÉ `byCodeUnit`, celui de `buildSnapshot` — un ordre solidaire du
 * reste du backlog, jamais recodé à la main ici), lisible au grep.
 * ⛔ Aucun positionnel : contrairement à `brief <ID>`/`set <ID>`, `escalations`
 * ne filtre pas par ticket — un token en trop est une INTENTION mal
 * comprise (« je veux restreindre à ce ticket »), pas du bruit à absorber.
 */
async function cmdEscalations(args: string[], specsDir: string): Promise<CliResult> {
  const parsed = parseFlags(args, ESCALATIONS_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { positionals, flags } = parsed.value;
  if (positionals.length > 0) {
    return err(
      `escalations n'accepte aucun positionnel (seul --all est reconnu) — superflu : ${positionals.join(", ")}`,
    );
  }
  const showAll = Boolean(flags.all);

  // BLG-11 (finding #3) — UN scan du corpus (escalades + avertissements
  // D2 en une seule passe), pas deux appels séparés qui reparseraient
  // chacun tous les fichiers. Les avertissements vont sur stderr, code 0,
  // quel que soit `--all` (D3/test 9) : ils ne participent ni à la liste ni
  // au filtre ouvertes/closes.
  const { escalations: found, warnings } = await findEscalationsAndWarnings(specsDir);
  const stderr = formatWarnings(warnings);

  const list = showAll ? found : found.filter((e) => !e.closed);
  if (list.length === 0) {
    return { code: 0, stdout: showAll ? "aucune escalade." : "aucune escalade ouverte.", stderr };
  }

  const lines = list.map((e) => {
    const base = `${e.ticketId} · ${e.file}:${e.line} · ${e.title}`;
    return e.closed ? `${base} · traitée par ${e.closed.by} (${e.closed.date})` : base;
  });
  return { code: 0, stdout: lines.join("\n"), stderr };
}

/**
 * `escalations close <TICKET-ID> --by <TICKET-ID> --date <YYYY-MM-DD> [--which …]`
 * — D3/D4 : `--date` explicite (invariant du CLI : la date n'est jamais
 * inventée, même règle que `mature`) ; `--which` requis dès que le ticket
 * porte plusieurs escalades (`closeEscalation` liste alors les candidates).
 * ⛔ Un seul positionnel (l'ID) : un `--which` tapé sans son drapeau (ex.
 * `close SKILL-79 E3 --by …`) doit échouer, pas se faire absorber en silence
 * — même garde que `cmdMature`/`cmdSet` (BLG-06/BLG-05).
 */
async function cmdEscalationsClose(args: string[], specsDir: string): Promise<CliResult> {
  const parsed = parseFlags(args, ESCALATIONS_CLOSE_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { positionals, flags } = parsed.value;
  const id = positionals[0];
  if (!id) {
    return err(
      "usage: escalations close <TICKET-ID> --by <TICKET-ID> --date <YYYY-MM-DD> [--which <tag>]",
    );
  }
  if (positionals.length > 1) {
    return err(
      `escalations close n'accepte qu'un seul positionnel (l'ID) — superflu : ${positionals
        .slice(1)
        .join(", ")} (un tag --which doit suivre son drapeau : --which <tag>)`,
    );
  }
  if (!flags.by) return err("--by <TICKET-ID> requis");
  if (!flags.date) return err("--date <YYYY-MM-DD> requis (le script n'invente pas la date)");
  if (!DATE_RE.test(flags.date)) return err(`--date attend le format YYYY-MM-DD → « ${flags.date} »`);

  const res = await closeEscalation(specsDir, id, {
    by: flags.by,
    date: flags.date,
    which: flags.which,
  });
  if (!res.ok) return err(res.error);
  return ok(`${id} → escalade ${res.escalation.which} close (par ${flags.by}, ${flags.date})`);
}

export async function runEscalationsCommand(
  args: string[],
  specsDir: string,
): Promise<CliResult> {
  const [sub, ...rest] = args;
  if (sub === "close") return cmdEscalationsClose(rest, specsDir);
  return cmdEscalations(args, specsDir);
}
