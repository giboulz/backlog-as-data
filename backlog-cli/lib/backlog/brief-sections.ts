// INFRA-41 — Cœur pur, partagé, du scaffolding de brief. Généralise
// `scaffoldBriefSections` (INFRA-39, épic) en fonction paramétrée par une LISTE de
// sections → une seule implémentation testée, consommée par `epic brief` ET
// `ticket brief`. Aucun I/O, aucune connaissance des types épic/ticket.

/** Une section de brief : son titre `## <heading>` + le placeholder posé si absente. */
export interface BriefSection {
  heading: string;
  placeholder: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Un titre `## <heading>` (trim) est-il déjà présent dans le corps ? Robuste au
 * CRLF (le `$` de la regex multi-ligne matche avant `\r`). Exporté : les helpers de
 * complétude/marqueur (INFRA-40) réutilisent ce matching unique.
 */
export const hasHeading = (body: string, heading: string): boolean =>
  new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").test(body);

/**
 * Ajoute au corps les seules sections absentes de `sections`, sans rien toucher
 * d'autre. Pure et idempotente : rejouée sur un corps déjà complet, renvoie le
 * corps inchangé (référentiellement égal). Non destructive : une section présente
 * (même rédigée à la main) est préservée telle quelle.
 *
 * BLG-03 (finding #5) — chaque section manquante est insérée à sa PLACE
 * canonique : juste avant la prochaine section de `sections` déjà présente
 * dans le corps (pas systématiquement en fin de fichier). Sans ça, un
 * rattrapage sur un corps déjà brief-managé auquel une section a été insérée
 * au MILIEU de la liste canonique (ex. « Décisions transverses », D1 de
 * BLG-03) l'atterrirait après toutes les sections déjà rédigées — la mauvaise
 * place, précisément le défaut que la section neuve devait fermer. Si aucune
 * section suivante n'est encore présente (cas du corps entièrement vide, ou
 * de la queue de la liste), le comportement historique — ajout en fin —
 * s'applique tel quel.
 */
export function scaffoldSections(
  body: string,
  sections: readonly BriefSection[],
): string {
  const missing = sections.filter((s) => !hasHeading(body, s.heading));
  if (missing.length === 0) return body;

  let out = body.replace(/\s*$/, "\n");
  for (const section of missing) {
    const idx = sections.indexOf(section);
    const block = `## ${section.heading}\n\n${section.placeholder}\n`;
    let anchor: RegExpExecArray | null = null;
    for (let i = idx + 1; i < sections.length; i++) {
      const re = new RegExp(`^##\\s+${escapeRegExp(sections[i]!.heading)}\\s*$`, "m");
      const m = re.exec(out);
      if (m) {
        anchor = m;
        break;
      }
    }
    if (anchor) {
      out = out.slice(0, anchor.index) + block + "\n" + out.slice(anchor.index);
    } else {
      out = `${out.replace(/\s*$/, "\n")}\n${block}`;
    }
  }
  return out;
}
