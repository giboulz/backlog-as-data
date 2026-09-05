// Le contrôle des dispositions `corrigé (<sha>)` à l'Étape 6.6 — l'ancre des
// SHA légitimes, et le détecteur de mauvaise cible qui le précède.
//
// SKILL-76 (2026-08-27) a établi le fond du problème : `A..HEAD` ne veut dire
// « commits ajoutés depuis A » QUE si `A` est un ancêtre de `HEAD` — condition
// qu'un `--amend` (ou un rebase) détruit sans le signaler, la plage sortant
// quand même en `exit 0` et rendant, une fois la pointe éloignée, des commits
// ÉTRANGERS au ticket. Sa réponse était un prédicat
// (`git merge-base --is-ancestor <SHA_IMPL> HEAD`) joué AVANT la plage, et DEUX
// RÉGIMES de conduite branchés sur son code de sortie.
//
// ⚠️ SKILL-80 (2026-08-28) retire cette construction à deux régimes. Le défaut
// n'était pas la règle du régime réécrit (« le SHA annoncé doit être `HEAD` »)
// mais l'ANCRE elle-même : `<SHA_IMPL>` est relevé à l'Étape 6.1 et un amend, un
// rebase ou toute réécriture le périme. Les deux régimes rattrapaient cette
// caducité après coup, chacun avec son angle mort — la plage `<SHA_IMPL>..HEAD`
// offre des commits étrangers en régime réécrit (motif de SKILL-76), et `HEAD`
// seul est trop étroit dès qu'un second commit LICITE suit l'amend (le
// `chore(backlog): new <id>` qu'un finding classé E2 impose à l'implémenteur :
// ses corrections se retrouvent alors en `HEAD~1`, et le contrôle accusait un
// travail correct — specs/skill-80.md § Symptôme).
//
// L'ancre est désormais `main..HEAD`, sans condition : les commits propres à la
// branche du ticket. Mesuré au banc le 2026-08-28 (dépôt jetable), une mesure par
// question — aucun chiffre n'est reporté d'une question à une autre :
//   - après un `--amend` : bien défini, rend le seul commit de la branche ;
//   - après un REBASE sur une pointe avancée : `main..HEAD` rend 1 commit, là où
//     l'ancienne plage `<SHA_IMPL>..HEAD` en rendait 3, dont 2 ÉTRANGERS (des
//     commits que le `main` avancé venait d'apporter). C'est de ce cas-là, et de
//     lui seul, que vient le « 3 dont 2 étrangers » ;
//   - BRANCHE SŒUR : le commit sœur est simplement ABSENT de `main..HEAD` (aucun
//     comptage de `<SHA_IMPL>..HEAD` n'a été joué sur ce cas) ; `is-ancestor`
//     rendait 1 sur ce même SHA, d'où l'insuffisance de l'issue 1 de l'escalade ;
//   - cas de l'escalade : le SHA en `HEAD~1` y figure bien.
// Le contenu se vérifie sur le SHA ANNONCÉ, jamais sur la pointe
// (specs/skill-80.md, D1/D2/D3).
//
// ⚠️ Une borne que l'appartenance à `main..HEAD` ne donne PAS, et qu'il a fallu
// écrire à part : `<SHA_IMPL>` lui-même est membre de cette plage tant que le
// commit relu reste atteignable — c'est-à-dire dans le régime le plus fréquent,
// celui où l'implémenteur AJOUTE un commit de correction. L'ancienne plage
// `<SHA_IMPL>..HEAD` l'excluait par construction (elle sortait VIDE quand rien
// n'avait été ajouté) ; `main..HEAD` ne le fait pas. Sans borne explicite, un
// implémenteur qui n'a rien corrigé et réannonce le commit relu passait le
// contrôle. Mesuré au banc le 2026-08-28 : `main..HEAD` contient bien
// `<SHA_IMPL>` (9afaf3b), quand `<SHA_IMPL>..HEAD` rend une sortie vide. La puce
// exclut donc `<SHA_IMPL>` nommément, et le test ci-dessous le verrouille.
// L'exclusion ne coûte aucun cas licite : mesuré au même banc, la vraie
// correction ajoutée (0a6569a) survit à l'exclusion, et un `<SHA_IMPL>` ne peut
// par définition porter aucune correction — c'est le commit dont les findings
// sont sortis.
//
// ⚠️ Ce que SKILL-80 ne retire PAS : le prédicat lui-même, dont le rôle devient
// la détection du seul cas qui reste un branchement — l'exit **128**
// (`<SHA_IMPL>` n'est un objet connu d'AUCUNE branche du dépôt interrogé, donc
// `<WORKTREE_IMPL>` mal résolu), mesuré au banc par SKILL-76 puis reconfirmé le
// 2026-08-28. Lire ce 128 comme « pas 0 » certifierait le `HEAD` d'un arbre
// étranger. Le test « exit 128 » ci-dessous est celui de SKILL-76, conservé SANS
// RETOUCHE. La distinction exit 0 / exit 1 subsiste comme DIAGNOSTIC, jamais
// comme aiguillage — c'est ce que le test de structure vérifie.
//
// ⚠️ Finding 3 de la gate de SKILL-76, toujours valable : n'assertionne pas la
// PRÉSENCE de sous-chaînes là où c'est la STRUCTURE qui est prescrite. Cinq
// `toContain` y étaient satisfaits par la forme même que la spec condamnait
// (0 assertion rouge sur 5, rejoué au banc). Le test de structure ci-dessous
// compte et localise ; il ne se contente pas de chercher des mots.
//
// ⚠️ Chaque test documente la MUTATION-TÉMOIN qui doit le faire rougir
// (convention du dépôt, cf. sha-final-timing-coherence.test.js et
// desuivi-only-exception-coherence.test.js) — rejouée manuellement avant ce
// commit, pas seulement décrite (specs/skill-80.md, § Vérification).
//
// ⚠️ Bornés à la SEULE puce du contrôle (« Vérifie les `corrigé (<sha>)` » →
// « Chaque ligne a exactement une disposition »), jamais à toute l'Étape 6.6 :
// un mot présent ailleurs dans une section longue satisferait trivialement une
// regex non scopée — ce dépôt s'est déjà fait prendre deux fois (SKILL-66
// finding 2, SKILL-70 finding 1), rappelé par specs/skill-80.md § Tests.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNormalized, sectionEntre, platir } from './helpers/prompt-blocks.js';
import { DISPOSITIONS } from '../tools/review-log/write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SDD_FILE = 'commands/sdd-run-ticket.md';

