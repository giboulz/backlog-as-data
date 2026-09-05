// SKILL-31 — les escalades E1/E3 obtiennent un support durable : D10 (arbitré
// via C9) prescrit qu'elles soient écrites dans la spec du ticket, en commit
// séparé, après la fermeture de la gate et avant `/send`. Avant ce ticket,
// `grep -n "escalade"` sur le skill ne rendait que des mentions de
// PUBLICATION (registre 6.6, Étape 7) : aucune n'écrivait quoi que ce soit sur
// disque (specs/skill-31.md, § Problème).
//
// ⚠️ Chaque assertion porte en commentaire la MUTATION qui doit la faire
// rougir (convention de ce repo, D3). Ancres déclarées ICI, en dur — ce
// fichier n'importe aucune liste de contrôle partagée avec un autre test.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized, extractBetween, sectionEntre, platir } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SDD_FILE = 'commands/sdd-run-ticket.md';

const readSkill = () => readNormalized(REPO_ROOT, SDD_FILE);

// Découpe de l'Étape 6.6.5, ajoutée par ce ticket entre 6.6 et 6.7. Bornée ici
// pour éviter qu'une regex non scopée n'aille chercher un mot sans rapport
// ailleurs dans un fichier de plus de mille lignes (leçon de SKILL-26, finding
// 4 : cf. spec § Comment ces mutations-témoins doivent être écrites, point 1).
const etape665 = (raw) => sectionEntre(raw, '## Étape 6.6.5', '## Étape 6.7', SDD_FILE);

