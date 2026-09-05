---
id: SKILL-13
title: Outil preflight autonome : sortir la mecanique deterministe du skill et specialiser le mode au repo harnais
type: ticket
status: shipped
priority: should
exec:
  model: opus
  effort: ultrathink
  review: deep
  matured: 2026-07-22
---

# SKILL-13 — Preflight outillé : la mécanique déterministe en code, pas en prose

**Dépend de** : SKILL-12 (les deux templates implémenteur doivent exister — cet
outil choisit A ou B selon son champ `mode`).

## Problème

`commands/sdd-run-ticket.md` fait ~1615 lignes. Une bonne moitié est de la
**mécanique déterministe** — résolution du ticket, tranchage du mode, garde-fous,
dérivation de chemin — écrite en **prose exécutée par un LLM** via des `node -e` et
`git` inline. Trois pièges shell y sont documentés *uniquement parce que* cette
logique vit dans un markdown substitué :

- placeholders positionnels `$`+chiffre mangés par le rendu du skill (F1) ;
- backslashes doubles avalés par git-bash (Étape 1 : « ne simplifie pas ce script
  avec des regex dynamiques ») ;
- `awk` positionnel proscrit au profit de `sed` (Étapes 4.5, 5.5).

Ces pièges n'existent **que** parce que la mécanique est de la prose. En code, ils
disparaissent. Et le « mode cross-repo » — que le skill qualifie lui-même de « mode
de défaillance central » — n'est complexe que parce que ses branches vivent en prose
conditionnelle ; en code, la distinction même-repo/cross-repo devient **un champ de
sortie**, plus une bifurcation que l'orchestrateur doit tenir de tête.

Corollaire (l'intention de l'axe « bêta » de la discussion de maturation) : la
**généralité N-repos** du mode cross-repo est un YAGNI. L'Étape 1.1 admet elle-même
que la classe entière de tickets visée pointe **toujours** sur `$HOME/.claude`. Cette
généralité n'est chère que parce qu'elle est en prose. En code, garder un `--repo`
d'échappement ne coûte rien, et la dérivation élaborée (lecture du remote, fallback
basename) se réduit à la convention documentée `$HOME/claude-config-wt/`.

## D1 — Un outil AUTONOME, pas un verbe du bundle backlog

⚠️ **Contrainte dure** : `tools/backlog/backlog.mjs` est un **bundle généré** (647 Ko),
reconstruit depuis `lib/backlog` de **whereismycard** puis réinstallé par
`self-update`. Y ajouter un verbe `preflight` imposerait d'éditer un autre repo, de
rebuild, de self-update — l'enchevêtrement cross-repo que ce chantier passe son temps
à éviter (cf. règle « rebuild du bundle » du CLAUDE.md global).

**Donc : un outil autonome, propriété de claude-config** : `tools/sdd/preflight.mjs`.
Il n'importe **rien** du bundle backlog. Le seul contact avec le backlog reste ce que
le skill fait déjà : invoquer `backlog hook start` (inchangé).

Node pur, sans dépendance runtime (comme `backlog.mjs`, exécuté par `node`). Testé en
**vitest**, qui est déjà la stack de test du repo (`__tests__/*.test.js`).

## D2 — Contrat de l'outil : entrées → JSON