const readSkill = () => readNormalized(REPO_ROOT, SDD_FILE);

// Bornée à "## Étape 6.6" → "## Étape 6.6.5" pour le test de non-régression
// (dernier test) qui porte sur le contrôle `U`/`R`, HORS de la puce du contrôle
// des dispositions.
const etape66 = (raw) =>
  sectionEntre(raw, '## Étape 6.6 — Registre de revue', '## Étape 6.6.5', SDD_FILE);

// Bornée à la SEULE puce du contrôle des `corrigé (<sha>)` — pas toute
// l'Étape 6.6, qui cite légitimement "corrigé" et des exemples de SHA
// ailleurs (le squelette du registre, la ligne "Chaque ligne a exactement une
// disposition").
const controlBullet = (raw) =>
  sectionEntre(
    raw,
    '- **Vérifie les `corrigé (<sha>)` avant de les recopier.**',
    '- Chaque ligne a exactement une disposition',
    SDD_FILE
  );

/** Nombre d'occurrences d'un motif global dans une tranche de texte. */
const compte = (texte, motif) => (texte.match(motif) || []).length;

/**
 * Les SOUS-PUCES de la puce du contrôle : toute ligne qui ouvre un item de
 * liste, la puce-racine elle-même exclue. C'est la forme qu'un branchement de
 * conduite prend dans ce skill (`- **Régime « ancêtre » (exit 0)** : …`), et
 * c'est donc elle qu'on inspecte plutôt qu'un mot-clé.
 */
const sousPuces = (bullet) =>
  bullet
    .split('\n')
    .slice(1)
    .filter((l) => /^\s*[-*] /.test(l));

