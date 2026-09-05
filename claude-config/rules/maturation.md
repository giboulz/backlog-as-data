---
paths:
  - "specs/**/*.md"
---

# Règle — maturation d'un ticket

Elle porte ce qu'exige le geste de **maturer**, et rien d'autre.

Elle s'injecte à la lecture d'un fichier qui matche `specs/**/*.md`
**relativement au répertoire d'où la session a été lancée** — donc pas pour la
spec d'un autre dépôt, ni pour un projet qui range ses specs ailleurs. Si tu lis
ceci parce que quelqu'un t'a ouvert le fichier à la main, c'est normal : c'est
ce que `CLAUDE.md` prescrit quand l'injection n'a pas eu lieu.

### Méthode de maturation : sept contrôles avant d'écrire une spec

S'applique au geste de **maturer** un ticket (rédiger § Portée, § Tests,
§ Vérification), sur tout projet, avec ou sans backlog-as-data — c'est
l'étape 1 du SDD, pas une pratique propre à un dépôt. Avant
d'écrire une clause, appliquer ces sept contrôles :

1. **Grep le nom, pas seulement ses porteurs connus.** Avant d'écrire la
   portée, chercher le nom de ce que le ticket modifie — fonction, constante,
   chemin, phrase prescriptive — sur tout le dépôt, commentaires et
   mutations-témoins compris. Un porteur non grepé est un porteur non vu.
2. **Dérouler l'effet de bord du geste prescrit.** Pour chaque geste :
   qu'est-ce qui référence ce que j'insère, déplace ou supprime ? Insérer
   décale des lignes ; déplacer un commentaire élargit la portée de ce qu'il
   affirme ; supprimer un site périme ce qui le cite.
3. **Énumérer les branches et les régimes du mécanisme touché.** Une portée
   qui touche un prédicat, un dosage ou une machine à états doit dire ce
   qu'elle fait de **chacun** de ses cas — pas seulement de celui qui a motivé
   le ticket.
4. **Relire ses propres clauses les unes contre les autres.** Ne jamais
   écrire « X est inchangé » ou « sans retouche » sans vérifier que le geste
   prescrit ne touche pas X. Une clause de non-régression **énumère** les cas
   qui restent verts et **nomme** ceux que le ticket invalide — elle ne se
   contente jamais d'un « tous, sans retouche ».
5. **Ouvrir le dépôt que la spec vise.** Ce qu'une clause prescrit *dans* un
   dépôt se vérifie *dans* ce dépôt, avant de l'écrire : une commande citée
   existe dans son `package.json` **et** est permise par son `CLAUDE.md` —
   « le script existe » n'est pas « le script est permis » ; un fichier
   livrable est suivi par git ; un chemin cité existe. En cross-repo c'est le
   **cas nominal** : la spec s'écrit depuis une session ouverte ailleurs.
   Ajouter n'est sans risque que si la cible existe. Même exigence envers les
   garde-fous génériques de l'implémenteur (`prompts/impl-same.md` et
   `prompts/impl-cross.md`, dépôt `claude-config`) : CLAUDE.md et eux doivent
   permettre la clause ensemble, sinon elle change de destinataire (« à
   vérifier au déploiement ») plutôt que d'être retirée.
6. **Ne jamais figer une valeur allouée en premier-arrivé.** Une spec ne fige
   pas une valeur dont l'attribution est concurrente — index de migration,
   numéro séquentiel, id de ticket voisin, port, slot : elle nomme la **règle
   d'allocation** (« le prochain index libre constaté au moment
   d'implémenter »), et l'état observé à la maturation seulement s'il est
   étiqueté comme tel. Le test : entre le moment où j'écris cette valeur et
   celui où quelqu'un l'implémente, une autre session peut-elle la prendre ?
   Si oui, ce n'est pas une donnée de spec mais une donnée d'exécution — une
   **allocation concurrente** figée est fausse d'avance, même si le contrôle 5
   la disait vraie à l'écriture.
7. **Une clause qui énonce un fait constatable — état du dépôt ou
   comportement d'une dépendance tierce — cite le moyen de le constater.**
   Toute clause qui énonce un tel fait — liste, régime (« ici on ne touche pas
   X »), énumération, inventaire, seuil, ou comportement de dépendance — est
   constatée avant l'écriture, et la spec **cite ce moyen** : la commande pour
   un état du dépôt, la page de doc de la version utilisée, ou le code du
   package pour une dépendance tierce — pas sa sortie, le moyen, pour que le
   lecteur le rejoue. Portée **bornée** aux clauses qui constatent, jamais aux
   clauses de conception : des décisions, non des constats.

#### Refermer une escalade E1 : le diagnostic de méthode

Quand une escalade E1 a pour cause une **clause fausse de la spec** (et non une
contestation de décision produit), sa fermeture exige une ligne de diagnostic
dans la section `## Escalades (D10)` du ticket, répondant à une question fermée
— **quel contrôle de la méthode aurait dû l'attraper ?** Deux issues, et deux
seulement : **un numéro (1 à 7)**, ou **`aucun`**. Si c'est `aucun`, la
fermeture exige **en plus** l'ouverture d'un ticket `SKILL-NN` sur la méthode
elle-même, dont l'id est cité dans la même ligne.