`node tools/sdd/preflight.mjs resolve --ticket <ID> --session-root <chemin> [--repo <chemin>]`
émet sur stdout **un seul objet JSON**, ou sort en erreur avec un message et un code
non nul. Champs de sortie (un par valeur que le skill lit aujourd'hui à la main) :

```
{
  "ticket": "SKILL-13",
  "found": true,
  "targetRoot": "/c/Users/moi/.claude",     // racine du repo qui POSSEDE le ticket
  "mode": "cross-repo",                       // "same-repo" | "cross-repo"
  "specPath": "specs/skill-13.md",            // relatif a targetRoot
  "absoluteSpecPath": "/c/Users/moi/.claude/specs/skill-13.md",
  "status": "todo",
  "model": "opus",
  "effort": "ultrathink",
  "review": "deep",                           // "light" si le champ est absent
  "worktreePath": "/c/Users/moi/claude-config-wt/skill-13",  // null en same-repo
  "branch": "claude/skill-13",                // null en same-repo
  "guards": {
    "specOnMain": true,                        // Etape 3.5 : ticket+statut mature sur main du repo cible
    "statusGate": "ok",                        // "ok" | "wip" | "already-shipped" | "not-matured" | "parked"
    "worktreePathFree": true,                  // Etape 4.5 : chemin libre
    "worktreeUnderTarget": false               // true = REFUS (worktree sous le repo cible)
  }
}
```

⚠️ **Amendée par [[SKILL-106]]** — le bloc `guards` ci-dessus porte **quatre**
champs (`specOnMain`, `statusGate`, `worktreePathFree`, `worktreeUnderTarget`) ; il
en porte désormais **cinq**, avec l'ajout de `branchFree`. Voir `specs/skill-106.md`
§ D1 pour sa sémantique et son mode de calcul. Le bloc ci-dessus n'est pas réécrit :
il reste ce que le contrat disait quand le code a été écrit.

Le skill lit ces champs et **décide** (afficher le récap, choisir Template A/B,
stopper sur un garde-fou). L'outil **constate et calcule** ; il ne spawne pas
d'agent, ne monte pas le worktree, n'écrit nulle part. La séparation est nette :
déterministe → outil ; jugement (récap, dosage de revue, escalades) → skill.

## D3 — Fonctions exportées et leurs cas de test (SDD : lister chaque cas)

L'outil expose des fonctions pures testables, plus un `main` CLI. Le CLAUDE.md global
impose de **lister les cas de test de chaque fonction exportée**, orchestrateur CLI
compris. Tests dans `__tests__/sdd-preflight-coherence.test.js`, sur des arborescences `specs/`
de fixtures (répertoires temporaires, pas le repo réel).

- **`resolveTicket(root, id)`** → `{file,status,priority,model,effort,review,matured}`
  ou `null`. Reprend le parsing clé/valeur mono-ligne de l'Étape 1 (pas de regex
  dynamique ; lit indifféremment une clé de niveau 0 et une clé du bloc `exec:`).
  Cas : (a) ticket présent dont le frontmatter `type: ticket` + `id` matchent → objet
  complet ; (b) fichier au nom **non déductible de l'ID** trouvé par scan du
  frontmatter → objet ; (c) `type != ticket` ignoré ; (d) id absent → `null` ;
  (e) clé du bloc `exec:` (model/effort/review) lue malgré l'indentation ;
  (f) CRLF toléré (fixture avec `\r\n` — parseur non-CRLF-robuste connu ailleurs) ;
  (g) `review` absent → champ vide (le défaut `light` est posé par le consommateur,
  pas ici).
- **`resolveTargetRoot(sessionRoot, id, repoFlag)`** → `{targetRoot, source}`.
  Cas : (a) ticket dans `sessionRoot` → cette racine, `source: "session"` ;
  (b) absent de session, présent dans `$HOME/.claude` → cette racine,
  `source: "harness"` ; (c) `repoFlag` fourni et valide → cette racine, recherche
  désactivée ailleurs, `source: "flag"` ; (d) `repoFlag` fourni mais ticket absent →
  erreur définitive (pas de fallback harness) ; (e) introuvable partout → `null`
  (le CLI en fait un message nommant les racines scannées).
- **`determineMode(targetRoot, sessionRoot)`** → `"same-repo"` | `"cross-repo"`
  (chemins normalisés). Cas : (a) racines identiques → same-repo ; (b) différentes →
  cross-repo ; (c) normalisation Windows (séparateurs, casse du lecteur) → identiques
  reconnues identiques.

  ⚠️ **Amendée par [[SKILL-44]]** — le cas (b) ci-dessus est **faux** depuis ce
  ticket-là : le critère prioritaire n'est plus l'égalité des chemins normalisés
  mais l'égalité du `git dir` commun. Voir la note d'amendement dans
  `specs/skill-44.md` § Décision (posée par SKILL-50, 2026-08-22) pour le détail
  du nouveau critère et le repli conservé. La D3 ci-dessus n'est pas réécrite :
  elle reste ce que le contrat disait quand le code a été écrit.