// --- Détection d'un branchement écrit en PROSE (assertion (d) ci-dessous) -----
//
// Une conjonction de subordination HYPOTHÉTIQUE. `quand` en est volontairement
// absent : l'avertissement sur l'exit 128 écrit « sort en 128, pas en 1, QUAND
// `<SHA_IMPL>` est inconnu » — il décrit les conditions d'apparition d'un code,
// ce qui n'est pas brancher une conduite dessus.
const HYPOTHESE = /\b(si|s['’]il|sinon|selon que|selon le|dans ce cas|auquel cas)\b/i;

// Une référence au prédicat ou à l'un de ses résultats.
const ISSUE_DU_PREDICAT =
  /(prédicat|is-ancestor|exit ?[01]\b|sorti[e]? en [01]\b|sort en [01]\b|code de sortie)/i;

/** Le paragraphe ⛔ de l'exit 128 : la seule zone qui parle légitimement des codes. */
const avertissement128 = (bullet) => {
  const debut = bullet.indexOf('⛔ **Exit 128');
  if (debut === -1) return '';
  const fin = bullet.indexOf('\n\n', debut);
  return bullet.slice(debut, fin === -1 ? undefined : fin);
};

const horsAvertissement128 = (bullet) => bullet.split(avertissement128(bullet)).join(' ');

/**
 * Découpe en phrases. La borne exige une espace (ou une fin) APRÈS le point :
 * `main..HEAD` et `<SHA_IMPL>..HEAD` ne sont donc pas coupés en deux. Le
 * point-virgule est une borne à part entière — c'est lui qui sépare les deux
 * branches d'un branchement écrit en une seule phrase.
 */
const phrases = (texte) =>
  texte
    .split(/(?:[.;!?](?=\s|$)|\n\n)/)
    .map((p) => p.trim())
    .filter(Boolean);

describe('SKILL-80 — le contrôle des dispositions s’ancre sur `main..HEAD`, sans régime', () => {
  // Hérité de SKILL-76 (test 1) : la note fausse — « après un `--amend`, la
  // commande sort en erreur » — reste absente. Elle est ce qui avait fait
  // croire le contrôle auto-signalant (mesuré faux sur SKILL-70).
  // ⚠️ Mutation-témoin : réintroduire « dans ce cas la commande sort en
  // erreur » dans la puce → rouge. Rejouée.
  it('ne prétend plus qu’un `--amend` fait sortir la plage en erreur', () => {
    const bullet = controlBullet(readSkill());
    expect(
      bullet,
      'la puce affirme encore qu’un `--amend` fait sortir `log --oneline` en erreur — c’est faux (mesuré SKILL-70)'
    ).not.toMatch(/sort en erreur/i);
  });

  // Hérité de SKILL-76 (test 2), rôle redéfini par SKILL-80 (D2) : le prédicat
  // reste prescrit, mais pour détecter l'exit 128 — pas pour aiguiller.
  // ⚠️ Mutation-témoin : retirer la ligne `merge-base --is-ancestor` → rouge.
  // Rejouée.
  it('prescrit toujours le prédicat `merge-base --is-ancestor "<SHA_IMPL>" HEAD`', () => {
    const bullet = controlBullet(readSkill());
    expect(
      bullet,
      'le prédicat `merge-base --is-ancestor "<SHA_IMPL>" HEAD` est absent de la puce'
    ).toMatch(/merge-base --is-ancestor "<SHA_IMPL>" HEAD/);
  });

  // Test 1 de specs/skill-80.md § Tests (D1) : l'ancre est `main..HEAD`, et
  // `<SHA_IMPL>..HEAD` n'est PLUS une commande à jouer — dans aucun régime.
  // C'est la plage qui offrait les commits d'un voisin une fois la pointe
  // éloignée (banc du 2026-08-28 : 3 commits rendus dont 2 étrangers, contre 1
  // pour `main..HEAD`).
  // ⚠️ Mutation-témoin : réintroduire `git -C "<WORKTREE_IMPL>" log --oneline
  // "<SHA_IMPL>..HEAD"` comme commande à jouer dans la puce → rouge (la seconde
  // assertion). Rejouée.
  it('prescrit la plage `main..HEAD` et ne prescrit plus `"<SHA_IMPL>..HEAD"`', () => {
    const bullet = controlBullet(readSkill());
    expect(
      bullet,
      'la puce ne prescrit pas `git -C "<WORKTREE_IMPL>" log --oneline main..HEAD` — l’ancre de D1 est absente'
    ).toMatch(/git -C "<WORKTREE_IMPL>" log --oneline main\.\.HEAD/);
    expect(
      bullet,
      'la puce prescrit encore la plage `<SHA_IMPL>..HEAD`, périmée par tout amend ou rebase (D1)'
    ).not.toMatch(/<SHA_IMPL>\.\.HEAD/);
  });

  // Borne que l'appartenance à `main..HEAD` ne donne pas (cf. l'en-tête) :
  // `<SHA_IMPL>` est MEMBRE de la plage dans le régime le plus fréquent — celui
  // où l'implémenteur ajoute un commit de correction sans rien réécrire. Or il ne
  // peut porter aucune correction : c'est le commit relu, celui dont les findings
  // sont sortis. L'ancienne plage `<SHA_IMPL>..HEAD` l'excluait gratuitement (elle
  // sortait vide) ; la nouvelle doit l'exclure NOMMÉMENT, sans quoi une
  // disposition mensongère — la plus facile à produire — passe le contrôle.
  // ⚠️ Mutation-témoin : retirer de la puce la clause qui exclut `<SHA_IMPL>`
  // (« … n'est jamais une correction ») → rouge. Rejouée.
  it('exclut nommément `<SHA_IMPL>` — le commit relu n’est jamais une correction', () => {
    const bullet = controlBullet(readSkill());
    expect(
      bullet,
      'la puce n’exclut pas `<SHA_IMPL>` du jeu des SHA annonçables : il APPARTIENT pourtant à ' +
        '`main..HEAD` tant que le commit relu reste atteignable, et un implémenteur qui n’a rien ' +
        'corrigé peut le réannoncer sans être détecté'
    // Les `\s+` sont indispensables : la puce est enveloppée à ~80 colonnes, et
    // la clause tombe à cheval sur deux lignes. Une regex à espaces littéraux
    // passerait au vert le jour où un mot de plus décale l'enveloppe.
    ).toMatch(/<SHA_IMPL>[\s\S]{0,300}?n['’]est\s+(jamais|pas)\s+une\s+correction/);
    expect(
      bullet,
      'la puce n’explique pas POURQUOI `<SHA_IMPL>` est exclu (c’est le commit RELU) — sans la ' +
        'raison, la borne se relit comme une bizarrerie et se fera retirer'
    ).toMatch(/commit\s+\*{0,2}relu/i);
  });

  // Test 2 de specs/skill-80.md § Tests (D3) : le contenu se vérifie sur le SHA
  // ANNONCÉ. `show --stat HEAD` est ce qui fabriquait la fausse accusation du
  // § Symptôme — la pointe portant le `chore(backlog): new <id>`, il montrait
  // « zéro correction » sur un travail correct (banc du 2026-08-28 :
  // `show --stat HEAD` → `spec-e2.md | 1 +` ; `show --stat <sha annoncé>` →
  // `work.txt | 3 +++`).
  // ⚠️ Mutation-témoin : remettre `show --stat HEAD` dans la puce → rouge (la
  // seconde assertion). Rejouée.
  it('vérifie le contenu sur le SHA annoncé, jamais sur `show --stat HEAD`', () => {
    const bullet = controlBullet(readSkill());
    // Le placeholder est CITÉ ENTRE GUILLEMETS dans le bloc `bash` — convention
    // du dépôt pour tout `<…>` en position d'argument (cf. `"<SHA_IMPL>"` du
    // prédicat), et exigence de la famille F2 de commands-shape-coherence, qui
    // passe chaque bloc à `bash -n` : nu, `<sha annoncé>` y est une REDIRECTION.
    // L'assertion tolère les deux formes : c'est l'ancrage sur le SHA annoncé
    // qu'elle verrouille, pas le style de citation.
    expect(
      bullet,
      'la puce ne prescrit pas `show --stat "<sha annoncé>"` — le contrôle de contenu n’est pas ancré sur le SHA annoncé (D3)'
    ).toMatch(/show --stat "?<sha annoncé>"?/);
    expect(
      bullet,
      'la puce renvoie encore vers `show --stat HEAD` : ce n’est le bon commit que par coïncidence (D3)'
    ).not.toMatch(/show --stat HEAD/);
  });

  // Test 3 de specs/skill-80.md § Tests (D3, corollaire) : la règle « le SHA
  // annoncé doit être `HEAD` » a disparu — c'est elle qui bloquait le cycle sur
  // un travail correct dès qu'un second commit licite suivait l'amend.
  // ⚠️ Mutation-témoin : réintroduire « Le SHA annoncé **doit être `HEAD`** »
  // dans la puce → rouge. Rejouée.
  it('ne prescrit plus que le SHA annoncé doive être `HEAD`', () => {
    const bullet = controlBullet(readSkill());
    expect(
      bullet,
      'la puce impose encore que le SHA annoncé soit `HEAD` — faux dès qu’un `chore(backlog): new <id>` licite suit l’amend (D3)'
    ).not.toMatch(/doit être `HEAD`/);
  });

  // Test 4 de specs/skill-80.md § Tests (D2) — RÉÉCRITURE de l'assertion de
  // SKILL-76 (« deux puces `- **Régime …` distinctes, chacune portant sa propre
  // conduite »), devenue fausse : ce ticket la réécrit dans le même commit
  // plutôt que de la supprimer en silence (D8 du dépôt).
  //
  // Vérifie la STRUCTURE, pas la présence de sous-chaînes (finding 3 de la gate
  // de SKILL-76) : aucune conduite ne se branche sur le code de sortie, donc
  // (a) aucune sous-puce ne porte de label de régime ni de code de sortie,
  // (b) le mot « régime » n'apparaît plus qu'UNE fois — dans l'avertissement sur
  // l'exit 128, qui nie précisément en être un —
  // (c) chaque commande d'exploitation est prescrite UNE seule fois, donc pas
  // une fois par branche, et
  // (d) AUCUNE PHRASE ne conditionne quoi que ce soit au résultat du prédicat.
  //
  // (d) est le point qui manquait : (a)/(b)/(c) ne voient qu'un branchement écrit
  // en LISTE, ou qui emploie le mot « régime », ou qui redonne une commande par
  // branche. Or « une note en fin de puce » — de la PROSE — est exactement la
  // forme que specs/skill-76.md § C3 désignait comme celle qui avait rendu le
  // contrôle inopérant. Une phrase du type « Si le prédicat est sorti en 0, …
  // s'il est sorti en 1, … » défait D1, D2 et D3 d'un coup sans employer aucune
  // des chaînes que les autres tests cherchent. (d) l'attrape par sa FORME :
  // une conjonction de subordination hypothétique dans la même phrase qu'une
  // référence au prédicat ou à ses codes de sortie.
  //
  // Le ⛔ de l'exit 128 est la seule zone exemptée de (d) — c'est le seul endroit
  // qui doive légitimement parler des codes de sortie et de ce qu'ils valent. Pour
  // que cette exemption ne devienne pas la cachette du branchement qu'on vient
  // d'interdire, elle est bornée en retour : ce paragraphe ne prescrit RIEN sur le
  // SHA annoncé (assertion finale). Sa conduite à lui est un STOP, pas un choix de
  // contrôle.
  //
  // ⚠️ Mutation-témoin : restaurer la puce livrée par SKILL-76 (les deux puces
  // `- **Régime « ancêtre » (exit 0)** : …` / `- **Régime « amendé/réécrit »
  // (exit 1)** : …` avec leur conduite respective) → rouge. REJOUÉE, et voici ce
  // qu'elle rougit exactement, mesuré et non supposé : (a) deux sous-puces de
  // branchement au lieu de zéro, et (b) SEPT occurrences de « régime » au lieu
  // d'une. Les deux comptes de commandes, eux, restent à 1 dans cette forme
  // précise — SKILL-76 ne prescrivait qu'une plage et qu'un `show --stat`, la
  // seconde branche se contentant d'INTERDIRE la lecture de la première. Ils
  // gardent le cas voisin, non couvert par (a) et (b) : une conduite qui
  // redonnerait sa propre commande à chaque branche.
  //
  // ⚠️ Seconde mutation-témoin, celle qui a motivé (d) : remplacer la phrase
  // « Le SHA annoncé doit **appartenir** à cette plage : c'est le seul critère. »
  // par « Si le prédicat est sorti en 0, le SHA annoncé doit **appartenir** à
  // cette plage ; s'il est sorti en 1, ⛔ ne lis pas la plage — le SHA annoncé
  // doit alors être la pointe, et rien d'autre. » → rouge sur (d) SEULEMENT.
  // Rejouée : avant (d), cette mutation laissait la suite ENTIÈREMENT VERTE
  // (0 assertion sur 4, et les tests 1/2/3 muets puisqu'elle n'emploie aucune de
  // leurs chaînes) — c'est-à-dire une puce ayant repris les deux régimes.
  it('ne branche aucune conduite sur exit 0 / exit 1 — plus de construction à deux régimes', () => {
    const bullet = controlBullet(readSkill());

    const puceDeBranchement = sousPuces(bullet).filter((l) =>
      /\*\*Régime|exit 0|exit 1/.test(l)
    );
    expect(
      puceDeBranchement,
      'une sous-puce de la puce du contrôle porte encore un label de régime ou un code de sortie : ' +
        'la conduite y est branchée sur `merge-base --is-ancestor` (D2 la retire)'
    ).toEqual([]);

    expect(
      compte(bullet, /[Rr]égime/g),
      'le mot « régime » apparaît plus d’une fois dans la puce : la seule occurrence légitime est ' +
        'l’avertissement qui nie que l’exit 128 en soit un (D2)'
    ).toBe(1);

    // On compte les COMMANDES PRESCRITES (`git -C "<WORKTREE_IMPL>" …`), pas les
    // mentions : la prose renvoie légitimement à « son `show --stat` » une fois
    // la commande donnée. Le `\s+` tolère la coupure de ligne que la forme
    // condamnée par D2 introduisait au milieu de sa commande.
    expect(
      compte(bullet, /git -C\s+"<WORKTREE_IMPL>"\s+log --oneline/g),
      'la puce prescrit plusieurs plages `log --oneline` : l’ensemble légitime est unique et ' +
        'inconditionnel (`main..HEAD`), il ne se décline pas par régime (D1)'
    ).toBe(1);
    // (d) Aucune PHRASE ne conditionne une conduite au résultat du prédicat.
    const fautives = phrases(horsAvertissement128(bullet)).filter(
      (p) => HYPOTHESE.test(p) && ISSUE_DU_PREDICAT.test(p)
    );
    expect(
      fautives,
      'une phrase de la puce conditionne la conduite au résultat du prédicat (« si … exit 0 … ; ' +
        'si … exit 1 … ») : c’est la construction à deux régimes, réécrite en prose. D2 la retire ' +
        'dans TOUTES ses formes, pas seulement en sous-puces'
    ).toEqual([]);

    // Contre-borne de l'exemption ci-dessus : le ⛔ de l'exit 128 ne prescrit
    // rien sur le SHA annoncé — sinon il devient la cachette du branchement.
    expect(
      avertissement128(bullet),
      'l’avertissement sur l’exit 128 prescrit quelque chose au sujet du SHA annoncé : sa seule ' +
        'conduite est un STOP, et cette zone est exemptée du contrôle (d) — y écrire une règle de ' +
        'contrôle la sortirait de toute vérification'
    ).not.toMatch(/SHA annoncé/);

    expect(
      compte(bullet, /git -C\s+"<WORKTREE_IMPL>"\s+show --stat/g),
      'la puce prescrit plusieurs vérifications `show --stat` : le contrôle de contenu est unique ' +
        'et porte sur le SHA annoncé (D3)'
    ).toBe(1);
  });

  // Test 7 (finding 1 de la gate de reprise du 2026-08-27) : `merge-base
  // --is-ancestor` rend aussi 128 (pas seulement 0/1) quand `<SHA_IMPL>` est
  // inconnu du dépôt interrogé — mesuré au banc le 2026-08-27 :
  // `fatal: Not a valid commit name …`, exit 128. Un 128 lu comme « pas 0 »
  // certifierait le `HEAD` d'un arbre étranger (mauvais `<WORKTREE_IMPL>`).
  // ⚠️ Mutation-témoin : retirer l'avertissement sur le 128 → rouge.
  it('avertit que exit 128 (SHA inconnu du dépôt) n’est PAS le régime amendé — arrête-toi', () => {
    const bullet = controlBullet(readSkill());
    expect(bullet, 'le code de sortie 128 n’est plus mentionné dans la puce').toMatch(/128/);
    expect(
      bullet,
      'la puce ne dit plus explicitement que 128 N’EST PAS le régime « amendé »'
    ).toMatch(/128[^.]*n['’]est pas|n['’]est PAS le régime/i);
    expect(
      bullet,
      'aucune instruction d’arrêt n’accompagne l’exit 128'
    ).toMatch(/arrête-toi/i);
  });

  // NON-RÉGRESSION (hérité de SKILL-76, test 5, ré-ancré par D1) : l'exigence
  // de vérifier avant de recopier subsiste, et le détecteur d'exit 128 reste
  // joué AVANT l'exploitation de la plage — un `<WORKTREE_IMPL>` mal résolu doit
  // arrêter le contrôle avant qu'il ne lise quoi que ce soit.
  // ⚠️ Mutation-témoin : retirer la puce entière, ou déplacer le bloc du
  // prédicat APRÈS la plage `main..HEAD` → rouge. Rejouée.
  it('non-régression — l’exigence de vérifier subsiste, et le prédicat précède la plage', () => {
    const raw = readSkill();
    expect(
      raw,
      'la puce "Vérifie les `corrigé (<sha>)` avant de les recopier." a disparu'
    ).toMatch(/Vérifie les `corrigé \(<sha>\)` avant de les recopier\./);
    const bullet = controlBullet(raw);
    const idxPredicat = bullet.indexOf('merge-base --is-ancestor "<SHA_IMPL>" HEAD');
    const idxPlage = bullet.indexOf('log --oneline main..HEAD');
    expect(idxPredicat, 'le prédicat est introuvable dans la puce').toBeGreaterThanOrEqual(0);
    expect(idxPlage, 'la plage `log --oneline main..HEAD` est introuvable dans la puce').toBeGreaterThanOrEqual(0);
    expect(
      idxPredicat,
      'le détecteur d’exit 128 n’est plus joué AVANT l’exploitation de la plage `main..HEAD`'
    ).toBeLessThan(idxPlage);
  });

  // NON-RÉGRESSION (hérité de SKILL-76, test 6) : le contrôle sur `U` (ligne
  // manquante) et la distinction `R`/`U` sont inchangés. Bornée à l'Étape 6.6
  // entière, HORS de la puce du contrôle des dispositions.
  // ⚠️ Mutation-témoin : retirer la ligne "Contrôle : U uniques = U disposés"
  // du squelette de registre, ou la définition de `R`/`U` → rouge. Vert avant
  // et après ce ticket.
  it('non-régression — le contrôle `U` et la distinction `R`/`U` restent inchangés', () => {
    const section = etape66(readSkill());
    expect(
      section,
      'la ligne "Contrôle : U uniques = U disposés" a disparu du squelette de registre'
    ).toMatch(/Contrôle : U uniques = U disposés/);
    expect(
      section,
      'la définition de `R` (remontées brutes) a disparu'
    ).toMatch(/`R` = les \*\*remontées brutes\*\*/);
    expect(
      section,
      'la définition de `U` (findings uniques après fusion) a disparu'
    ).toMatch(/`U` = les\s+findings\s+\*\*uniques après fusion\*\*/);
  });
});

// ============================================================================
// SKILL-105 (D2b) — la CELLULE du geste de portée conventionnelle.
//
// `SKILL-104 · E1 (finding 1)` : la règle de portée conventionnelle, projetée
// chez l'implémenteur et le relecteur, écrit qu'un tel geste « ne s'escalade
// pas » ; la section qui l'accueille impose l'inverse pour TOUT finding
// (« Chaque ligne a exactement une disposition, jamais vide »). Un finding levé
// dessus n'avait donc AUCUNE cellule. L'arbitrage n'ouvre pas de quatrième
// valeur : il NOMME celle que l'énuméré fournissait déjà — `escaladé — E1`.
// ============================================================================

// Bornée à la SEULE puce des dispositions, jamais à toute l'Étape 6.6 : la
// section cite légitimement `corrigé`, `E1` et `E2` ailleurs (le squelette du
// registre, la puce du contrôle des SHA) — une regex non scopée y serait
// trivialement verte. Même doctrine que `controlBullet` ci-dessus.
const puceDispositions = (raw) =>
  sectionEntre(
    raw,
    '- Chaque ligne a exactement une disposition',
    '- `0 finding` est une sortie parfaitement valide',
    SDD_FILE
  );

describe('SKILL-105 — D2b : l’Étape 6.6 nomme la cellule du geste conventionnel', () => {
  // ⚠️ Mutation-témoin : retirer la cellule → rouge.
  it('un finding levé sur un geste de PORTÉE CONVENTIONNELLE se dispose `escaladé — E1`', () => {
    const puce = platir(puceDispositions(readSkill()));
    expect(
      /portée conventionnelle/i.test(puce),
      `${SDD_FILE} § 6.6 : la puce des dispositions ne nomme plus le cas du ` +
        `geste de PORTÉE CONVENTIONNELLE — un finding levé dessus retrouve son ` +
        `absence de cellule (SKILL-104 · E1, finding 1).`
    ).toBe(true);
    expect(
      /se\s*dispose `escaladé — E1`/.test(puce),
      `${SDD_FILE} § 6.6 : la puce ne dit plus que ce finding se dispose ` +
        `\`escaladé — E1\`.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : rabattre le cas sur `corrigé` → rouge ici seulement.
  // Un `corrigé` sans correction brouille la seule colonne que le registre
  // existe pour porter (issue 2 de l'escalade, écartée à l'arbitrage).
  it('`corrigé` est explicitement écarté, AVEC son motif', () => {
    const puce = platir(puceDispositions(readSkill()));
    expect(
      /Pas `corrigé`/.test(puce),
      `${SDD_FILE} § 6.6 : la puce n'écarte plus explicitement \`corrigé\` ` +
        `pour ce cas.`
    ).toBe(true);
    expect(
      /brouille la seule colonne que le registre existe pour porter/.test(puce),
      `${SDD_FILE} § 6.6 : le MOTIF de l'exclusion de \`corrigé\` a disparu — ` +
        `une exclusion sans raison se fait retirer au ticket suivant.`
    ).toBe(true);
  });

  // Le déclenchement de l'Étape 6.6.5 qui s'ensuit est VOULU, pas un effet de
  // bord : « ce geste est-il vraiment conventionnel ? » est un arbitrage que
  // l'utilisateur doit rendre une fois.
  // ⚠️ Mutation-témoin : retirer la clause de déclenchement → rouge ici seule.
  it('le déclenchement de 6.6.5 est déclaré VOULU, avec sa source et l’omission de son 5e élément', () => {
    const puce = platir(puceDispositions(readSkill()));
    expect(
      /déclenchement de l'Étape\s*6\.6\.5[^.]*est \*\*voulu\*\*/.test(puce),
      `${SDD_FILE} § 6.6 : la puce ne déclare plus VOULU le déclenchement de ` +
        `l'Étape 6.6.5 que cette disposition entraîne — un lecteur le prendrait ` +
        `pour un effet de bord et chercherait à l'éviter.`
    ).toBe(true);
    expect(
      /source applicable est « \*\*registre\*\* »/.test(puce),
      `${SDD_FILE} § 6.6 : la puce ne nomme plus la source applicable en ` +
        `6.6.5 (« registre ») — l'orchestrateur ne sait pas quels éléments ` +
        `écrire.`
    ).toBe(true);
    expect(
      /diagnostic de méthode[^.]*\*\*omis\*\*/.test(puce),
      `${SDD_FILE} § 6.6 : la puce ne dit plus que le cinquième élément de la ` +
        `source « registre » (le diagnostic de méthode) est OMIS ici, sa ` +
        `condition n'étant pas remplie : la cause n'est pas une clause fausse ` +
        `de la spec.`
    ).toBe(true);
  });
});

describe('SKILL-105 — D2b : l’énuméré du skill est IDENTIQUE à `DISPOSITIONS` de write.mjs', () => {
  // C'est le garde de la frontière sur laquelle repose TOUT le refus de la
  // quatrième disposition (§ Hors-scope de specs/skill-105.md), et il n'existait
  // pas : l'énuméré du § Étape 6.8 et la constante de `tools/review-log/write.mjs`
  // — qui rejette à l'exécution toute valeur hors liste — pouvaient diverger
  // sans qu'aucun test ne bouge.
  //
  // ⛔ Écrit comme une ÉGALITÉ, jamais comme une présence : un test qui vérifie
  // seulement que les quatre valeurs sont là reste vert quand une cinquième
  // s'ajoute.
  //
  // ⚠️ Mutations : ajouter une valeur à l'énuméré du § 6.8 → rouge ; en ajouter
  // une à `DISPOSITIONS` → rouge.
  it('l’énuméré littéral du § Étape 6.8 est exactement `DISPOSITIONS`, ni plus ni moins', () => {
    const raw = readSkill();
    const section68 = sectionEntre(raw, '## Étape 6.8', '## Étape 7', SDD_FILE);
    const m = /`disposition` est un énuméré fermé\s*\n?\s*\(([^)]+)\)/.exec(section68);
    expect(
      m,
      `${SDD_FILE} § 6.8 : l'énuméré fermé des dispositions est introuvable — ` +
        `sans lui, ce test ne compare RIEN.`
    ).not.toBeNull();
    const litteral = m[1]
      .split('·')
      .map((s) => s.trim().replace(/^`|`$/g, ''))
      .filter((s) => s.length > 0);
    expect(
      litteral,
      `${SDD_FILE} § 6.8 : l'énuméré littéral (${litteral.join(', ')}) diffère ` +
        `de la constante DISPOSITIONS de tools/review-log/write.mjs ` +
        `(${DISPOSITIONS.join(', ')}), qui REJETTE à l'exécution toute valeur ` +
        `hors liste. Une divergence ici, c'est un cycle qui écrit une ` +
        `disposition que l'écrivain refusera — ou une quatrième cellule ouverte ` +
        `en prose sans son porteur.`
    ).toEqual([...DISPOSITIONS]);
  });
});
