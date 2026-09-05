// INFRA-14 — Textes d'adoption « anti-oubli ». `CHEATSHEET` est imprimée par
// `init` (le setup se documente lui-même) et par `help` (rappel à tout moment).
// `ADOPTION_README` est écrit par `self-update` dans
// `~/.claude/tools/backlog/README.md` — la référence « comment l'utiliser sur un
// nouveau projet », vers laquelle pointe `init`. Source de vérité unique : ici.

/** Emplacement canonique de l'outil global (repo `~/.claude`, versionné). */
export const GLOBAL_TOOL_PATH = "~/.claude/tools/backlog/backlog.mjs";

/**
 * INFRA-37 — forme à utiliser dans une commande **exécutée** (argument de
 * `node`). Le tilde n'est pas expansé dans un argument par PowerShell, shell
 * par défaut de l'environnement — il l'est en Git Bash, ce qui masque le
 * défaut à quiconque teste depuis bash. `"$HOME/…"` est expansé de façon
 * identique par les deux shells (vérifié en réel) ; les guillemets sont
 * obligatoires (chemin contenant potentiellement des espaces).
 * `GLOBAL_TOOL_PATH` reste au tilde pour la prose descriptive, jamais exécutée.
 * Dérivée de `GLOBAL_TOOL_PATH` (tilde remplacé par `$HOME`, quotée) plutôt que
 * redupliquée en dur, pour que les deux constantes ne puissent pas diverger.
 */
export const GLOBAL_TOOL_CMD = `"$HOME${GLOBAL_TOOL_PATH.slice(1)}"`;

/** Rappel des commandes, court, imprimé par `init` et `help`. */
export const CHEATSHEET = `backlog — outil global (données par-projet, frontmatter specs/*.md → backlog.json)

⚠️ Git Bash/MSYS : toute valeur d'argument (--title, title=, blockedBy=...) qui
commence par / est réécrite en chemin Windows AVANT d'atteindre le CLI — le
quoting ne suffit pas, sans MSYS_NO_PATHCONV=1 en préfixe c'est un échec
silencieux (exit 0, valeur fausse), quel que soit le verbe.

  init                          amorce le projet courant (.gitattributes + backlog.json + specs/)
  new <ID> [--title <t>] [--epic <e>] [--priority must|should|could] [--kind bug|feature]
                                crée un ticket (status: maturing ; kind absent = feature)
  mature <ID> --model <fable|opus|sonnet> --effort <low|medium|high|xhigh|max> --date <YYYY-MM-DD> --review <none|light|deep> [--override-coherence]
                                pose le triplet model/effort/review → maturing devient todo
                                --review : dosage de la gate de revue (défaut côté agent : light)
                                cohérence : effort high|xhigh|max exige model opus (plancher, pas
                                de contrôle en dessous ni en sens inverse) — refusé sinon, sauf
                                --override-coherence (geste sans justification écrite)
  set <ID> status=<parked|maturing|todo|wip|merged|shipped|wont>
                                change le statut (retire exec si dématuration)
  set <ID> title=<valeur>       change le titre (mono-ligne, pas d'espace de tête/queue)
                                valeur commençant par / sous Git Bash/MSYS : préfixer
                                MSYS_NO_PATHCONV=1 — le quoting ne suffit pas, sans la
                                variable la valeur est convertie en chemin Windows AVANT
                                d'atteindre le CLI, échec silencieux (exit 0, valeur fausse)
  set <ID> blockedBy="A, B"     pose la dépendance (annotation, sans contrôle d'existence ni
                                gating) ; blockedBy= (vide) la retire — la forme QUOTÉE est
                                recopiable telle quelle : plusieurs ids non quotés (espace
                                après la virgule) sont découpés par le shell (cf. --flag=valeur)
  brief <ID> [--kind bug|feature]
                                scaffolde les sections core de la spec (feature/bug),
                                idempotent ; override projet : .claude/ticket-sections.json
  snapshot                      régénère backlog.json + specs/backlog.md
  list                          vue terminal groupée par statut (sans board)
  render-md                     régénère specs/backlog.md (vue lisible)
  epic <new|set|start|abandon|epic-snapshot> …   pilotage des épics (specs/epics/)
  escalations [--all]           liste les escalades E1/E3 (D10) ouvertes ; --all inclut les closes
  escalations close <ID> --by <ID> --date <YYYY-MM-DD> [--which <tag>]
                                marque une escalade traitée (insère le marqueur, rien d'autre)
  hook <start <ID>|merge|ship>  cycle auto (posé par /sdd-run-ticket, /send, /deploy)
  self-update                   réinstalle le bundle dans ~/.claude/tools/backlog/
  help                          ce rappel

Invariant exec : requis pour todo/wip/merged, optionnel pour shipped, interdit sinon.
La date n'est jamais inventée (passe --date). Muter via cet outil, jamais les .md/JSON à la main.
Un flag valué sans valeur, ou un flag inconnu, fait échouer la commande (jamais de valeur inventée).
Une valeur qui commence par un flag de la commande s'écrit --flag=valeur, quotée si elle
contient des espaces : new X --title="--review requis".`;

