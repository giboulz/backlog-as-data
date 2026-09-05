// SKILL-46 — l'Étape 6.7 relève `<sha_final>` APRÈS le rebase de `/send`,
// jamais avant.
//
// Constaté à l'intégration de SKILL-28 (2026-08-22, specs/skill-46.md
// § Problème) : l'ancienne Étape 6.7 relevait `git rev-parse HEAD` avant
// d'exécuter `/send`, dont la première commande de fond est un `git rebase
// main` (Étape 3 de `commands/send.md`) — qui réécrit tous les commits de la
// branche. Le SHA relevé était donc mort au moment où il aurait été affiché
// ou persisté.
//
// ⚠️ Chaque test documente la MUTATION qui doit le faire rougir (convention
// D3, cf. specs/skill-46.md § Tests). Ancres bornées à la section "## Étape
// 6.7" → "## Étape 6.8", jamais un `includes` sur le fichier entier (leçon
// SKILL-26, finding 4).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { sectionEntre } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const FILE = 'commands/sdd-run-ticket.md';

function readSkill() {
  return fs.readFileSync(path.join(REPO_ROOT, FILE), 'utf8');
}

function etape67() {
  return sectionEntre(readSkill(), '## Étape 6.7', '## Étape 6.8', FILE);
}

describe('SKILL-46 — le relevé de `<sha_final>` a lieu APRÈS le rebase de `/send`', () => {
  // ⚠️ Mutation-témoin : remettre `git rev-parse HEAD` dans le premier bloc
  // bash de l'Étape 6.7 (celui exécuté AVANT `Puis exécuter /send`) → rougit.
  // C'est précisément le mode de défaillance de SKILL-28 : un SHA relevé avant
  // le rebase est mort au moment où il serait enregistré.
  it('le premier bloc bash de l’Étape 6.7 (avant `/send`) ne relève PAS `HEAD`', () => {
    const section = etape67();
    expect(section, `${FILE} : section "## Étape 6.7" introuvable.`).not.toBeNull();
    const iSend = section.indexOf('Puis exécuter `/send`');
    expect(iSend, `${FILE} : phrase "Puis exécuter \`/send\`" introuvable en 6.7.`).toBeGreaterThan(-1);
    const avant = section.slice(0, iSend);
    expect(
      /git rev-parse HEAD/.test(avant),
      `${FILE} : l'Étape 6.7 relève encore \`HEAD\` AVANT d'exécuter \`/send\` — ` +
        `c'est le SHA mort après rebase (constat SKILL-28).`
    ).toBe(false);
  });

  // ⚠️ Mutation-témoin : supprimer le paragraphe qui prescrit de relever le
  // SHA après l'Étape 3 de `/send` (ou le déplacer avant la phrase « Puis
  // exécuter `/send` ») → rougit.
  it('le relevé de `HEAD` est prescrit explicitement APRÈS l’Étape 3 de `/send`', () => {
    const section = etape67();
    const iSend = section.indexOf('Puis exécuter `/send`');
    const iApres = section.indexOf("après avoir exécuté l'Étape 3 de `/send`");
    expect(
      iApres,
      `${FILE} : l'Étape 6.7 ne prescrit plus explicitement de relever le SHA ` +
        `APRÈS l'Étape 3 de \`/send\`.`
    ).toBeGreaterThan(-1);
    expect(iApres, `${FILE} : la prescription doit suivre « Puis exécuter \`/send\` », pas la précéder.`).toBeGreaterThan(
      iSend
    );
    const apres = section.slice(iApres);
    expect(
      /git rev-parse HEAD/.test(apres),
      `${FILE} : aucune commande \`git rev-parse HEAD\` ne suit la prescription « après l'Étape 3 de \`/send\` ».`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer l'avertissement explicite « ne relève pas
  // avant » → rougit. Sans lui, un orchestrateur pressé peut recopier
  // l'ancien réflexe (relever le SHA tout de suite après le `git status`).
  it('un avertissement explicite interdit de relever `<sha_final>` avant `/send`', () => {
    const section = etape67();
    expect(
      /Ne relève PAS `<sha_final>` avant d'exécuter `\/send`/.test(section),
      `${FILE} : l'Étape 6.7 n'avertit plus explicitement de ne pas relever ` +
        `\`<sha_final>\` avant \`/send\`.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer la mention du fast-forward comme non
  // réécrivant (ou l'affaiblir en « le rebase ne réécrit rien ») → rougit.
  // Sans elle, un lecteur peut croire que c'est n'importe quelle étape de
  // `/send` qui invalide le SHA, pas spécifiquement le rebase.
  //
  // ⚠️ Bornée à la SOUS-SECTION elle-même (son propre titre → le prochain
  // `---`), jamais à toute l'Étape 6.7 : « fast-forward » apparaît aussi dans
  // le préambule (l.1159, prose PRÉEXISTANTE, non ajoutée par ce ticket) — un
  // `.*`/`[\s\S]*` non borné s'y raccrocherait et resterait vert même si la
  // phrase de CETTE sous-section disait le contraire (§ Tests, interdits
  // #1/#3/#4 : pas de `.*` en mode `s` reliant deux ancres éloignées, pas de
  // satisfaction par de la prose préexistante, pas de fenêtre glissante en
  // octets). Aucun `.*`/`[\s\S]*` ici : une phrase EXACTE, sur un texte
  // aplati (le skill est dur-wrappé à ~78 colonnes, cf. § Tests).
  it('le fast-forward est explicitement distingué du rebase (lui ne réécrit rien)', () => {
    const raw = readSkill();
    const sousSection = sectionEntre(
      raw,
      "### Le `<sha_final>` se relève APRÈS le rebase de `/send`, jamais avant",
      '---',
      FILE
    );
    const flat = sousSection.replace(/\s+/g, ' ');
    expect(
      flat.includes("Le fast-forward de l'Étape 4 de `/send`, lui, ne réécrit rien"),
      `${FILE} : la sous-section "### Le <sha_final> se relève…" ne dit plus ` +
        `explicitement que le fast-forward (contrairement au rebase) ne réécrit rien.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin (gate de revue, finding nº 10) : retirer le paragraphe
  // qui couvre l'échec de l'Étape 3 de `/send` (ou son absence d'exécution) →
  // rougit. Sans lui, rien ne dit quoi faire quand `/send` s'arrête avant
  // d'avoir produit le SHA que cette sous-section prescrit de relever — le
  // seul `<sha_final>` disponible disparaîtrait sans qu'aucune consigne ne le
  // couvre.
  it('un paragraphe couvre l’échec (ou la non-exécution) de l’Étape 3 de `/send`', () => {
    const raw = readSkill();
    const sousSection = sectionEntre(
      raw,
      "### Le `<sha_final>` se relève APRÈS le rebase de `/send`, jamais avant",
      '---',
      FILE
    );
    const flat = sousSection.replace(/\s+/g, ' ');
    expect(
      flat.includes("tu n'as **aucun** `<sha_final>` à relever"),
      `${FILE} : aucun paragraphe ne couvre le cas où l'Étape 3 de \`/send\` ` +
        `échoue ou n'est pas atteinte.`
    ).toBe(true);
    expect(
      flat.includes('Exit code non-zéro à'),
      `${FILE} : ce paragraphe ne renvoie plus à la règle générale de \`/send\` ` +
        `(« Exit code non-zéro à n'importe quelle étape → stopper »).`
    ).toBe(true);
  });
});
