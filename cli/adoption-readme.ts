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

  init                          amorce le projet courant (.gitattributes + backlog.json + specs/)
  new <ID> [--title <t>] [--epic <e>] [--priority must|should|could]
                                crée un ticket (status: maturing)
  mature <ID> --model <fable|opus|sonnet|haiku> --effort <none|think|think-hard|ultrathink> --date <YYYY-MM-DD> --review <none|light|deep>
                                pose le triplet model/effort/review → maturing devient todo
                                --review : dosage de la gate de revue (défaut côté agent : light)
  set <ID> status=<parked|maturing|todo|wip|merged|shipped|wont>
                                change le statut (retire exec si dématuration)
  snapshot                      régénère backlog.json + specs/backlog.md
  list                          vue terminal groupée par statut (sans board)
  render-md                     régénère specs/backlog.md (vue lisible)
  epic <new|set|start|abandon|epic-snapshot> …   pilotage des épics (specs/epics/)
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
   node ${GLOBAL_TOOL_CMD} mature SCOPE-01 --model opus --effort think-hard --date 2026-06-12 --review light
   node ${GLOBAL_TOOL_CMD} set SCOPE-01 status=parked
   \`\`\`
   La donnée (\`specs/*.md\` + \`backlog.json\`) vit dans le git **de ce projet**.

3. \`/send\` et \`/deploy\` posent le cycle (\`merged\`/\`shipped\`) automatiquement via
   \`hook merge\` / \`hook ship\` (sortie toujours 0 : jamais bloquant, no-op dans un
   projet sans backlog).

4. Voir l'état **sans board web** : \`node ${GLOBAL_TOOL_CMD} list\` (terminal) ou
   \`render-md\` (régénère un \`specs/backlog.md\` lisible, lu dans git).

## Ne pas oublier

- \`help\` rappelle les commandes à tout moment.
- \`init\` réimprime la procédure.
- whereismycard reste la **source canonique** du code (\`lib/backlog/\`). Quand elle
  évolue : \`npm run backlog:build\` régénère le bundle, puis
  \`node <repo>/dist-backlog/backlog.mjs self-update\` le réinstalle ici (+ ce README).
`;
