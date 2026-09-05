## Étape 6.4.5 — Agrégation des findings (dosage `deep` uniquement)

**En dosage `light`, saute cette étape entière** : un seul rapport, rien à
fusionner — `R = U`, va directement à l'Étape 6.5 avec ce rapport comme
`<FINDINGS_BRUTS>`. Ajouter un agrégateur pour un seul rapport coûterait un
aller-retour pour zéro déduplication.

**En dosage `deep`**, spawne l'**agrégateur vierge** — c'est lui, et non toi, qui
fusionne les doublons entre les trois rapports : la fusion est un jugement sur un
diff que tu n'as pas lu, tu n'es pas en position de le rendre.

- `subagent_type: "sdd-reviewer"` — le **même** agent-def que les relecteurs,
  réutilisé pour son seul épinglage (`model: opus`, `effort: high`) : D7 interdit
  de créer un `sdd-aggregator` dédié. `run_in_background: false`, **sans**
  `isolation` (l'agrégateur ne relit aucun worktree).
- `prompt: <PROMPT_AGREGATEUR>` — le bloc `<!-- APPEL:aggregator -->` du skill,
  recopié en entier, ses placeholders renseignés.
- ⚠️ **Ce spawn ne compte PAS dans `<n_relecteurs>`** (Étapes 6.6 et 6.8) : c'est
  un **quatrième** appel `Agent` en `subagent_type: "sdd-reviewer"`, réutilisé
  pour son seul épinglage de réglage — pas un relecteur de plus. `<n_relecteurs>`
  reste **3** en `deep` (**1** en `light`), jamais 4.

**Substitutions de ce paramètre** : `<PROMPT_AGREGATEUR>` → le bloc
`APPEL:aggregator`, recopié en entier, ses propres placeholders renseignés.

L'agrégateur rend trois choses : la **liste agrégée** (`U` findings uniques,
renumérotés de 1 à `U`, sans attribution), la **correspondance** (chaque finding
brut → un unique) et une ligne `TOTAL_UNIQUES: <U>`. **Deux contrôles
obligatoires, avant de lancer le correcteur neuf sur ces findings — l'un ne
remplace pas l'autre** :

1. **Aucun brut perdu.** Chaque finding brut de chacun des trois rapports (`R` =
   somme des `TOTAL:` lus à l'Étape 6.4) a une destination dans la
   correspondance. Si `R` bruts ≠ nombre de lignes de correspondance : **STOP** —
   l'agrégateur a perdu un finding en amont, c'est un rejet silencieux.
2. **Aucun unique perdu entre la correspondance et la liste.** `TOTAL_UNIQUES`
   doit égaler le nombre d'entrées **réellement présentes** dans la liste
   agrégée, et chaque indice cité dans la correspondance (1 à `U`) doit
   correspondre à une entrée présente dans la liste. Si l'un des deux diffère :
   **STOP** — l'agrégateur a fusionné correctement mais recopié une liste
   incomplète ; c'est une autre forme du même rejet silencieux, et compter
   seulement les lignes de correspondance (contrôle 1) ne l'attrape pas.

Si l'agrégateur **s'arrête lui-même** (un des trois chemins illisible, vide ou
sans `TOTAL:` — `prompts/aggregator.md` § Étape 1) : ce n'est **pas** un rapport
irrecevable comme à l'Étape 6.4 — les trois `TOTAL:` y ont déjà été lus avec
succès, en **sortie**. C'est que ce relecteur-là n'a **pas déposé** son fichier
malgré une sortie recevable : sa consigne de dépôt est, comme sa consigne de
lecture seule, déclarative. **Respawne CE relecteur, avec le MÊME
`<CHEMIN_RAPPORT>`**, attends son nouveau dépôt, puis respawne l'agrégateur —
même logique que la recevabilité de l'Étape 6.4 : ce n'est pas un second tour de
revue, c'est le premier dépôt qui n'a pas eu lieu.

À l'Étape 6.5, `<FINDINGS_BRUTS>` devient la **liste agrégée**, telle quelle ; `U`
= `TOTAL_UNIQUES`.

---

## Substitutions déjà résolues à l'entrée de ce fichier

Deux valeurs utilisées ci-dessus sans y être résolues : elles le sont plus tôt
dans le cycle et arrivent ici telles quelles, jamais redéduites. Déclarées ici
pour que ce fichier se lise seul.

**Substitutions** : `<CHEMIN_RAPPORT>` — le chemin de dépôt du rapport d'**un**
relecteur, calculé à l'Étape 6.3 et transmis à ce relecteur-là dans son prompt
d'appel ; `<FINDINGS_BRUTS>` — ce que l'Étape 6.5 passe au correcteur neuf,
dont la valeur en dosage `deep` est fixée par cette étape-ci.