/** Guide d'adoption complet — écrit dans ~/.claude/tools/backlog/README.md. */
export const ADOPTION_README = `# backlog — outil global d'adoption

Le **backlog est de la donnée git**, de la même façon sur tous les projets : un
fichier frontmatter par ticket (\`specs/*.md\`, \`type: ticket\`) projeté dans
\`backlog.json\`. Le CLI est un **bundle autonome unique**, installé une fois dans
\`~/.claude/tools/backlog/backlog.mjs\` (\`~/.claude\` est versionné). Il opère sur le
**projet courant** (\`process.cwd()\`). **Aucune installation par-projet** : juste
les \`specs/*.md\` + \`backlog.json\` en git.

⚠️ Git Bash/MSYS : toute valeur d'argument (\`--title\`, \`title=\`, \`blockedBy=\`...)
qui commence par \`/\` est réécrite en chemin Windows AVANT d'atteindre le CLI —
le quoting ne suffit pas, sans \`MSYS_NO_PATHCONV=1\` en préfixe c'est un échec
silencieux (exit 0, valeur fausse), quel que soit le verbe.

## Adopter sur un nouveau projet

1. **Une fois** : dans le dossier du projet,
   \`\`\`
   node ${GLOBAL_TOOL_CMD} init
   \`\`\`
   → pose \`.gitattributes\` (\`backlog.json text eol=lf\`), un \`backlog.json\` vide,
   \`specs/\`, et imprime la cheatsheet. **Rien d'autre à installer.**

2. Utiliser les commandes (ou le skill \`/backlog\`) :
   \`\`\`
   node ${GLOBAL_TOOL_CMD} new SCOPE-01 --epic mon-epic --priority should
   node ${GLOBAL_TOOL_CMD} mature SCOPE-01 --model opus --effort high --date 2026-06-12 --review light
   node ${GLOBAL_TOOL_CMD} set SCOPE-01 status=parked
   node ${GLOBAL_TOOL_CMD} set SCOPE-01 title="Titre corrigé"
   node ${GLOBAL_TOOL_CMD} set SCOPE-01 blockedBy="AUTH-04, INFRA-12"
   \`\`\`
   Valeur \`title=\` commençant par \`/\` sous Git Bash/MSYS : préfixer
   \`MSYS_NO_PATHCONV=1\` — le quoting ne suffit pas, sans la variable la valeur
   est convertie en chemin Windows AVANT d'atteindre le CLI, échec silencieux
   (exit 0, valeur fausse).
   La donnée (\`specs/*.md\` + \`backlog.json\`) vit dans le git **de ce projet**.
   \`mature\` refuse un triplet incohérent (\`--effort high|xhigh|max\` sans
   \`--model opus\`) ; \`--override-coherence\` fait passer le geste sans exiger de
   justification écrite.

3. \`/send\` et \`/deploy\` posent le cycle (\`merged\`/\`shipped\`) automatiquement via
   \`hook merge\` / \`hook ship\` (sortie toujours 0 : jamais bloquant, no-op dans un
   projet sans backlog).

4. Voir l'état **sans board web** : \`node ${GLOBAL_TOOL_CMD} list\` (terminal) ou
   \`render-md\` (régénère un \`specs/backlog.md\` lisible, lu dans git).

## Ne pas oublier

- \`help\` rappelle les commandes à tout moment.
- \`init\` réimprime la procédure.
- \`backlog-cli\` reste la **source canonique** du code (\`lib/backlog/\`). Quand elle
  évolue : depuis le checkout de \`backlog-cli\` (\`<repo-backlog-cli>/\`),
  \`npm run backlog:install\` régénère le bundle et relance \`self-update\` pour
  le réinstaller ici (+ ce README).
- \`self-update\` écrit ici (\`~/.claude/tools/backlog/\`). Si ce dossier vit DANS un
  dépôt git — fréquent : \`~/.claude\` est lui-même versionné sur plusieurs postes —
  \`self-update\` le détecte et, si l'écriture l'a sali, ajoute sur \`stderr\` **la
  commande de commit prête à lancer** (dépôt + les deux fichiers écrits) et sort en
  code **3** — ni un succès muet (l'install a réussi) ni un échec (\`1\`) : un geste
  reste à faire. \`self-update\` n'exécute jamais ce commit à ta place. Hors d'un
  dépôt git, ou si rien n'a bougé (bundle déjà identique), \`self-update\` reste
  **silencieux, code 0**.
`;
