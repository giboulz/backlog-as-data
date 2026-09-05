# /improve-skill <name> — rôder un skill jeune (rapport de run + améliorateur vierge, rubric pattern/n=1)

Invoqué **à la main**, quand un skill jeune a assez tourné pour qu'on veuille le
retoucher. Le design d'un skill jeune est souvent faux d'une manière que **seul
l'usage réel révèle** ; `/improve-skill` est le **mécanisme** qui transforme la
friction d'usage d'un skill précis en une **proposition d'edit** de ce skill — via
un **améliorateur vierge**.

`/reflect` (SKILL-18) **route** vers ici la friction récurrente « skill précis » ;
mais `/improve-skill` s'invoque **aussi seul** sur un skill jeune. Il ne lit pas le
palier candidat — c'est une **destination** du routeur, pas le mineur.

⛔ **Manuel/volontaire, jamais automatique.** C'est un **outil de rodage** : usage
intense sur les ~5-10 premiers runs d'un skill jeune, quasi-nul une fois stabilisé.
Ne pas le lancer en boucle sur un skill mûr — un jeune skill retouché à chaque run
oscille.

Ce skill est **générique** (comme `/mature`, `/reflect` et `/sdd-run-ticket`) :
il tourne dans le projet courant et n'écrit **aucun** fait projet en dur. Le skill
cible peut être global (`commands/<name>.md` de claude-config) ou propre au projet
(`.claude/commands/<name>.md`) ; l'améliorateur lit le fichier, où qu'il vive.

---

## Arguments

`<name>` — le skill à améliorer (ex. `mature`, `reflect`), tel qu'il nomme son
fichier `commands/<name>.md`.

Si `<name>` est absent : **stopper**, afficher :
```
✗ Usage : /improve-skill <name> (ex. /improve-skill mature)
```

**Substitutions** — les placeholders que TOI, orchestrateur, résous avant
d'exécuter une commande ou de spawner l'améliorateur : `` `<name>` `` le nom du
skill passé en argument ; `` `<CHEMIN_SKILL>` `` le chemin **absolu** de
`commands/<name>.md` ; `` `<RAPPORT_RUN>` `` le rapport de run structuré que tu
rédiges (Étape 1) ; `` `<FRICTION_ATTEIGNABLE>` `` les extraits distillés des
transcripts (Étape 1).

---

## Étape 1 — Rassembler les entrées

Réunir **quatre** entrées avant de spawner quoi que ce soit :

**(a) Le rapport de run structuré.** TOI, orchestrateur, rédige un `<RAPPORT_RUN>`
sur les usages récents de `<name>` : les frictions, les ambiguïtés, les endroits où
tu as **improvisé** faute d'instruction claire, les endroits où la gate de revue a
rattrapé un truc que le skill aurait dû empêcher. C'est **l'intention** — ce que le
skill était censé faire.

**(b) La friction atteignable — extraits distillés.** Les transcripts des runs sont
**volumineux** (le harnais interdit même de les lire en entier). Donc : des
**extraits distillés / ciblés** (`<FRICTION_ATTEIGNABLE>`), jamais un dump brut.
Ce sont les **bricolages** réels, ligne à ligne — ce que le skill a produit, pas ce
qu'il visait.

**(c) Le fichier skill actuel.** **Lire** en entier le fichier cible
`commands/<name>.md` (chemin absolu `<CHEMIN_SKILL>`) — c'est ce que l'améliorateur
va proposer d'éditer. Sans cette lecture, aucune matière.

**(d) Le log des propositions précédentes** pour `<name>`, s'il existe — pour **ne
pas re-proposer** une idée déjà rejetée à une passe antérieure.

---

## Étape 2 — Améliorateur vierge

Spawner un **améliorateur vierge** : un agent **neuf** (`Agent`, **sans**
`isolation`, **lecture seule** — il ne commit rien), qui reçoit les **deux** entrées
complémentaires. ⚠️ Deux angles morts symétriques :

- le **rapport de run** connaît l'**intention** mais **normalise** les bricolages de
  l'orchestrateur (il raconte ce qu'on voulait, pas ce qu'on a fait) ;
- l'**agent vierge** voit les **bricolages** (via la friction atteignable) mais rate
  l'intention.

→ On lui donne **les deux**, et sa mission inclut d'**attraper ce que le rapport a
rationalisé** : la friction que l'orchestrateur a minimisée parce qu'il l'a
contournée sans la nommer.

Spawner avec l'outil `Agent`, **`run_in_background: false`**, **SANS `isolation`** :

```
Agent({
  subagent_type: "general-purpose",
  run_in_background: false,
  description: "improve <name> (améliorateur vierge)",
  prompt: <PROMPT_TEMPLATE>
})
```

L'améliorateur reçoit : le **fichier skill** (`<CHEMIN_SKILL>`), le **rapport de
run** (`<RAPPORT_RUN>`) **et** la **friction atteignable** (`<FRICTION_ATTEIGNABLE>`).

### Rubric imposé à l'améliorateur