// --- Découpe d'une puce de contenu, et comptage de ses éléments --------------
//
// ⚠️ SKILL-105 : ces deux helpers vivaient À L'INTÉRIEUR du `describe`
// « les éléments requis du contenu » (SKILL-31 + SKILL-94). Ils sont REMONTÉS
// au module, **corps inchangé**, pour que la famille de la TROISIÈME source
// (« constat d'orchestrateur ») les réutilise sans en recopier une variante —
// deux découpes recopiées divergent en silence, et c'est le seul geste que le
// § ✅ Autorisation écrite de specs/skill-105.md autorise sur le code existant
// de ce fichier. Seule leur portée lexicale change.
//
// ⚠️ Toute assertion de CONTENU qui les consomme porte sur `platir(puce)`,
// jamais sur le texte brut : la prose de ce skill est enroulée à la main à ~78
// colonnes, donc une locution de trois à six mots dépend du POINT
// D'ENROULEMENT. Le DÉCOUPAGE, lui, reste sur le texte brut : il lit la
// structure de lignes (`\n\s*- **`), que `platir` détruirait.
const puceSource = (section, amorce) => {
  const i = section.indexOf(amorce);
  if (i === -1) return null;
  const reste = section.slice(i + amorce.length);
  const j = reste.search(/\n\s*- \*\*/);
  return platir(amorce + (j === -1 ? reste : reste.slice(0, j)));
};
const elementsApres = (puce, re) => {
  const m = re.exec(puce);
  if (m === null) return null;
  return puce
    .slice(m.index + m[0].length)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

describe('SKILL-31 — l’Étape 6.6.5 existe et se situe ENTRE 6.6 et 6.7', () => {
  // ⚠️ Mutation-témoin : renommer "## Étape 6.6.5" en "## Étape 6.9" (ou la
  // déplacer après "## Étape 6.7") → rouge, `extractBetween` rend `null` ou
  // trouve les ancres dans le mauvais ordre. D10 : l'écriture doit avoir lieu
  // APRÈS la fermeture de la gate (6.6), AVANT `/send` (6.7).
  it(`${SDD_FILE} porte une section "## Étape 6.6.5" strictement entre 6.6 et 6.7`, () => {
    const raw = readSkill();
    const i66 = raw.indexOf('## Étape 6.6 ');
    const i665 = raw.indexOf('## Étape 6.6.5');
    const i67 = raw.indexOf('## Étape 6.7');
    expect(i66, `"## Étape 6.6 " introuvable.`).not.toBe(-1);
    expect(i665, `"## Étape 6.6.5" introuvable.`).not.toBe(-1);
    expect(i67, `"## Étape 6.7" introuvable.`).not.toBe(-1);
    expect(
      i66 < i665 && i665 < i67,
      `L'ordre constaté des trois ancres n'est pas 6.6 < 6.6.5 < 6.7 — D10 ` +
        `exige que l'écriture ait lieu après la fermeture de la gate, avant ` +
        `\`/send\`.`
    ).toBe(true);
  });
});

describe('SKILL-31 — cas nul : aucune escalade → aucune section, aucun commit', () => {
  // ⚠️ Mutation-témoin : retirer cette clause de déclenchement conditionnel →
  // rouge. Sans elle, l'orchestrateur écrirait une section "## Escalades"
  // vide à chaque ticket — le même défaut qu'un registre fabriqué en dosage
  // `none` (§ Problème de la spec, et Étape 7 qui l'interdit déjà nommément).
  it('la section 6.6.5 prescrit : déclenchement seulement si le registre porte E1 ou E3', () => {
    const section = etape665(readSkill());
    expect(
      /ne s.exécute que si le registre de l.Étape 6\.6 porte au moins\s*\n?\s*une disposition `escaladé — E1` ou `escaladé — E3`/i.test(
        section
      ),
      `${SDD_FILE} § 6.6.5 ne borne plus son déclenchement à la présence ` +
        `d'au moins une disposition escaladée dans le registre.`
    ).toBe(true);
  });

  it('la section 6.6.5 interdit explicitement la section/le commit vides', () => {
    const section = etape665(readSkill());
    expect(
      /Aucune escalade → aucune section, aucun commit/.test(section),
      `${SDD_FILE} § 6.6.5 ne dit plus explicitement qu'aucune escalade ` +
        `signifie aucune section et aucun commit.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer la précision sur E2 → rouge. Sans elle, un
  // implémenteur ou un orchestrateur pourrait croire que E2 (déjà tracée par
  // son ticket créé) doit AUSSI être écrite ici, dupliquant sa trace.
  it('la section 6.6.5 précise que E2 n’est pas concernée (déjà tracée par son ticket)', () => {
    const section = etape665(readSkill());
    expect(
      /E2 n.est pas concernée/.test(section),
      `${SDD_FILE} § 6.6.5 ne précise plus que E2 est hors de son périmètre.`
    ).toBe(true);
  });
});

describe('SKILL-31 — une escalade peut porter sur la spec elle-même (cas nominal)', () => {
  // ⚠️ Mutation-témoin (finding 1 de la revue de ce ticket) : retirer ce
  // paragraphe → rouge. Sans lui, rien ne distingue une escalade E1 dont
  // l'objet est la spec elle-même d'une violation de l'interdit qui borne E1
  // pour l'implémenteur — l'orchestrateur édulcorerait en une remarque non
  // actionnable (spec § Problème, retour d'expérience point 2).
  it('la section 6.6.5 dit explicitement qu’une escalade sur la spec elle-même est le cas nominal', () => {
    const section = etape665(readSkill());
    expect(
      /porter sur la spec elle-même, et c.est le cas\s*\n?\s*nominal/i.test(
        section
      ),
      `${SDD_FILE} § 6.6.5 ne dit plus explicitement qu'une escalade sur la ` +
        `spec elle-même (le défaut qu'elle décrit) est un cas nominal, pas ` +
        `une exception.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer la borne « porte sur l'implémenteur » → rouge.
  // Sans elle, l'orchestrateur pourrait lire l'interdit d'E1 (« tu ne touches
  // pas à la spec ») comme s'appliquant à LUI, alors qu'il borne
  // l'implémenteur — c'est précisément l'ambiguïté que ce paragraphe lève.
  it('la section 6.6.5 précise que l’interdit d’E1 borne l’implémenteur, pas l’orchestrateur qui écrit ici', () => {
    const section = etape665(readSkill());
    expect(
      /porte sur l.\*\*implémenteur\*\*/.test(section),
      `${SDD_FILE} § 6.6.5 ne précise plus que l'interdit d'E1 (« tu ne ` +
        `touches pas à la spec ») borne l'implémenteur, pas l'orchestrateur.`
    ).toBe(true);
  });
});

describe('SKILL-31 — emplacement : le worktree, jamais le frontmatter, jamais un checkout live', () => {
  // ⚠️ Mutation-témoin : retirer `<WORKTREE_IMPL>` de la section → rouge. Sans
  // cette ancre, l'implémenteur pourrait écrire dans la copie de
  // l'orchestrateur (checkout live) plutôt que dans le worktree relu.
  it('la section 6.6.5 prescrit l’écriture dans `<WORKTREE_IMPL>`', () => {
    const section = etape665(readSkill());
    expect(section.includes('<WORKTREE_IMPL>')).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer « jamais dans le frontmatter » → rouge. Le
  // frontmatter est de la donnée de backlog mutée exclusivement par l'outil
  // (Règles strictes du skill) : y écrire à la main serait une contradiction
  // directe, pas une simple omission.
  it('la section 6.6.5 interdit explicitement d’écrire dans le frontmatter', () => {
    const section = etape665(readSkill());
    expect(
      /jamais dans le frontmatter/.test(section),
      `${SDD_FILE} § 6.6.5 ne dit plus explicitement que l'écriture se fait ` +
        `dans le corps, jamais dans le frontmatter.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer « jamais dans un checkout live » → rouge.
  it('la section 6.6.5 interdit explicitement l’écriture dans un checkout live', () => {
    const section = etape665(readSkill());
    expect(
      /jamais dans un checkout live/.test(section),
      `${SDD_FILE} § 6.6.5 ne dit plus explicitement que l'écriture n'a ` +
        `jamais lieu dans un checkout live.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin (finding 4 de la revue de ce ticket) : retirer le titre
  // `## Escalades (D10)` → rouge. Sans un titre nommé, « aucune section » (cas
  // nul) interdit une section que l'étape ne définit jamais — trois
  // escalades réellement exercées (SKILL-26/27/28) portent toutes ce même
  // titre, et `BLG-08` (specs/skill-31.md § Hors-scope) en dépend comme ancre
  // stable.
  it('la section 6.6.5 nomme le titre `## Escalades (D10)` de la section appendée', () => {
    const section = etape665(readSkill());
    expect(section.includes('## Escalades (D10)')).toBe(true);
  });
});

describe('SKILL-31 — commit séparé, jamais fondu dans le commit du ticket', () => {
  // ⚠️ Mutation-témoin : retirer le gabarit `docs(<TICKET-ID>): escalade` →
  // rouge. Sans lui, rien ne distingue ce commit de celui du ticket relu.
  it('la section 6.6.5 prescrit le gabarit `docs(<TICKET-ID>): escalade`', () => {
    const section = etape665(readSkill());
    expect(section.includes('docs(<TICKET-ID>): escalade')).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer « jamais fondu dans le commit du ticket » (ou
  // l'équivalent explicite d'interdiction de fusion) → rouge. C'est le point
  // exact de D10 : ce qui n'est pas du code relu doit rester visible comme
  // tel, séparé du commit qui, lui, a traversé la gate.
  it('la section 6.6.5 interdit explicitement de fondre l’escalade dans le commit du ticket', () => {
    const section = etape665(readSkill());
    expect(
      /jamais fondu[e]? dans le commit du ticket/.test(section),
      `${SDD_FILE} § 6.6.5 ne dit plus explicitement que ce commit ne peut ` +
        `pas se fondre dans celui du ticket relu.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin (finding 3 de la revue de ce ticket) : retirer le motif
  // (« ce qui n'est pas du code relu doit rester visible comme tel ») en
  // gardant seulement le gabarit et l'interdit de fusion → rouge. Sans lui,
  // rien n'explique POURQUOI le commit est séparé — un ticket de compression
  // future pourrait raccourcir la phrase jusqu'au gabarit nu sans qu'aucune
  // autre assertion ne bouge (`npm test` resterait vert sur une étape
  // devenue une convention de nommage sans enjeu).
  it('la section 6.6.5 donne le MOTIF de la séparation, pas seulement le gabarit', () => {
    const section = etape665(readSkill());
    expect(
      /ce qui n.est pas du code relu\s*\n?\s*doit rester visible comme tel/.test(
        section
      ),
      `${SDD_FILE} § 6.6.5 ne donne plus le motif de la séparation du commit ` +
        `(« ce qui n'est pas du code relu doit rester visible comme tel ») — ` +
        `seuls le gabarit et l'interdit de fusion resteraient, sans raison.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin (finding 5 de la revue de ce ticket) : retirer l'une des
  // deux commandes `git -C "<WORKTREE_IMPL>"` (add / commit) → rouge. Sans
  // ciblage explicite, une commande `git` nue hérite du répertoire courant du
  // shell — donc du repo de la SESSION, pas du worktree relu (§ Étape 1.2) —
  // et le commit d'escalade s'exécuterait dans le mauvais arbre, laissant
  // l'Étape 6.7 buter sur un `git status --porcelain` non vide.
  it('la section 6.6.5 cible explicitement `<WORKTREE_IMPL>` pour l’add ET le commit', () => {
    const section = etape665(readSkill());
    expect(
      section.includes('git -C "<WORKTREE_IMPL>" add') &&
        section.includes('git -C "<WORKTREE_IMPL>" commit'),
      `${SDD_FILE} § 6.6.5 ne cible plus explicitement \`<WORKTREE_IMPL>\` ` +
        `pour l'add et/ou le commit — une commande \`git\` nue hériterait du ` +
        `répertoire courant du shell.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer `--only` de la commande de commit → rouge.
  // Sans lui, un `git commit` nu committe TOUT l'index — donc ce qu'une
  // session voisine y aurait stagé (même raison que le commit de backlog de
  // l'Étape 5.5, § Étape 1.2).
  it('la commande de commit de la section 6.6.5 est scopée `--only` à la spec', () => {
    const section = etape665(readSkill());
    expect(section.includes('commit -q --only')).toBe(true);
  });
});

describe('SKILL-31 — Étape 1.2 : la table de ciblage couvre l’Étape 6.6.5', () => {
  // ⚠️ Mutation-témoin (finding 5 de la revue de ce ticket) : restaurer
  // « Étapes 1 à 6.6 » (sans le `.5`) → rouge. L'Étape 6.6.5, neuve, ne
  // tombait dans AUCUNE des deux lignes de la table avant cette correction.
  it('la table de l’Étape 1.2 couvre "Étapes 1 à 6.6.5", pas seulement 6.6', () => {
    const raw = readSkill();
    expect(raw.includes('Étapes 1 à 6.6.5')).toBe(true);
    expect(raw.includes('Étapes 1 à 6.6 |')).toBe(false);
  });
});

describe('SKILL-31 — Étape 6.7 : le SHA final peut aussi diverger à cause du commit d’escalade', () => {
  // ⚠️ Mutation-témoin (finding 6 de la revue de ce ticket) : retirer la
  // mention du commit `docs(…): escalade` de l'énumération des causes de
  // divergence avec `<SHA_IMPL>` → rouge. Sans elle, un orchestrateur qui lit
  // SEULEMENT cette énumération conclurait à tort qu'un écart avec
  // `<SHA_IMPL>` signifie toujours une correction de l'implémenteur.
  it('l’Étape 6.7 cite le commit d’escalade parmi les causes de divergence avec `<SHA_IMPL>`', () => {
    const raw = readSkill();
    const section = extractBetween(raw, '## Étape 6.7', '## Étape 6.8');
    expect(section, `${SDD_FILE} : section "## Étape 6.7" → "## Étape 6.8" introuvable.`).not.toBeNull();
    expect(
      /Étape 6\.6\.5 a ajouté son\s*\n?\s*commit `docs\(<TICKET-ID>\): escalade`/.test(
        section
      ),
      `${SDD_FILE} § 6.7 ne cite plus le commit d'escalade de l'Étape 6.6.5 ` +
        `parmi les causes de divergence du SHA final avec \`<SHA_IMPL>\`.`
    ).toBe(true);
  });
});

describe('SKILL-31 (+ SKILL-94) — les éléments requis du contenu (§ Décision 4 de la spec)', () => {
  // ⚠️ Mutation-témoin : retirer l'un de ces marqueurs → rouge. Les QUATRE
  // premiers sont ceux dont l'absence, constatée sur SKILL-26/SKILL-28 (retour
  // d'expérience de specs/skill-31.md, § Problème point 3), a rendu une
  // escalade inexploitable. SKILL-94 § D3 en ajoute un CINQUIÈME, testé plus
  // bas dans ce même describe : le diagnostic de méthode.
  it('la section 6.6.5 exige le numéro du finding et son type (E1 ou E3)', () => {
    const section = etape665(readSkill());
    expect(/numéro du finding/.test(section)).toBe(true);
  });

  it('la section 6.6.5 exige ce que la gate a trouvé, avec ce qui le rend vrai', () => {
    const section = etape665(readSkill());
    expect(/ce que la gate a trouvé/.test(section)).toBe(true);
  });

  it('la section 6.6.5 exige la raison pour laquelle l’implémenteur ne pouvait pas corriger', () => {
    const section = etape665(readSkill());
    expect(
      /pourquoi l.implémenteur ne pouvait pas le corriger/.test(section)
    ).toBe(true);
  });

  it('la section 6.6.5 exige les issues possibles, non tranchées', () => {
    const section = etape665(readSkill());
    expect(/issues possibles, non tranchées/.test(section)).toBe(true);
  });

  // --- SKILL-94 § D3 — le cinquième élément de la source « registre » -------
  //
  // Les deux tests ci-dessous découpent les DEUX puces de contenu (une par
  // source) et comptent leurs éléments réellement énumérés, pas seulement le
  // mot qui les annonce : « cinq éléments » suivi de quatre segments serait un
  // vert trompeur, et c'est exactement le mode de défaillance d'une puce qu'on
  // renumérote sans y toucher. Le compte annoncé ET le compte constaté sont
  // vérifiés ensemble.
  //
  // ⚠️ Toute assertion de CONTENU ci-dessous porte sur `platir(puce)`, jamais
  // sur le texte brut : la prose de ce skill est enroulée à la main à ~78
  // colonnes, donc une locution de trois à six mots dépend du POINT
  // D'ENROULEMENT. Un ticket futur qui ajoute un mot dans l'une de ces puces —
  // geste banal, ce commit vient lui-même de remplacer « quatre » par « cinq »
  // à la l. 1151 — déplace la coupure et fait rougir un test en affirmant
  // qu'une prescription a disparu, alors que rien n'a bougé dans le sens.
  // `platir` est importé du helper partagé (SKILL-94, point (4) de son
  // en-tête), pas recopié.
  //
  // Le DÉCOUPAGE, lui, reste sur le texte brut : il lit la structure de lignes
  // (`\n\s*- **`), que `platir` détruirait.
  //
  // ⚠️ SKILL-105 : `puceSource` et `elementsApres` sont désormais déclarés AU
  // MODULE (haut de ce fichier), corps inchangé — la famille de la troisième
  // source les réutilise.

  // ⚠️ Mutation-témoin : retirer le cinquième élément (le diagnostic) en
  // laissant « cinq éléments » dans la prose → rouge sur le compte constaté ;
  // le retirer AVEC son annonce (retour à « quatre ») → rouge sur l'annonce.
  it('la section 6.6.5 énumère CINQ éléments pour la source « registre », le cinquième étant le diagnostic', () => {
    const section = etape665(readSkill());
    const puce = puceSource(section, '- **Source « registre »**');
    expect(
      puce,
      `${SDD_FILE} § 6.6.5 : la puce de contenu « Source « registre » » est ` +
        `introuvable.`
    ).not.toBeNull();
    expect(
      /cinq\s+éléments/.test(puce),
      `${SDD_FILE} § 6.6.5 : la puce « Source « registre » » n'annonce plus ` +
        `CINQ éléments (SKILL-94 § D3 en ajoute un aux quatre de SKILL-31).`
    ).toBe(true);
    const elements = elementsApres(puce, /éléments\s*:/);
    expect(
      elements,
      `${SDD_FILE} § 6.6.5 : aucun « éléments : » dans la puce « registre ».`
    ).not.toBeNull();
    expect(
      elements.length,
      `${SDD_FILE} § 6.6.5 : la puce « Source « registre » » énumère ` +
        `${elements.length} élément(s) séparés par « ; », 5 attendus.`
    ).toBe(5);
    expect(
      /diagnostic de méthode/.test(elements[4]),
      `${SDD_FILE} § 6.6.5 : le CINQUIÈME élément de la source « registre » ` +
        `n'est pas le diagnostic de méthode exigé par SKILL-94 § D3.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer les deux issues du diagnostic (le numéro de
  // contrôle, ou `aucun`) en gardant le mot « diagnostic » → rouge. Sans elles,
  // la ligne écrite dans la spec redevient de la prose libre et la boucle de
  // retour vers la méthode est perdue — le dispositif tient ENTIÈREMENT à la
  // distinction entre « la méthode a un trou » (`aucun`) et « je ne l'ai pas
  // suivie » (un numéro).
  it('le diagnostic de la source « registre » énonce ses DEUX issues (un numéro, ou `aucun`)', () => {
    const section = etape665(readSkill());
    const puce = puceSource(section, '- **Source « registre »**');
    expect(puce, `${SDD_FILE} § 6.6.5 : puce « registre » introuvable.`).not.toBeNull();
    expect(
      /un numéro \(1 à 7\)/.test(puce) && /`aucun`/.test(puce),
      `${SDD_FILE} § 6.6.5 : le diagnostic ne nomme plus ses deux issues ` +
        `possibles — un numéro (1 à 7), ou \`aucun\` (SKILL-94 § D3).`
    ).toBe(true);
  });

  // L'orchestrateur écrit la RÉPONSE, jamais le ticket (finding de gate).
  //
  // La méthode de maturation — `rules/maturation.md` depuis SKILL-97, le
  // `CLAUDE.md` global avant lui — attache l'ouverture du `SKILL-NN` de méthode
  // à la FERMETURE de l'escalade (`backlog escalations close`, un geste de
  // l'utilisateur, après `/send`). L'Étape 6.6.5, elle, s'exécute PENDANT la
  // gate : aucune étape n'y ouvre de ticket, et deux lignes plus haut le skill
  // rappelle « tu n'arbitres pas ». Exiger l'id à ce moment force
  // l'orchestrateur à écrire un `SKILL-NN` littéral — que le lecteur suivant
  // lira comme une référence réelle (piège déjà constaté) — ou à laisser
  // l'escalade non conforme aux cinq éléments verrouillés ci-dessus. En
  // cross-repo, qui est le cas NOMINAL de ce skill, l'ouverture viserait de
  // surcroît le backlog d'un AUTRE dépôt (`~/.claude`), que cette étape
  // n'autorise pas à muter.
  //
  // ⚠️ Mutation-témoin : reformuler le cinquième élément en « …et si `aucun`,
  // l'id du ticket `SKILL-NN` ouvert sur la méthode » (la formulation du
  // premier jet) → rouge sur les deux assertions ci-dessous.
  it('la source « registre » interdit d’ouvrir le SKILL-NN ou d’en inventer l’id à cette étape', () => {
    const section = etape665(readSkill());
    const puce = puceSource(section, '- **Source « registre »**');
    expect(puce, `${SDD_FILE} § 6.6.5 : puce « registre » introuvable.`).not.toBeNull();
    expect(
      /`SKILL-NN`/.test(puce) && /n.invente aucun id/.test(puce),
      `${SDD_FILE} § 6.6.5 : le cinquième élément ne nomme plus le \`SKILL-NN\` ` +
        `de méthode, ou n'interdit plus d'en INVENTER l'id — un placeholder ` +
        `littéral se lit comme une référence réelle.`
    ).toBe(true);
    expect(
      /condition de la \*\*fermeture\*\*/.test(puce),
      `${SDD_FILE} § 6.6.5 : le cinquième élément ne rattache plus l'ouverture ` +
        `du \`SKILL-NN\` à la FERMETURE de l'escalade (le geste de ` +
        `l'utilisateur, hors gate) — il la demanderait donc à l'orchestrateur, ` +
        `qui n'a aucune étape pour l'ouvrir et, en cross-repo, devrait muter le ` +
        `backlog d'un autre dépôt.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin (SKILL-94 § Tests, cas 8) : ajouter le diagnostic à la
  // puce « première passe » → rouge. À ce stade la gate n'a pas eu lieu : il
  // n'y a pas encore de contrôle à incriminer, et l'ajout de D3 ne doit pas
  // contaminer cette source. Ce test contrôle les DEUX faces, l'annonce
  // (« trois éléments ») et le compte constaté — et vérifie au passage que le
  // renvoi croisé vers l'autre puce a suivi la renumérotation (« PAS les cinq
  // ci-dessus » : laissé à « quatre », il désignerait un compte qui n'existe
  // plus).
  it('la puce « première passe » compte TOUJOURS trois éléments, non contaminés par D3', () => {
    const section = etape665(readSkill());
    const puce = puceSource(section, '- **Source « première passe »**');
    expect(
      puce,
      `${SDD_FILE} § 6.6.5 : la puce de contenu « Source « première passe » » ` +
        `est introuvable.`
    ).not.toBeNull();
    expect(
      /trois éléments, PAS les cinq ci-dessus/.test(puce),
      `${SDD_FILE} § 6.6.5 : la puce « première passe » n'annonce plus trois ` +
        `éléments, ou son renvoi croisé désigne encore « les quatre ci-dessus » ` +
        `alors que la source « registre » en compte cinq depuis SKILL-94 § D3.`
    ).toBe(true);
    const elements = elementsApres(puce, /À la place\s*:/);
    expect(
      elements,
      `${SDD_FILE} § 6.6.5 : aucun « À la place : » dans la puce ` +
        `« première passe ».`
    ).not.toBeNull();
    expect(
      elements.length,
      `${SDD_FILE} § 6.6.5 : la puce « première passe » énumère ` +
        `${elements.length} élément(s) séparés par « ; », 3 attendus — ` +
        `l'ajout de SKILL-94 § D3 ne porte QUE sur la source « registre ».`
    ).toBe(3);
    expect(
      /diagnostic de méthode/.test(puce),
      `${SDD_FILE} § 6.6.5 : la puce « première passe » exige un diagnostic de ` +
        `méthode — or à ce stade la gate n'a pas eu lieu, aucun contrôle n'a ` +
        `encore pu manquer (SKILL-94 § Hors-scope).`
    ).toBe(false);
  });

  // ⚠️ Mutation-témoin : imposer un gabarit littéral (ex. citer une phrase
  // exacte entre guillemets à recopier mot pour mot) → rouge. Leçon directe de
  // SKILL-28 (spec § Décision 4, dernier paragraphe) : un gabarit verrouillé
  // empêche sa propre correction si sa logique se révèle fausse.
  //
  // ⚠️ Régression réelle du premier jet de ce test (finding 8 de la revue de
  // ce ticket) : une assertion qui ne vérifie que la PRÉSENCE de la formule
  // de désaveu (« pas de gabarit littéral ») reste vraie même si un gabarit
  // est ajouté À CÔTÉ d'elle — ajouter un gabarit ne retire pas le désaveu.
  // Ce test contrôle donc les DEUX faces : le désaveu est présent, ET aucune
  // citation-gabarit (blockquote Markdown `>`) ne figure dans la section.
  it('la section 6.6.5 ne verrouille pas de gabarit littéral à recopier', () => {
    const section = etape665(readSkill());
    expect(
      /pas de gabarit littéral/.test(section),
      `${SDD_FILE} § 6.6.5 ne porte plus le désaveu explicite de gabarit ` +
        `littéral.`
    ).toBe(true);
    expect(
      /^\s*>\s/m.test(section),
      `${SDD_FILE} § 6.6.5 contient une citation en blockquote (\`>\`) : un ` +
        `gabarit littéral à recopier mot pour mot a été réintroduit, malgré ` +
        `le désaveu qui reste présent à côté.`
    ).toBe(false);
  });
});

describe('SKILL-31 — l’Étape 7 renvoie vers la 6.6.5', () => {
  // ⚠️ Régression réelle du premier jet de ce test (finding 2 de la revue de
  // ce ticket) : `## Étape 8` N'EXISTE PAS dans ce skill (le dernier titre
  // numéroté est `## Étape 7`, suivi de `## Règles strictes`) — l'ancre de
  // fin était donc TOUJOURS introuvable, `extractBetween` rendait TOUJOURS
  // `null`, et le repli `?? raw.slice(...)` prenait la fenêtre jusqu'à EOF à
  // CHAQUE exécution. Combiné au pont `[\s\S]*?` entre les deux ancres,
  // l'assertion restait satisfiable par n'importe quelle mention de
  // « Étape 6.6.5 » située n'importe où après la ligne de la phrase — y
  // compris une mention SANS RAPPORT ajoutée plus loin dans la même section
  // (ex. « signale son chemin … les escalades E1/E3 peuvent encore avoir
  // besoin de l'arbre (Étape 6.6.5) »). Fixé en (1) bornant l'Étape 7 à sa
  // VRAIE ancre de fin (`## Règles strictes`), (2) isolant le PARAGRAPHE qui
  // porte la phrase (découpe sur ligne vide), pas toute la section.
  it('la phrase de l’Étape 7 sur les escalades E1/E3 renvoie vers l’Étape 6.6.5', () => {
    const raw = readSkill();
    const section7 = extractBetween(raw, '## Étape 7', '## Règles strictes');
    expect(
      section7,
      `${SDD_FILE} : section "## Étape 7" → "## Règles strictes" introuvable.`
    ).not.toBeNull();
    const paragraphe = section7
      .split(/\n\s*\n/)
      .find((p) => p.includes('escalades éventuelles (E1/E3)'));
    expect(
      paragraphe,
      `${SDD_FILE} : aucun paragraphe de l'Étape 7 ne mentionne « escalades ` +
        `éventuelles (E1/E3) » — la phrase qui devait renvoyer vers l'Étape ` +
        `6.6.5 a disparu.`
    ).not.toBeUndefined();
    expect(
      paragraphe.includes('Étape 6.6.5'),
      `${SDD_FILE} : le paragraphe de l'Étape 7 sur les escalades E1/E3 ne ` +
        `renvoie plus vers l'Étape 6.6.5 qui les rend durables (recherché ` +
        `dans SON PROPRE paragraphe, pas ailleurs dans la section).`
    ).toBe(true);
  });
});

// SKILL-90 — la condition d'exécution de l'Étape 6.6.5 gagne une SECONDE
// source : une escalade de spec déclarée par l'implémenteur dans son rapport
// de première passe (D3, specs/skill-90.md). L'Étape 6.6 gagne l'avertissement
// qui interdit d'ajouter cette escalade à l'équation `U uniques = U disposés`.

describe('SKILL-90 — l’Étape 6.6.5 déclenche AUSSI sur une escalade de première passe', () => {
  // ⚠️ Mutation-témoin : retirer la seconde source, OU la découpler de la
  // première (par exemple la déplacer dans un paragraphe séparé, sans « ou »
  // de jonction) → rouge. Régression réelle du premier jet de ce test (finding
  // 8, gate de revue de ce ticket) : la première moitié de cette assertion
  // recopiait mot pour mot la regex déjà posée en SKILL-31 (ligne ~60,
  // `it('la section 6.6.5 prescrit : déclenchement seulement si le registre
  // porte E1 ou E3')`) — un pur doublon, qui aurait fait rougir DEUX tests
  // portant des justifications contradictoires sur la même ancre si un futur
  // ticket reformulait cette clause. Fixé en testant la JONCTION des deux
  // sources comme UNE SEULE regex continue (la première source suivie de
  // « , ou si l'implémenteur a … première passe ») : c'est l'ajout de ce
  // ticket, pas un fait déjà couvert ailleurs, et il rougit si la seconde
  // source disparaît OU si elle cesse d'être une alternative de la première.
  it('la condition d’exécution de 6.6.5 nomme la seconde source, EN JONCTION avec la première', () => {
    const section = etape665(readSkill());
    expect(
      /porte au moins\s*\n?\s*une disposition `escaladé — E1` ou `escaladé — E3`,\s*\n?\s*ou si l.implémenteur a\s*\n?\s*déclaré une escalade de spec dans son rapport de première passe/i.test(
        section
      ),
      `${SDD_FILE} § 6.6.5 ne nomme plus la seconde source (une escalade de ` +
        `spec déclarée par l'implémenteur dans son rapport de première passe) ` +
        `en alternative de la première (une disposition escaladée du registre).`
    ).toBe(true);
  });
});

describe('SKILL-90 — l’Étape 6.6 interdit d’ajouter l’escalade de première passe à l’équation', () => {
  // ⚠️ Mutation-témoin : retirer l'interdit → rouge. Sans lui, un
  // orchestrateur pourrait compter une escalade de première passe dans `U`,
  // faisant diverger « U uniques = U disposés » (D3, specs/skill-90.md).
  it('la section 6.6 interdit explicitement d’ajouter cette escalade aux `U`', () => {
    const raw = readSkill();
    const section66 = extractBetween(raw, '## Étape 6.6 ', '## Étape 6.6.5');
    expect(
      section66,
      `${SDD_FILE} : section "## Étape 6.6 " → "## Étape 6.6.5" introuvable.`
    ).not.toBeNull();
    expect(
      /hors équation/i.test(section66),
      `${SDD_FILE} § 6.6 ne dit plus explicitement qu'une escalade de ` +
        `première passe est hors de l'équation \`U uniques = U disposés\`.`
    ).toBe(true);
    expect(
      /n.est pas un finding/i.test(section66),
      `${SDD_FILE} § 6.6 ne dit plus explicitement qu'une escalade de ` +
        `première passe n'est pas un finding.`
    ).toBe(true);
  });

  // Régression réelle du premier jet de ce test (finding 6, gate de revue de
  // ce ticket) : `section66.includes('git status pendant la revue')` était
  // DÉJÀ vrai avant ce ticket (la chaîne vit dans le gabarit du registre,
  // ligne `git status pendant la revue : propre | …`, et dans la prose qui
  // l'explique) — l'assertion ne pouvait rougir sur AUCUNE mutation de ce
  // ticket, y compris la suppression totale du bullet ajouté par SKILL-90.
  // Fixé en isolant D'ABORD le bullet qui porte « hors équation » (le seul
  // que ce ticket ajoute), PUIS en vérifiant qu'IL contient, lui, la mention
  // de la ligne `git status pendant la revue` — pas la section entière.
  //
  // ⚠️ Ce fix était INCOMPLET (constaté par la gate de SKILL-105, escaladé en
  // `SKILL-105 · E1 (finding 6)`, réparé par SKILL-108) : `split(/\n(?=- )/)`
  // seul rend, en bloc d'INDICE 0, le PRÉAMBULE de la section — tout ce qui
  // précède la première puce, et qui ne commence donc PAS par `- ` — or ce
  // préambule porte DÉJÀ la locution « hors équation » (dans les deux lignes
  // `… | <résumé — hors équation, Étape 6.6.5>` du gabarit du registre) et
  // `git status pendant la revue`. Le `find` s'arrêtait donc sur le préambule
  // quelle que soit la rédaction des puces — y compris leur suppression
  // intégrale — et les deux assertions ci-dessous restaient vertes pour la
  // mauvaise raison. SKILL-108 le complète par un filtre sur les blocs qui
  // commencent réellement par un tiret, qui élimine ce préambule avant le
  // `find`, et par `platir`, qui protège l'assertion de contenu d'un futur
  // ré-enroulement de la puce.
  //
  // ⚠️ Mutations-témoins (specs/skill-108.md, § Tests, cas 1 et 2) : retirer
  // intégralement la puce « hors équation » → `bulletHorsEquation` devient
  // `undefined`, `expect(bulletHorsEquation).not.toBeUndefined()` rouge.
  // Retirer `git status pendant la revue` de cette seule puce (en la
  // laissant ailleurs dans la section) → `bulletHorsEquation.includes('git
  // status pendant la revue')` rouge.
  it('le bullet « hors équation » de la section 6.6 rattache lui-même sa ligne du gabarit à `git status pendant la revue`', () => {
    const raw = readSkill();
    const section66 = extractBetween(raw, '## Étape 6.6 ', '## Étape 6.6.5');
    expect(section66).not.toBeNull();
    const bulletHorsEquation = section66
      .split(/\n(?=- )/)
      .filter((b) => /^- /.test(b))
      .map((b) => platir(b))
      .find((b) => /hors équation/i.test(b));
    expect(
      bulletHorsEquation,
      `${SDD_FILE} § 6.6 : aucun bullet ne porte « hors équation ».`
    ).not.toBeUndefined();
    expect(
      bulletHorsEquation.includes('git status pendant la revue'),
      `${SDD_FILE} § 6.6 : le bullet « hors équation » lui-même ne mentionne ` +
        `plus \`git status pendant la revue\` — la seule assertion qui le ` +
        `liait à cette ligne du gabarit a disparu.`
    ).toBe(true);
  });
});

// ============================================================================
// SKILL-105 (D1) — la TROISIÈME source de l'Étape 6.6.5 : le constat que
// l'orchestrateur forme lui-même à l'Étape 6.6, en croisant la matière du
// registre avec une clause nommée de la spec. Exercée trois fois hors contrat
// (specs/skill-102.md, specs/skill-107.md, specs/skill-86.md) avant d'être
// écrite ; elle l'est ici AVEC ses trois conditions d'admissibilité, sans
// lesquelles l'Étape 6.6 deviendrait une quatrième relecture — faite par celui
// qui n'a justement pas relu le diff (specs/skill-105.md, § Problème).
// ============================================================================

// ⚠️ Apostrophe DROITE : `commands/sdd-run-ticket.md` n'en emploie pas d'autre
// (`grep -c "’"` rend 0). Une ancre à apostrophe typographique ne matcherait
// rien, en silence.
const AMORCE_CONSTAT = "- **Source « constat d'orchestrateur »**";

// Le paragraphe ⛔ qui porte les TROIS conditions d'admissibilité et la borne
// « pas une relecture ». ⛔ Borné à CE paragraphe, jamais à la section : le mot
// « ancrage » d'une puce voisine suffirait à satisfaire une assertion large
// (specs/skill-105.md, § Tests, cas 3).
const paragrapheConditions = (raw) =>
  sectionEntre(etape665(raw), '⛔ **La troisième source', '- **Où** :', SDD_FILE);

describe('SKILL-105 — 6.6.5 : la condition d’exécution nomme la TROISIÈME source', () => {
  // ⛔ Regex bornée à l'INCRÉMENT — la seconde source suivie de la troisième —
  // jamais la chaîne complète depuis la première : celle-là est déjà couverte
  // deux fois (SKILL-31 ligne ~60, puis SKILL-90 « EN JONCTION »), et SKILL-90
  // documente en propre qu'un troisième exemplaire ferait rougir trois `it()`
  // aux justifications contradictoires sur la même ancre.
  //
  // ⚠️ Mutations : retirer la troisième source → rouge ; la déplacer dans un
  // paragraphe séparé, hors de la phrase de jonction (donc sans le « , ou si »
  // qui l'enchaîne à la seconde) → rouge.
  it('la troisième source est nommée EN JONCTION avec la seconde, dans la même phrase', () => {
    const section = etape665(readSkill());
    expect(
      /« Si tu te trouves bloqué »\)\s*,\s*\n?\s*ou si TU as toi-même formé un\s*\n?\s*constat d.Étape 6\.6/.test(
        section
      ),
      `${SDD_FILE} § 6.6.5 ne nomme plus la troisième source (le constat que ` +
        `l'orchestrateur forme lui-même à l'Étape 6.6) en alternative de la ` +
        `SECONDE, dans la même phrase de déclenchement.`
    ).toBe(true);
  });
});

describe('SKILL-105 — 6.6.5 : les TROIS conditions d’admissibilité de la troisième source', () => {
  // ⛔ Trois `it()` distincts, jamais une assertion unique : c'est leur
  // CONJONCTION qui borne la source, et une assertion unique en laisserait
  // disparaître une sans rougir (même doctrine que le cas 2 de
  // `portee-conventionnelle-coherence.test.js`).
  const CONDITIONS = [
    [
      '1 — ancrage sur un élément que le registre porte DÉJÀ',
      [/\*\*Ancrage\*\*/, /que le\s+registre porte \*\*déjà\*\*/, /clause \*\*nommée\*\* de la spec/],
      `sans ancrage, le constat n'est plus qu'une relecture de plus, faite ` +
        `par celui qui n'a pas relu le diff.`,
    ],
    [
      '2 — défaut d’AUTORITÉ (pas de capacité)',
      [/\*\*Défaut d.autorité\*\*/, /Ce n.est pas un défaut de\s*\n?\s*\*\*capacité\*\*/],
      `l'orchestrateur PEUT écrire dans cette spec — c'est même ce que ` +
        `l'étape lui fait faire ; la frontière est entre écrire l'escalade et ` +
        `trancher à la place de l'utilisateur.`,
    ],
    [
      '3 — péremption : sans l’écrire, l’information meurt avec la session',
      [/\*\*Péremption\*\*/, /meurt avec la\s*\n?\s*session/],
      `c'est la condition qui distingue un constat durable d'un rappel que ` +
        `le registre ou un ticket porte déjà.`,
    ],
  ];

  // ⚠️ Mutation, une par entrée : retirer cette condition du paragraphe ⛔ →
  // rouge, celle-là seule.
  for (const [label, motifs, pourquoi] of CONDITIONS) {
    it(`le paragraphe ⛔ porte la condition ${label}`, () => {
      const p = paragrapheConditions(readSkill());
      for (const motif of motifs) {
        expect(
          motif.test(p),
          `${SDD_FILE} § 6.6.5 : le paragraphe des conditions ne porte plus ` +
            `« ${motif} » (condition ${label}) — ${pourquoi}`
        ).toBe(true);
      }
    });
  }

  // ⚠️ Mutation : écrire les trois conditions en alternatives (« l'une des
  // trois suffit ») → rouge. Trois conditions dont une suffirait ne borneraient
  // rien, et une source d'escalade sans garde-fou transforme l'Étape 6.6 en
  // quatrième relecture.
  it('les trois conditions sont déclarées CUMULATIVES, et une qui manque FERME la source', () => {
    const p = paragrapheConditions(readSkill());
    expect(
      /cumulatives/i.test(p),
      `${SDD_FILE} § 6.6.5 : le paragraphe des conditions ne dit plus qu'elles ` +
        `sont cumulatives.`
    ).toBe(true);
    expect(
      /ferme[^.]*(?:elle ne l.assouplit pas)/i.test(platir(p)),
      `${SDD_FILE} § 6.6.5 : le paragraphe ne dit plus qu'une condition qui ` +
        `manque FERME la source au lieu de l'assouplir — sans cette phrase, ` +
        `les trois conditions se lisent comme des recommandations.`
    ).toBe(true);
  });

  // C'est la seule assertion qui garde le dispositif contre son propre effet
  // de bord (specs/skill-105.md, § Tests, cas 4).
  // ⚠️ Mutation : retirer cette borne → rouge.
  it('le paragraphe ⛔ dit que le constat N’EST PAS une relecture — 6.6 n’est pas une seconde gate', () => {
    const p = platir(paragrapheConditions(readSkill()));
    expect(
      /ce n.est pas un constat mais une \*\*relecture\*\*/.test(p),
      `${SDD_FILE} § 6.6.5 : la borne « sans ancrage, ce n'est pas un constat ` +
        `mais une relecture » a disparu.`
    ).toBe(true);
    expect(
      /tu n.es pas relecteur, et l.Étape 6\.6 n.est pas une seconde\s*gate/.test(p),
      `${SDD_FILE} § 6.6.5 : la section ne dit plus que l'orchestrateur n'est ` +
        `pas relecteur et que l'Étape 6.6 n'est pas une seconde gate — la ` +
        `troisième source devient une quatrième relecture.`
    ).toBe(true);
  });

  // ⛔ Le défaut que l'implémenteur POUVAIT corriger est un finding manqué par
  // la gate, pas une escalade : fabriquer une escalade pour le loger est
  // l'inverse exact de ce dispositif.
  // ⚠️ Mutation : retirer cette clause → rouge.
  it('le paragraphe ⛔ interdit de fabriquer une escalade pour loger un finding manqué', () => {
    const p = platir(paragrapheConditions(readSkill()));
    expect(
      /est un finding que la gate a manqué/.test(p) &&
        /fabriquer une escalade pour le loger/.test(p),
      `${SDD_FILE} § 6.6.5 : la clause qui renvoie un défaut corrigeable vers ` +
        `« finding manqué par la gate », et interdit de fabriquer une escalade ` +
        `pour le loger, a disparu.`
    ).toBe(true);
  });
});

describe('SKILL-105 — 6.6.5 : la puce « constat d’orchestrateur » et ses CINQ éléments', () => {
  // Réutilise les helpers REMONTÉS au module — ⛔ pas une variante recopiée.
  //
  // ⚠️ Mutations : retirer un élément en laissant « cinq » dans la prose →
  // rouge sur le compte constaté ; le retirer AVEC son annonce → rouge sur
  // l'annonce.
  it('la puce énumère CINQ éléments, le premier étant l’ANCRAGE et le cinquième le diagnostic', () => {
    const section = etape665(readSkill());
    const puce = puceSource(section, AMORCE_CONSTAT);
    expect(
      puce,
      `${SDD_FILE} § 6.6.5 : la puce de contenu « Source « constat ` +
        `d'orchestrateur » » est introuvable.`
    ).not.toBeNull();
    expect(
      /cinq\s+éléments/.test(puce),
      `${SDD_FILE} § 6.6.5 : la puce « constat d'orchestrateur » n'annonce ` +
        `plus CINQ éléments.`
    ).toBe(true);
    const elements = elementsApres(puce, /éléments\s*:/);
    expect(
      elements,
      `${SDD_FILE} § 6.6.5 : aucun « éléments : » dans la puce « constat ` +
        `d'orchestrateur » — le compte ne peut pas être constaté.`
    ).not.toBeNull();
    expect(
      elements.length,
      `${SDD_FILE} § 6.6.5 : la puce « constat d'orchestrateur » énumère ` +
        `${elements.length} élément(s) séparés par « ; », 5 attendus. ⚠️ Cette ` +
        `puce doit porter EXACTEMENT quatre « ; », parenthèses comprises.`
    ).toBe(5);
    expect(
      /ancrage/i.test(elements[0]),
      `${SDD_FILE} § 6.6.5 : le PREMIER élément de la troisième source n'est ` +
        `plus l'ancrage — c'est pourtant ce qui la distingue de la source ` +
        `« registre », dont le premier élément est un numéro de finding.`
    ).toBe(true);
    expect(
      /diagnostic de méthode/.test(elements[4]),
      `${SDD_FILE} § 6.6.5 : le CINQUIÈME élément de la troisième source n'est ` +
        `plus le diagnostic de méthode.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer, de la puce, la mention que le constat n'est PAS une
  // disposition `escaladé` → rouge. C'est la moitié de l'ancrage qui dit d'où
  // le constat sort, et elle est ce qui empêche de le confondre avec la
  // première source.
  it('l’ancrage dit d’emblée que le constat n’est PAS une disposition `escaladé`', () => {
    const puce = puceSource(etape665(readSkill()), AMORCE_CONSTAT);
    expect(puce, `${SDD_FILE} § 6.6.5 : puce « constat » introuvable.`).not.toBeNull();
    expect(
      /n.est \*\*pas\*\* une disposition\s*`escaladé`/.test(puce),
      `${SDD_FILE} § 6.6.5 : l'élément d'ancrage ne dit plus que le constat ` +
        `n'est PAS une disposition \`escaladé\` du registre.`
    ).toBe(true);
  });

  // ⚠️ Mutation : rétablir « dans les deux cas » dans le préambule des puces de
  // contenu → rouge. Un compte laissé à deux fait sauter la troisième puce à un
  // lecteur qui suit le préambule (specs/skill-105.md, § Tests, cas 5).
  it('le préambule des puces de contenu compte TROIS sources, plus deux', () => {
    const section = etape665(readSkill());
    const preambule = puceSource(section, '- **Contenu requis, pas de gabarit littéral**');
    expect(
      preambule,
      `${SDD_FILE} § 6.6.5 : la puce « Contenu requis » est introuvable.`
    ).not.toBeNull();
    expect(
      /dans les trois cas/.test(preambule),
      `${SDD_FILE} § 6.6.5 : le préambule des puces de contenu ne compte plus ` +
        `TROIS cas — il y a désormais trois sources, et un lecteur qui suit le ` +
        `préambule sauterait la troisième puce.`
    ).toBe(true);
    expect(
      /dans les deux cas/.test(preambule),
      `${SDD_FILE} § 6.6.5 : le préambule des puces de contenu compte encore ` +
        `« les deux cas » — le compte est faux depuis l'ajout de la troisième ` +
        `source.`
    ).toBe(false);
  });

  // La section porte un SECOND compte des listes de contenu, dans la puce
  // « Une seule contrainte de forme » (SKILL-64) : « ce désaveu de gabarit
  // porte sur les DEUX listes de contenu ci-dessus ». La troisième liste le
  // rend faux exactement comme le préambule ci-dessus, et pour un coût pire —
  // un lecteur qui compte les listes couvertes par le désaveu conclut que la
  // troisième n'en fait PAS partie, donc que ses cinq éléments sont un gabarit
  // à recopier au mot près, l'inverse exact de l'intention. C'est le défaut
  // que `SKILL-104 · E1 (finding 8)` nomme : une énumération rendue incomplète
  // par le ticket qui l'a rendue incomplète.
  // ⚠️ Mutation : rétablir « les deux listes de contenu » → rouge.
  it('le désaveu de gabarit porte sur les TROIS listes de contenu, plus deux', () => {
    const puce = puceSource(
      etape665(readSkill()),
      '- **Une seule contrainte de forme, sur le titre du `###`**'
    );
    expect(
      puce,
      `${SDD_FILE} § 6.6.5 : la puce « Une seule contrainte de forme » est ` +
        `introuvable.`
    ).not.toBeNull();
    expect(
      /désaveu de gabarit porte sur les \*\*trois\*\* listes de contenu/.test(puce),
      `${SDD_FILE} § 6.6.5 : le désaveu de gabarit ne porte plus sur les ` +
        `TROIS listes de contenu — une liste laissée hors du désaveu se lit ` +
        `comme un gabarit littéral à recopier.`
    ).toBe(true);
    expect(
      /porte sur les deux listes de contenu/.test(puce),
      `${SDD_FILE} § 6.6.5 : le désaveu de gabarit compte encore DEUX listes ` +
        `de contenu — il y en a trois depuis l'ajout de la source ` +
        `« constat d'orchestrateur ».`
    ).toBe(false);
  });

  // NON-RÉGRESSION (specs/skill-105.md, § Tests, cas 8) : les deux puces
  // existantes ne sont PAS retouchées — « registre » garde ses cinq éléments,
  // « première passe » ses trois. Aucune assertion neuve ici : leurs familles
  // (SKILL-31/SKILL-94 et SKILL-90, plus haut dans ce fichier) restent
  // inchangées et doivent rester vertes.
});

describe('SKILL-105 — 6.6 : la ligne `Constat d’orchestrateur` du gabarit et de l’exemple', () => {
  const section66 = (raw) => sectionEntre(raw, '## Étape 6.6 ', '## Étape 6.6.5', SDD_FILE);
  const casUsage = (raw) =>
    sectionEntre(raw, "## Cas d'usage typique", '### Variante cross-repo', SDD_FILE);

  // ⚠️ Mutation : retirer la ligne du gabarit → rouge.
  it('le gabarit du registre porte la ligne `Constat d’orchestrateur`, avec `aucun` par défaut', () => {
    const s = section66(readSkill());
    expect(
      /Constat d.orchestrateur : aucun/.test(s),
      `${SDD_FILE} § 6.6 : le gabarit du registre ne porte plus la ligne ` +
        `\`Constat d'orchestrateur\` avec son défaut explicite \`aucun\` — le ` +
        `défaut explicite est le garde-fou : il oblige à répondre, donc à ne ` +
        `pas inventer.`
    ).toBe(true);
  });

  // ⚠️ Mutation : la retirer de l'exemple SEULEMENT → rouge. C'est le seul
  // instrument qui voit l'exemple : sans lui, l'exemple contredit le gabarit
  // (specs/skill-105.md, § Tests, cas 6).
  it('le § Cas d’usage typique porte lui aussi la ligne `Constat d’orchestrateur : aucun`', () => {
    const s = casUsage(readSkill());
    expect(
      /Constat d.orchestrateur : aucun/.test(s),
      `${SDD_FILE} § Cas d'usage typique : le registre d'exemple ne porte pas ` +
        `la ligne \`Constat d'orchestrateur : aucun\` — l'exemple contredit le ` +
        `gabarit de l'Étape 6.6.`
    ).toBe(true);
  });

  // Les PUCES de la section — les blocs qui commencent réellement par `- `.
  //
  // ⛔ La découpe part de `section66` déclaré ci-dessus, JAMAIS d'un second
  // `sectionEntre(raw, '## Étape 6.6 ', '## Étape 6.6.5', …)` recopié : deux
  // découpes du même couple d'ancres, à quelques lignes d'intervalle dans le
  // même `describe`, divergent en silence le jour où un ticket renomme le
  // titre `## Étape 6.6` ou insère une `## Étape 6.6.4` et ne met à jour que
  // celle qu'il voit — l'une pointerait sur la bonne tranche, l'autre
  // rougirait seule, avec un message qui ne dit pas que la copie existe.
  //
  // ⚠️ Constat fait en écrivant ce ticket, et il vaut d'être noté : le `find`
  // de SKILL-90 (`section66.split(/\n(?=- )/).find(…/hors équation/i…)`, plus
  // haut dans ce fichier) ne rend PAS la puce qu'il croit rendre — et la cause
  // n'est pas un point d'enroulement. `split(/\n(?=- )/)` rend, en bloc
  // d'INDICE 0, le PRÉAMBULE de la section (tout ce qui précède la première
  // puce, et qui ne commence donc pas par `- `) ; or ce préambule porte DÉJÀ
  // la locution, dans les deux lignes `… | <résumé — hors équation, Étape
  // 6.6.5>` du gabarit du registre, ainsi que `git status pendant la revue`.
  // Le `find` s'arrête sur lui quelle que soit la rédaction des puces —
  // ré-enrouler ou dé-enrouler la puce n'y change rien. Constat rejouable :
  // `blocks.findIndex((b) => /hors équation/i.test(b))` rend `0` et
  // `blocks[0].startsWith('- ')` rend `false` — déjà vrai sur le commit
  // d'AVANT ce ticket. Son assertion était donc verte pour une autre raison
  // que celle annoncée : ce constat reste vrai du `split` NU, comme
  // HISTORIQUE du défaut, mais plus aucune assertion ne consomme ce `split`
  // nu — SKILL-108 (`SKILL-105 · E1 (finding 6)`) l'a réparé en ajoutant à
  // l'`it()` de SKILL-90, plus haut dans ce fichier, le même filtre que
  // celui-ci. Ce fichier LA RÉÉCRIT DÉSORMAIS, sous l'autorisation de
  // SKILL-108 — elle n'appartenait pas à SKILL-105, dont le § ✅ Autorisation
  // écrite n'autorisait sur son code existant que la remontée des deux
  // helpers. Les assertions de SKILL-105 ci-dessous filtrent explicitement
  // les VRAIES puces et aplatissent avant de chercher, de sorte qu'aucune ne
  // dépende du point d'enroulement ni du préambule ; l'assertion d'unicité
  // plus bas protège désormais DEUX consommateurs — `puceHorsEquation`
  // (SKILL-105) et le `find` de SKILL-90, qui regarde lui aussi les vraies
  // puces depuis SKILL-108 — et non plus seulement le premier.
  const pucesDe66 = (raw) =>
    section66(raw)
      .split(/\n(?=- )/)
      .filter((b) => /^- /.test(b))
      .map((b) => platir(b));

  const puceHorsEquation = (raw) =>
    pucesDe66(raw).find((b) => /hors équation/i.test(b));

  // ⚠️ Mutation : ajouter les lignes mais laisser la puce ne parler que de la
  // première passe → rouge.
  it('la puce « hors équation » couvre les DEUX lignes hors registre', () => {
    const puce = puceHorsEquation(readSkill());
    expect(
      puce,
      `${SDD_FILE} § 6.6 : aucune PUCE ne porte « hors équation ».`
    ).not.toBeUndefined();
    expect(
      puce.includes('`Escalade de spec (première passe)`') &&
        puce.includes("`Constat d'orchestrateur`"),
      `${SDD_FILE} § 6.6 : la puce « hors équation » ne nomme plus les DEUX ` +
        `lignes hors registre — celle de première passe (SKILL-90) et celle du ` +
        `constat d'orchestrateur (SKILL-105).`
    ).toBe(true);
  });

  // ⛔ Assertion d'UNICITÉ : la puce existante est ÉTENDUE, jamais dupliquée.
  // Une seconde puce portant la même locution rendrait silencieusement ambigu
  // tout `find` qui isole une puce par cette locution. Depuis SKILL-108, ce
  // garde protège DEUX consommateurs (cf. le constat au-dessus de
  // `pucesDe66`, point 2) : `puceHorsEquation` de CE `describe` (SKILL-105),
  // et le `find` de SKILL-90 plus haut dans ce fichier, qui filtre désormais
  // lui aussi les vraies puces avant de chercher — il n'est donc plus vrai
  // qu'il « s'arrête sur le préambule » ou que l'unicité « ne le protège de
  // rien ». Avant SKILL-108, seul `puceHorsEquation` en dépendait. Le défaut
  // est invisible tant qu'il ne rougit pas.
  // ⚠️ Mutation : dupliquer la puce au lieu de l'étendre → rouge.
  it('EXACTEMENT une puce de la section 6.6 porte la locution « hors équation »', () => {
    const puces = pucesDe66(readSkill()).filter((b) => /hors équation/i.test(b));
    expect(
      puces.length,
      `${SDD_FILE} § 6.6 : ${puces.length} puce(s) portent « hors équation », ` +
        `1 attendue. Une seconde puce ferait porter sur le mauvais bloc toute ` +
        `assertion qui isole celle-ci par sa locution.`
    ).toBe(1);
  });

  // La clause d'adjacence que l'insertion rend fausse : la ligne de première
  // passe ne « précède immédiatement » plus `git status pendant la revue`.
  // Aucun test ne le voyait ; celui-ci le voit.
  // ⚠️ Mutation : rétablir la formule → rouge.
  it('la puce « hors équation » ne dit plus « précède immédiatement »', () => {
    const puce = puceHorsEquation(readSkill());
    expect(
      puce,
      `${SDD_FILE} § 6.6 : aucune PUCE ne porte « hors équation ».`
    ).not.toBeUndefined();
    expect(
      /précède immédiatement/.test(puce),
      `${SDD_FILE} § 6.6 : la puce « hors équation » affirme encore que la ` +
        `ligne de première passe « précède immédiatement » ` +
        `\`git status pendant la revue\` — l'insertion de la ligne ` +
        `\`Constat d'orchestrateur\` entre les deux a rendu la clause fausse.`
    ).toBe(false);
  });

  // Le DÉCLENCHEUR de chaque ligne, un par ligne. L'extension de la puce à
  // deux lignes avait fait disparaître la subordonnée qui disait QUAND la
  // remplir (« si le rapport de première passe de l'implémenteur en portait
  // une »), sans la remplacer pour aucune des deux — alors que leurs
  // déclencheurs sont distincts : une déclaration REÇUE de l'implémenteur d'un
  // côté, un constat FORMÉ par l'orchestrateur sous les trois conditions du
  // § 6.6.5 de l'autre. Sans eux, un orchestrateur qui a reçu une déclaration
  // de première passe peut porter le résumé sur `Constat d'orchestrateur` :
  // le registre déclare alors un constat qui n'a jamais eu lieu, et l'Étape
  // 6.6.5 lui réclame un ancrage qu'il devra INVENTER — l'inverse exact du
  // dispositif.
  // ⚠️ Mutations : retirer l'un des deux déclencheurs → rouge sur celui-là.
  it('la puce « hors équation » dit sous QUEL déclencheur chaque ligne porte un résumé', () => {
    const puce = puceHorsEquation(readSkill());
    expect(
      puce,
      `${SDD_FILE} § 6.6 : aucune PUCE ne porte « hors équation ».`
    ).not.toBeUndefined();
    expect(
      /si le rapport de première passe de l.implémenteur en portait une/.test(puce),
      `${SDD_FILE} § 6.6 : la puce « hors équation » ne dit plus que la ligne ` +
        `\`Escalade de spec (première passe)\` ne porte un résumé QUE si le ` +
        `rapport de première passe en portait une — rien ne rattache plus le ` +
        `résumé à SA ligne.`
    ).toBe(true);
    expect(
      /si TU as toi-même formé un constat/.test(puce),
      `${SDD_FILE} § 6.6 : la puce « hors équation » ne dit plus que la ligne ` +
        `\`Constat d'orchestrateur\` ne porte un résumé QUE si tu as toi-même ` +
        `formé un constat — un registre peut déclarer un constat qui n'a ` +
        `jamais eu lieu.`
    ).toBe(true);
  });
});

describe('SKILL-105 — 6.2 : le détour du dosage `none` BORNE la troisième source', () => {
  // ⚠️ Mutation : étendre le détour à la troisième source → rouge. En dosage
  // `none`, les Étapes 6.3 à 6.6 n'ont pas lieu : il n'existe aucun registre
  // d'où un constat pourrait sortir, donc la condition 1 (ancrage) n'a aucune
  // matière.
  it('l’Étape 6.2 dit que le détour reste borné à la SECONDE source', () => {
    const s = sectionEntre(readSkill(), '## Étape 6.2', '## Étape 6.3', SDD_FILE);
    const plat = platir(s);
    expect(
      /reste borné à cette SECONDE source/.test(plat),
      `${SDD_FILE} § 6.2 : le détour du dosage \`none\` ne dit plus qu'il ` +
        `reste borné à la SECONDE source — rien n'empêche plus de le lire ` +
        `comme couvrant aussi le constat d'Étape 6.6.`
    ).toBe(true);
    expect(
      /la troisième[\s\S]{0,80}?n.y a \*\*aucun objet\*\*/.test(plat),
      `${SDD_FILE} § 6.2 : le détour ne dit plus que la TROISIÈME source n'a ` +
        `AUCUN OBJET en dosage \`none\`.`
    ).toBe(true);
    expect(
      /n.exécutant pas l.Étape 6\.6/.test(plat),
      `${SDD_FILE} § 6.2 : le motif a disparu — un dosage \`none\` n'exécute ` +
        `pas l'Étape 6.6, donc aucun registre n'existe d'où un constat ` +
        `pourrait sortir.`
    ).toBe(true);
  });
});
