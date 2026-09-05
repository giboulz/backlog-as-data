import { describe, it, expect } from "vitest";
import { CHEATSHEET, ADOPTION_README, GLOBAL_TOOL_CMD } from "@/lib/backlog/adoption-readme";

// INFRA-14 (N10) — Les deux textes d'adoption se documentent eux-mêmes : la
// cheatsheet (imprimée par `init`/`help`) et le guide global (écrit par
// `self-update` dans ~/.claude/tools/backlog/README.md) doivent citer les
// commandes clés et l'emplacement global, sinon le « filet anti-oubli » est vide.

describe("textes d'adoption", () => {
  it("N10 — CHEATSHEET cite les commandes clés", () => {
    for (const cmd of ["init", "new", "mature", "list", "help"]) {
      expect(CHEATSHEET).toContain(cmd);
    }
  });

  // INFRA-30 — la cheatsheet est la seule surface de découverte in-repo du CLI
  // (`help`/`init`). N10 ne verrouillait que le NOM des commandes : un flag ajouté
  // à `mature` pouvait donc rester invisible alors que la chaîne d'usage d'erreur,
  // elle, était à jour. On verrouille les flags de `mature`, pas juste son nom.
  it("N11 — CHEATSHEET documente tous les flags de mature", () => {
    for (const flag of ["--model", "--effort", "--date", "--review", "--override-coherence"]) {
      expect(CHEATSHEET).toContain(flag);
    }
    // Les valeurs admises sont citées, pas seulement le nom du flag.
    expect(CHEATSHEET).toContain("none|light|deep");
  });

  // BLG-06 — même motif que N11 : --override-coherence documente la RÈGLE qu'il
  // surcharge (le plancher opus), pas seulement son propre nom — sinon la
  // cheatsheet dit qu'un override existe sans dire de quoi.
  it("BLG-06 — CHEATSHEET explique la règle de cohérence que --override-coherence surcharge", () => {
    expect(CHEATSHEET).toContain("opus");
    expect(CHEATSHEET).toMatch(/coh[ée]rence/i);
  });

  // INFRA-32 — --review rejoint model/effort/date comme flag requis à la
  // maturation : la cheatsheet ne doit plus le présenter entre crochets
  // (optionnel), et doit parler de « triplet » (pas « couple »).
  it("INFRA-32 — CHEATSHEET présente --review comme requis (triplet)", () => {
    expect(CHEATSHEET).not.toContain("[--review");
    expect(CHEATSHEET).toContain("triplet");
  });

  // INFRA-33 — une valeur qui commence par un flag de la même commande n'est
  // atteignable QUE par la forme `--flag=valeur`. Sans mention dans la cheatsheet,
  // l'utilisateur qui bute sur le refus n'a aucun moyen de trouver l'échappement.
  it("INFRA-33 — CHEATSHEET documente l'échappement --flag=valeur", () => {
    expect(CHEATSHEET).toContain("--flag=valeur");
    // L'exemple doit être RECOPIABLE : le cas d'origine est un titre multi-mots,
    // donc la valeur doit y apparaître quotée. Un exemple non quoté, recopié tel
    // quel, se fait découper par le shell et tronque le titre en silence.
    expect(CHEATSHEET).toContain('--title="--review requis"');
  });

  // BLG-12 (revue, finding 1) — helpers d'isolation, sur le modèle de
  // `nePasOublierSection` plus bas : chaque helper ANCRE sur un marqueur
  // précis et THROW si l'ancre manque (jamais un `indexOf === -1` silencieux
  // qui ferait retomber le slice sur la constante quasi entière — c'est
  // exactement le défaut du finding 2 de la revue de BLG-12).
  //
  // `*SetTitleNote` isole la note propre à la ligne `set <ID> title=`
  // (BLG-10/BLG-05), DISTINCTE du préambule ajouté par BLG-12 : sans cette
  // isolation, le préambule (qui porte désormais les mêmes jetons) rend les
  // deux tests BLG-10 ci-dessous vacus dès qu'on retire la note de `set`
  // elle-même (D4) — c'est le finding 1 de la revue de BLG-12.
  function cheatsheetSetTitleNote(): string {
    const marker = "  set <ID> title=<valeur>";
    const start = CHEATSHEET.indexOf(marker);
    if (start === -1) throw new Error("ligne `set <ID> title=` absente de CHEATSHEET");
    const rest = CHEATSHEET.slice(start + marker.length);
    const endMarker = "\n  set <ID> blockedBy=";
    const end = rest.indexOf(endMarker);
    if (end === -1) throw new Error("verbe `set <ID> blockedBy=` introuvable après `title=` dans CHEATSHEET");
    return rest.slice(0, end);
  }

  function adoptionReadmeSetTitleNote(): string {
    const marker = 'title="Titre corrigé"';
    const start = ADOPTION_README.indexOf(marker);
    if (start === -1) throw new Error("exemple `set … title=` absent d'ADOPTION_README");
    const rest = ADOPTION_README.slice(start + marker.length);
    const endMarker = "\n   La donnée (";
    const end = rest.indexOf(endMarker);
    if (end === -1) throw new Error("fin de la note `title=` introuvable dans ADOPTION_README");
    return rest.slice(0, end);
  }

  // BLG-10 — une valeur qui commence par `/` est convertie en chemin Windows par
  // Git Bash/MSYS AVANT d'atteindre le CLI (succès silencieux, exit 0, valeur
  // fausse) ; seule MSYS_NO_PATHCONV=1 protège, le quoting ne suffit pas. Mesuré
  // sur `set title=` (BLG-05). Mutation-témoin : retirer la note de la ligne
  // `set` → rouge. Scopé à `cheatsheetSetTitleNote()` (BLG-12, finding 1) : la
  // constante ENTIÈRE ne fait plus foi depuis que BLG-12 a ajouté un préambule
  // qui porte les mêmes jetons ailleurs.
  it("BLG-10 — CHEATSHEET prescrit MSYS_NO_PATHCONV pour une valeur commençant par /", () => {
    const note = cheatsheetSetTitleNote();
    expect(note).toContain("MSYS_NO_PATHCONV");
    // Jeton distinct de « quot » : la CHEATSHEET d'origine contient déjà « non
    // quotés » (blockedBy) et « quotée » (bas de constante), donc `toContain("quot")`
    // resterait vert même si la moitié « le quoting ne suffit pas » disparaissait.
    // « ne suffit pas » n'apparaît nulle part avant BLG-10 — verrou réel.
    expect(note).toContain("ne suffit pas");
  });

  // BLG-10 — assertions DISTINCTES de celles ci-dessus (pas de `||`) : c'est la
  // divergence CHEATSHEET/ADOPTION_README qu'on garde, et ADOPTION_README est le
  // texte que `self-update` distribue. `ADOPTION_README` ne contenait aucune
  // occurrence de « quot » ni de « ne suffit pas » avant BLG-10 — les deux
  // assertions sont rouges avant l'édition des constantes. Scopé à
  // `adoptionReadmeSetTitleNote()` (BLG-12, finding 1), même raison que ci-dessus.
  it("BLG-10 — ADOPTION_README prescrit MSYS_NO_PATHCONV pour une valeur commençant par /", () => {
    const note = adoptionReadmeSetTitleNote();
    expect(note).toContain("MSYS_NO_PATHCONV");
    expect(note).toContain("ne suffit pas");
  });

  it("N10 — ADOPTION_README cite commandes + emplacement global + self-update", () => {
    for (const cmd of ["init", "new", "mature", "list", "self-update"]) {
      expect(ADOPTION_README).toContain(cmd);
    }
    expect(ADOPTION_README).toContain(".claude/tools/backlog");
  });

  // INFRA-37 — le tilde n'est pas expansé dans un argument par PowerShell (shell
  // par défaut de l'environnement) : les commandes d'exemple de ADOPTION_README
  // sous forme `node ~/…` sont inexécutables telles quelles pour la moitié des
  // lecteurs. La forme portable (vérifiée dans les deux shells) est
  // `node "$HOME/…"`, guillemets compris.
  // BLG-05 a ajouté un 6e exemple (`set … title=…`) ; BLG-03 un 7e
  // (`set … blockedBy=…`), toujours sous cette forme.
  it("INFRA-37 — les commandes d'exemple sont sous forme portable, pas `node ~/`", () => {
    expect(ADOPTION_README).not.toContain("node ~/");
    const occurrences = ADOPTION_README.match(
      /node "\$HOME\/\.claude\/tools\/backlog\/backlog\.mjs"/g,
    );
    expect(occurrences).toHaveLength(7);
  });

  // INFRA-37 — non-sur-correction : la prose descriptive qui cite l'emplacement
  // du bundle (jamais exécutée) garde le tilde, plus lisible. Un test qui
  // interdirait tout tilde dans ADOPTION_README ferait de la sur-correction.
  // BLG-05, finding #2 (reprise) — même règle que INFRA-33 (CHEATSHEET) : un
  // exemple à valeur multi-mots non quoté, recopié tel quel, se fait découper
  // par le shell et tronque le titre en silence. self-update distribue
  // ADOPTION_README à chaque consommateur : c'est une surface publiée.
  it("BLG-05 — l'exemple `set … title=…` d'ADOPTION_README est recopiable (quoté)", () => {
    expect(ADOPTION_README).toContain('set SCOPE-01 title="Titre corrigé"');
  });

  // BLG-03 (finding #1 de la reprise) — le § Portée de la spec assigne la ligne
  // `set … blockedBy=…` à « CHEATSHEET + guide » ; seule CHEATSHEET l'avait reçue.
  // Même règle de recopiabilité que le title (finding #2 de la reprise, parité
  // INFRA-33/BLG-05) : plusieurs ids séparés par une virgule-espace non quotés
  // se font découper par le shell.
  it("BLG-03 — l'exemple `set … blockedBy=…` d'ADOPTION_README est présent et recopiable (quoté)", () => {
    expect(ADOPTION_README).toContain('set SCOPE-01 blockedBy="AUTH-04, INFRA-12"');
  });

  // BLG-03 (finding #2 de la reprise) — même règle dans CHEATSHEET : l'exemple
  // affiché par `help`/`init` ne doit pas inviter à une forme non quotée qui se
  // fait découper par le shell dès qu'on pose plusieurs ids.
  it("BLG-03 — CHEATSHEET montre blockedBy sous forme quotée (recopiable)", () => {
    expect(CHEATSHEET).toContain('blockedBy="A, B"');
    expect(CHEATSHEET).not.toContain("blockedBy=<A, B>");
  });

  it("INFRA-37 — la prose descriptive garde le tilde (non-sur-correction)", () => {
    expect(ADOPTION_README).toContain("~/.claude/tools/backlog/backlog.mjs");
    expect(ADOPTION_README).toContain("~/.claude");
  });

  // BLG-07 — la section « Ne pas oublier » désignait `whereismycard` comme
  // source canonique du code alors que `lib/backlog/` a été extrait dans son
  // propre dépôt (`backlog-cli`) : un lecteur qui suivait l'instruction ne
  // trouvait rien. On isole la section (pas la constante entière) : un futur
  // texte historique mentionnant `whereismycard` ailleurs resterait légitime.
  function nePasOublierSection(text: string): string {
    const marker = "## Ne pas oublier";
    const start = text.indexOf(marker);
    if (start === -1) throw new Error("section « Ne pas oublier » absente");
    const rest = text.slice(start + marker.length);
    const nextHeading = rest.indexOf("\n## ");
    return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  }

  it("N12.1 — la section « Ne pas oublier » ne nomme plus whereismycard", () => {
    // Mutation-témoin : remettre la phrase d'origine ("whereismycard reste la
    // source canonique du code…") rend ce test rouge.
    const section = nePasOublierSection(ADOPTION_README);
    expect(
      section.includes("whereismycard"),
      "~/whereismycard/lib/backlog n'existe pas : le code vit dans backlog-cli (lib/backlog/)",
    ).toBe(false);
  });

  it("N12.2 — elle nomme la vraie source (backlog-cli) et la vraie commande (backlog:install)", () => {
    // Mutation-témoin : retirer "backlog:install" en gardant "backlog-cli"
    // rend ce test rouge (correction à moitié faite).
    const section = nePasOublierSection(ADOPTION_README);
    expect(section).toContain("backlog-cli");
    expect(section).toContain("backlog:install");
  });

  // BLG-07 (revue) — `npm run backlog:install` n'existe que dans le
  // `package.json` de `backlog-cli`, jamais dans le checkout de `claude-config`
  // où ce README est lu. Sans repère de lieu, la commande n'est exécutable
  // nulle part depuis l'endroit où le lecteur se trouve.
  it("N12.3 — elle indique où lancer la commande (le checkout de backlog-cli)", () => {
    // Mutation-témoin : retirer le repère de lieu en gardant la commande
    // ("npm run backlog:install" seul, sans mention d'un checkout) rend ce
    // test rouge — c'est le grief même que la spec formulait contre le texte
    // d'origine.
    // Finding 7 (reprise) — ancré sur le REPÈRE précis (`<repo-backlog-cli>`),
    // pas sur le mot « checkout » seul : BLG-04 a introduit une seconde section
    // qui parle aussi d'un dépôt git, sans lien avec ce repère. Un simple
    // `.toContain("checkout")` ne discriminerait plus les deux.
    const section = nePasOublierSection(ADOPTION_README);
    expect(section).toContain("<repo-backlog-cli>");
  });

  // BLG-04 — ADOPTION_README est réécrite par self-update chez CHAQUE consommateur :
  // documenter le signal, c'est le publier partout. D4 (silencieux hors dépôt git)
  // doit y figurer explicitement, sinon un consommateur sans git attend un signal
  // qui ne viendra jamais.
  it("BLG-04 — la section « Ne pas oublier » documente le signal dépôt sali (code 3)", () => {
    const section = nePasOublierSection(ADOPTION_README);
    expect(section).toContain("self-update");
    expect(section).toContain("stderr");
    expect(section).toMatch(/\bcode\s*\*{0,2}3\*{0,2}\b/);
  });

  it("BLG-04 — la section précise le silence hors dépôt git (D4)", () => {
    const section = nePasOublierSection(ADOPTION_README);
    expect(section).toMatch(/dépôt git/);
    expect(section).toMatch(/silencieux/);
  });

  // BLG-12 (revue, finding 2) — helpers d'isolation du PRÉAMBULE, avec la même
  // discipline « ancre + throw » que `nePasOublierSection` : un `indexOf`
  // resté à `-1` (reflow de la cheatsheet, verbe `init` déplacé, forme des
  // exemples de commande modifiée…) ne doit jamais retomber en silence sur un
  // `slice(0, -1)` qui couvre quasiment toute la constante — sinon le test
  // « préambule » redevient, sans le dire, un test sur la constante entière.
  function cheatsheetPreamble(): string {
    const marker = "\n  init ";
    const end = CHEATSHEET.indexOf(marker);
    if (end === -1) throw new Error("première ligne de verbe (`init`) introuvable dans CHEATSHEET");
    return CHEATSHEET.slice(0, end);
  }

  function adoptionReadmePreamble(): string {
    const marker = `node ${GLOBAL_TOOL_CMD}`;
    const end = ADOPTION_README.indexOf(marker);
    if (end === -1) throw new Error("premier exemple de commande introuvable dans ADOPTION_README");
    return ADOPTION_README.slice(0, end);
  }

  // BLG-12 — le piège MSYS_NO_PATHCONV (BLG-10) n'est pas une propriété du
  // verbe `set` : c'est une propriété de toute valeur commençant par `/`, sous
  // tout verbe. Une règle en préambule, avant l'énumération des verbes, plutôt
  // qu'une énumération verbe par verbe qui garantit l'oubli du prochain verbe
  // (D1). `cheatsheetPreamble()` porte déjà l'assertion d'ordre : le jeton
  // doit être DANS la tranche qui précède la première ligne de verbe, sinon
  // la ligne `set` de BLG-10 satisferait déjà le test à elle seule.
  it("BLG-12 — CHEATSHEET prescrit MSYS_NO_PATHCONV en préambule, avant l'énumération des verbes", () => {
    expect(cheatsheetPreamble()).toContain("MSYS_NO_PATHCONV");
  });

  // BLG-12 — le préambule doit porter, comme la ligne `set` de BLG-10, la mise
  // en garde que le quoting ne protège pas (sans elle, un opérateur peut
  // croire qu'un guillemet suffit). Jeton distinct de « quot » pour la même
  // raison qu'en BLG-10 : « quot » apparaît déjà ailleurs dans la constante.
  it("BLG-12 — le préambule de CHEATSHEET avertit explicitement que le quoting ne suffit pas", () => {
    expect(cheatsheetPreamble()).toContain("ne suffit pas");
  });

  // BLG-12 (D4) — non-régression BLG-10 : la ligne `set <ID> title=` garde SA
  // propre prescription, le préambule ne la remplace pas (une note collée au
  // verbe se lit au moment où on tape, un préambule se lit une fois). Portée
  // par les deux tests « BLG-10 » ci-dessus, désormais scopés via
  // `cheatsheetSetTitleNote()`/`adoptionReadmeSetTitleNote()` — un test
  // dédié ici serait redondant et retomberait dans le même piège si sa portée
  // divergeait de la leur (finding 1 de la revue de BLG-12).

  // BLG-12 (D5) — même geste dans ADOPTION_README : c'est le document que lit
  // un projet qui adopte le CLI, donc quelqu'un qui n'a encore jamais tapé
  // aucun verbe. Même discipline d'ancrage que `cheatsheetPreamble()`.
  it("BLG-12 — ADOPTION_README prescrit MSYS_NO_PATHCONV en préambule, avant le premier exemple de commande", () => {
    expect(adoptionReadmePreamble()).toContain("MSYS_NO_PATHCONV");
  });

  it("BLG-12 — le préambule d'ADOPTION_README avertit explicitement que le quoting ne suffit pas", () => {
    expect(adoptionReadmePreamble()).toContain("ne suffit pas");
  });
});
