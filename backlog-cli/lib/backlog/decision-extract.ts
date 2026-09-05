// INFRA-15 — Extraction ADR pure (date de décision + conditions de réouverture)
// depuis le corps d'un ticket. Vit dans lib/backlog/ pour être exécutée à la
// GÉNÉRATION du snapshot (le CLI a déjà le corps), sans dépendance vers lib/admin.
// Logique héritée d'ADMIN-08 (anciennement dans decisions-parser.ts).

export interface DecisionFields {
  /** Date de décision (1ʳᵉ occurrence ISO `YYYY-MM-DD` dans le corps), ou null. */
  decidedAt: string | null;
  /** Conditions de réouverture (bullets sous « À ré-évaluer si : » / variantes). */
  reviewTriggers: string[];
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

const TRIGGER_HEADER_RE =
  /^\s*\**\s*(?:à\s+ré-évaluer\s+si|à\s+reconsidérer\s+si|re-trigger)\s*:?\s*\**\s*$/i;

const BULLET_RE = /^\s*-\s+(.+)$/;

/** Première date ISO rencontrée dans le corps, ou null. */
export function extractDecidedAt(body: string): string | null {
  const match = body.match(DATE_RE);
  return match ? match[1]! : null;
}

/**
 * Bullets suivant la première en-tête de réouverture (`À ré-évaluer si :`,
 * `À reconsidérer si :`, `Re-trigger :`, avec ou sans gras), jusqu'à la première
 * ligne vide non précédée de bullet ou la première ligne non-bullet.
 */
export function extractReviewTriggers(body: string): string[] {
  // INFRA-21 — split tolérant CRLF (aligné deriveTitleFromBody). Sinon le `\r`
  // final d'un corps Windows fait échouer BULLET_RE (`.`/`$` n'absorbent pas `\r`)
  // → triggers vidés → backlog.json désync Windows↔Linux → H3 casse sur le CI.
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!TRIGGER_HEADER_RE.test(lines[i]!.trim())) continue;
    const triggers: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() === "") {
        if (triggers.length === 0) continue;
        break;
      }
      const bulletMatch = next.match(BULLET_RE);
      if (bulletMatch) {
        triggers.push(bulletMatch[1]!.trim());
      } else {
        break;
      }
    }
    return triggers;
  }
  return [];
}

/** Champs ADR scannables d'un corps de ticket parked/wont. */
export function extractDecision(body: string): DecisionFields {
  return {
    decidedAt: extractDecidedAt(body),
    reviewTriggers: extractReviewTriggers(body),
  };
}