- **`deriveWorktreePath(targetRoot, id)`** → `{worktreePath, branch, underTarget}`.
  Convention `$HOME/claude-config-wt/<id-minuscule>` **hors** arborescence cible ;
  branche `claude/<id-minuscule>`. Cas : (a) chemin dérivé hors cible → `underTarget:
  false` ; (b) si la dérivation tombait sous la cible → `underTarget: true` (REFUS) ;
  (c) suffixe = ID **en minuscules** ; (d) racine des worktrees lue sur un worktree
  hors-arborescence **existant** du repo cible si présent, sinon convention par défaut.

  ⚠️ **Amendée par [[SKILL-85]]** — la racine n'est plus `$HOME/claude-config-wt/`
  en dur mais `$HOME/<slug>-wt/`, `<slug>` dérivé du **dépôt** cible, et le cas (d)
  ci-dessus — relire la racine sur un worktree hors-arborescence existant — est
  purement et simplement **retiré**. Voir `specs/skill-85.md` § Correction
  attendue (D1/D2) pour le détail. La puce ci-dessus n'est pas réécrite : elle
  reste ce que le contrat disait quand le code a été écrit.
- **`checkSpecOnMain(targetRoot, specPath)`** → `bool`. `git -C <targetRoot> cat-file
  -e main:<specPath>` **et** statut `todo|wip` sur `main:<specPath>` (Étape 3.5). Cas :
  (a) spec+statut maturé sur main → `true` ; (b) spec absente de main → `false` ;
  (c) spec présente mais statut `maturing` sur main → `false`. ⚠️ `-C <targetRoot>`
  **non décoratif** : interroge le main du repo **cible**, jamais celui de la session.
- **`main(argv)`** (CLI) : compose les fonctions, émet le JSON, gère les codes de
  sortie et messages d'erreur découvrables (racines scannées nommées). Cas :
  (a) résolution complète same-repo → JSON attendu ; (b) résolution cross-repo →
  JSON avec `worktreePath`/`branch` non nuls ; (c) ticket introuvable → code non nul
  + message nommant `sessionRoot` et `$HOME/.claude` ; (d) `--repo` invalide → erreur.

  ⚠️ **Amendée par [[SKILL-106]]** — l'inventaire (a)…(d) ci-dessus n'est **plus
  complet** : les cas (a) et (b) gagnent une assertion sur `guards.branchFree`, ET
  un describe séparé (`main(argv)` — garde-fou `branchFree`) ajoute CINQ cas de
  test supplémentaires (branche absente, orpheline après `worktree remove`,
  checkoutée, conflit D/F, `same-repo`). Voir `specs/skill-106.md` § Tests pour la
  liste complète et à jour.

⚠️ **Ces tests sont l'objet de la sécurité de ce ticket.** Toute la valeur est de
remplacer de la prose non testable par du code testé. Un test manquant sur une
fonction exportée est une régression du CLAUDE.md global — la spec les liste tous
ci-dessus exprès.

## D4 — Rewiring du skill : borné aux étapes de résolution

Réécrire `commands/sdd-run-ticket.md` pour que les **Étapes 1, 1.1, 1.2, 3.5, 4.5**
appellent `node tools/sdd/preflight.mjs resolve …` et lisent les champs du JSON, au
lieu des `node -e` / `git` inline. Concrètement :

- Étape 1/1.1 : un seul appel outil remplace le résolveur `node -e` **et** la sonde
  `$HOME/.claude`. Les messages d'erreur (racines scannées nommées, drapeau `--repo`)
  sont émis **par l'outil**, le skill les relaie.
- Étape 1.2 : le mode est **lu** dans `mode`, plus calculé en prose. Le verdict différé
  de l'Étape 0 (« sur main → stop en same-repo ») reste dans le skill (c'est du
  jugement), piloté par `mode`.