Friction assumée : refermer une escalade coûte plus cher que la laisser
ouverte. Une escalade ouverte reste visible dans `backlog escalations` ; fermée
sans diagnostic, elle est de l'information perdue. Et c'est cette réponse qui
sépare « la méthode a un trou » de « je ne l'ai pas suivie », deux problèmes
aux réponses opposées.

### Portée conventionnelle : ce qu'un § Portée fermé n'a pas à énumérer

Domicile **canonique** de la règle ci-dessous. Les trois modes d'emploi de
sous-agent — `prompts/impl-same.md`, `prompts/impl-cross.md`,
`prompts/reviewer.md` — en portent une **projection** vérifiée identique par
test : aucun des trois ne lit ce fichier, et un renvoi leur livrerait un pointeur
sans le critère. Amende ce bloc-ci d'abord, puis reporte-le à l'identique.

<!-- PROJECTION:portee-conventionnelle -->
⛔ **Portée conventionnelle.** Un geste que le dépôt **prescrit sans latitude**
n'est pas une décision de portée : il ne figure pas dans un § Portée fermé, ne
s'escalade pas **au titre de la portée**, et sa présence dans un diff n'est pas
un dépassement. Le critère est **trois conditions cumulatives** :

1. une **convention nommée** du dépôt le prescrit, et elle est **citable par
   l'exécutant** — écrite dans un fichier qu'il lit ;
2. son **déclencheur** est déterminé — on sait mécaniquement quand il s'applique ;
3. il ne subsiste **aucune alternative légitime** une fois le déclencheur tombé —
   la convention ne laisse pas un second choix défendable.

Cas fondateur, celui de `claude-config` : le **bandeau de supersession**, posé en
tête de la section d'une spec livrée dont le ticket supersède la décision
(`claude-config` : `commands/mature.md`, § Étape 5). ⚠️ La convention se cherche
**dans le dépôt où le ticket est livré**, jamais par analogie : ailleurs, c'est le
`CLAUDE.md` de ce dépôt-là — ou la règle qu'il nomme — qui doit prescrire le geste.

Restent **dans** le § Portée, chacun par la condition qu'il ne remplit pas :

- **toucher un fichier qu'aucune convention nommée ne désigne** — condition 1 ;
- **appliquer une convention que l'exécutant ne peut pas lire** — condition 1 ;
- **rehausser un plafond de taille** — condition 3 : scinder le fichier, réduire
  le contenu ou escalader sont des alternatives réelles ;
- **reformuler une clause** d'une spec livrée — condition 3 : corriger hors
  ticket, élargir la portée ou amender les clauses sont des issues concurrentes.
<!-- /PROJECTION:portee-conventionnelle -->

### Choix du modèle à la maturation

Sur les trois champs du triplet posé par `mature --model --effort --review`,
`review` a une échelle écrite : son **format** (`je lis les signaux → je propose →
l'utilisateur override`) suit le dosage de challenge de `/mature`, § Étape 5.5
(`commands/mature.md`) ; son **contenu** (`none`/`light`/`deep`, quand choisir
`deep`) vit dans `commands/backlog.md`, § Étape 1 (« Quand choisir `deep` »).
`model` en a une aussi, ici, calquée sur le même format. Défaut : **`sonnet`**.

| Cas | Modèle | Déclencheurs (au moins un) |
|---|---|---|
| **1 — mécanique** | `sonnet` | logique lib/algorithmique **bien spécifiée** (même volumineuse) · route CRUD (happy/401/erreur) · composant **isolé** · refactor · skill/doc dont le risque est **éditorial**, pas runtime |
| **2 — porteur** | `opus` | **modèle de données** : touche `db/schema` ou `db/migrations` · **correctness à enjeu** : ingestion/normalisation de données externes, calcul financier/pricing (erreur silencieuse coûteuse) · **surface produit à état complexe** : épic UI multi-composants interdépendants · **portée transverse** : ≥ 3 sous-systèmes couplés |
| **3 — exceptionnel** | `opus` + effort max | cas 2 **ET** algorithme génuinement dur / invariants subtils / peu spécifiable en amont |

**Plancher effort → modèle** : au `mature`, l'outil refuse un modèle sous le
plancher que réclame l'effort le plus élevé — c'est le seul sens qu'il contrôle,
rien n'empêche l'inverse (modèle au-dessus du plancher sur un effort bas). Un
écart à ce plancher-là se prend en tapant `--override-coherence`, un geste, pas
une justification écrite ; ce geste ne touche pas l'exclusion de `haiku`
ci-dessous, qui n'a rien à voir avec l'effort. `fable`, lui, n'est simplement pas
classé dans l'échelle de modèles : `mature` le refuse dès qu'il franchit ce même
plancher — en dessous, faute de plancher à franchir, il passe.

**`haiku`** : ne pas l'inclure dans l'échelle (0 usage observé ; un ticket assez
trivial pour haiku est déjà couvert par sonnet sans risque). Plancher = `sonnet`.