Pour **chaque** friction, l'améliorateur rend :

1. **un edit concret** du skill (la retouche précise, section visée) ;
2. **un label** — `pattern` (friction vue ≥ 2 fois → candidate à devenir une règle)
   **ou** `artefact n=1` (vue une seule fois → **down-weight**, on ne grave pas) ;
3. **un flag « le rapport a peut-être minimisé ceci »** — ce que la friction
   atteignable révèle et que le rapport de run a rationalisé.

⚠️ Le rubric **down-weight l'occurrence unique** : un `artefact n=1` n'est **pas**
une reco d'edit, c'est une observation mise en réserve pour la prochaine passe.

### Template figé du prompt améliorateur

⚠️ Bloc délimité par QUATRE backticks (il contient lui-même un extrait en trois
backticks). Recopie-le verbatim, placeholders substitués.

````
Tu es un améliorateur VIERGE d'un skill jeune. Tu n'as PAS mené les runs de ce
skill ; ta valeur vient de ce que tu vois les bricolages RÉELS sans avoir été
convaincu par l'intention.

Skill à améliorer : <name>
Fichier skill (à lire en entier) : <CHEMIN_SKILL>

Tu reçois DEUX entrées complémentaires — lis-les toutes les deux :

1. LE RAPPORT DE RUN de l'orchestrateur (l'INTENTION — ce que le skill était censé
   faire ; il connaît le but mais NORMALISE ses propres bricolages) :
<RAPPORT_RUN>

2. LA FRICTION ATTEIGNABLE — extraits distillés des transcripts (les BRICOLAGES
   réels ; tu les vois, mais tu n'as pas l'intention derrière) :
<FRICTION_ATTEIGNABLE>

Ta mission : pour CHAQUE friction, produire UNE ligne structurée —

```
- Section visée · Edit concret (la retouche précise) · Label (pattern | artefact n=1) · Flag « le rapport a minimisé : … » (ou —)
```

Règles :
- Down-weight l'occurrence unique : une friction vue une seule fois = « artefact
  n=1 », PAS une reco d'edit — mets-la en réserve, ne grave rien dessus.
- Attrape ce que le rapport a RATIONALISÉ : compare l'intention (rapport) aux
  bricolages (friction) ; un écart que le rapport passe sous silence est ton
  meilleur signal.
- Ne réécris PAS le skill toi-même. Tu proposes des edits ; l'orchestrateur arbitre.
````

---

## Étape 3 — Proposer, pas patcher

Sortie = une **proposition** (le diff proposé du skill + son rationale), **pas un
commit**. ⛔ **Jamais de hot-patch** : `/improve-skill` **ne ré-écrit pas** le skill
à chaud, ni son fichier ni `CLAUDE.md`.

Ce qui passe (après aval) **atterrit comme un ticket `SKILL-NN`** normal :
l'amélioration est elle-même un ticket et suit le **SDD** (spec → tests → code →
vérif). Créer le ticket via l'**outil backlog global**, en `maturing`, titre + une
ligne de rationale, **sans** poser de triplet :

```bash
node "$HOME/.claude/tools/backlog/backlog.mjs" new "SKILL-NN" --title "…" --priority should
```

Les `artefact n=1` **ne** deviennent **pas** de ticket : on les laisse mûrir (ils
reviendront peut-être en `pattern` à une prochaine passe). Seuls les `pattern`
(≥ 2 occurrences) sont proposés à la promotion en ticket.

---

## Étape 4 — Garde-fous

- ⚠️ **Pas d'amélioration sur n=1.** Une friction vue **une seule fois** ne devient
  pas une règle — le rubric la classe `artefact n=1` et la down-weight. Graver sur
  `n=1`, c'est confondre le bruit avec le signal ; un jeune skill retouché à chaque
  run **oscille**.
- **Outil de rodage.** Usage intense sur les premiers runs d'un skill jeune,
  quasi-nul une fois stabilisé. Ne pas le relancer en boucle sur un skill mûr.
- **Ne pas re-proposer un rejet.** Le log des propositions précédentes (entrée (d))
  existe pour ça.

---

## Récap avant effets de bord

Avant de créer le ticket d'amélioration, afficher la proposition **et** demander
l'aval — au cas par cas, pas un « tout ou rien » :

```
Passe /improve-skill — skill <name> :
  Entrées     : rapport de run · friction atteignable (extraits distillés) ·
                fichier skill · log des propositions précédentes
  Propositions (pattern ≥ 2) :
    - Section visée · edit proposé · rationale
    - …
  Artefacts n=1 : <a>  (laissés à mûrir — aucun edit)

Pour chaque proposition : ouvrir le ticket SKILL-NN / passer ? (au cas par cas)
```

Rien n'est gravé sans aval. Une passe qui ne trouve **aucun** `pattern` ≥ 2 est un
**résultat valide** : le dire, ne rien forcer. ⛔ Le skill n'édite **jamais** le
fichier cible lui-même — il propose un ticket, le SDD normal dispose.