- Étape 3.5 : lue dans `guards.specOnMain`.
- Étape 4.5 : `worktreePath`/`branch` lus du JSON ; les assertions
  `worktreeUnderTarget`/`worktreePathFree` lues de `guards`. La dérivation élaborée en
  prose (remote, basename) **disparaît**.

  ⚠️ **Amendée par [[SKILL-106]]** — l'Étape 4.5 lit désormais une **troisième**
  assertion, `guards.branchFree`, avant le récap. Voir `specs/skill-106.md` § D2.

⛔ **Hors du rewiring** (ce ticket **n'y touche pas**) :
- les deux **templates** implémenteur ([[SKILL-12]]) — le skill continue de les
  recopier, il choisit juste A/B via `mode` ;
- toute la **gate de revue** (Étapes 6.2 à 6.7) : prose de jugement, laissée telle
  quelle ;
- la **localisation du worktree implémenteur** (Étape 6.1) et son contrôle de SHA :
  déterministe aussi, mais **repoussé** à un ticket ultérieur pour borner ce diff.
  ⚠️ **Signaler** ce ticket-suiveur dans le rapport plutôt que de l'improviser ici.

**Spécialisation « repo harnais »** (intention bêta) : l'outil connaît **une seule**
racine alternative — `$HOME/.claude`, dérivée de la machine (jamais déclarée). Le
`--repo` reste une **échappatoire** peu coûteuse en code pour un hypothétique
troisième repo, mais toute la **prose** de généralité N-repos (dérivation par remote,
cas « troisième repo » détaillé) est retirée du skill. C'est le cœur de « la
généralité n'est chère que parce qu'elle est en prose ».

## D5 — Garder F1–F4 vert, et le skill toujours cohérent

- Le rewiring **retire** des blocs ```bash du skill (les `node -e`/`git` inline) et en
  **ajoute** de courts (`node tools/sdd/preflight.mjs …`). F2 doit rester vert sur les
  blocs restants ; F1 (aucun dollar-chiffre) idem — l'appel outil ne doit introduire
  aucun `$`+chiffre.
- F3 : les placeholders orphelins retirés avec leur prose doivent aussi disparaître de
  leur section « Substitutions » si plus utilisés (F3 sens 2 : une substitution
  déclarée doit apparaître ailleurs). Vérifier les deux sens.
- F4 (vocabulaires model/effort/review) : inchangé — les listes `∈ {...}` de l'Étape 2
  restent la déclaration lue par le test ; ne pas les déplacer dans l'outil sans
  garder la ligne canonique dans le skill.
- ⚠️ **`tools/sdd/preflight.mjs` n'est PAS scanné par le test de forme** (F1–F4 ne
  couvrent que `commands/` et `skills/`). Sa sécurité vient de **ses propres tests
  vitest** (D3) — d'où l'exigence de les lister exhaustivement.

## Vérification de fond — dogfooding

Le critère d'acceptation falsifiable, comme [[SKILL-09]] : après livraison, un
lancement `/sdd-run-ticket` **réel** (n'importe quel ticket, same-repo **et**
cross-repo) doit produire le même récap qu'avant, en s'appuyant sur le JSON de
l'outil. Le rapport montre la sortie JSON de l'outil sur au moins un ticket de
chaque mode.

## Tests

- **`__tests__/sdd-preflight-coherence.test.js`** : tous les cas de D3 (fonctions pures +
  CLI), sur fixtures temporaires. C'est le test qui doit **rater d'abord**.
- **`npm test` vert** au global (nouveau test + F1–F4 après rewiring).
  ⚠️ `npm install` préalable dans le worktree (hors arborescence).
- **Preuve avant/après** : les blocs ```bash de mécanique disparus du skill comptés
  avant/après ; le nouveau test rouge avant l'outil, vert après.

## Hors périmètre

- La gate de revue (Étapes 6.2–6.7) et les templates ([[SKILL-12]]).
- La localisation du worktree implémenteur (Étape 6.1) → ticket suiveur à signaler.
- Le découpage du skill en fichiers séparés (parqué, [[SKILL-09]]).
- Toute modification de `lib/backlog` / du bundle `backlog.mjs` : **interdit** ici
  (D1 — l'outil est autonome).
