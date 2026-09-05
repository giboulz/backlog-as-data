// Plafonds de non-régression de TAILLE — SKILL-27 (specs/skill-27.md, volet C).
//
// SKILL-25 a sorti ~36 Ko de mode d'emploi de commands/sdd-run-ticket.md vers
// prompts/*.md. AUCUNE assertion ne mesurait cette taille : le skill pouvait
// réabsorber tout ce qui venait d'en sortir — y compris par recopie d'un mode
// d'emploi — sans qu'un seul test ne bouge (seule la famille 6 de
// impl-templates-coherence.test.js l'attrape, et seulement sur cinq ancres
// nommées).
//
// Ce fichier est DÉDIÉ, et c'est délibéré : rehausser un plafond doit être une
// édition d'UNE ligne, visible dans le diff, pas une chirurgie au milieu d'un
// fichier de 1 600 lignes. SKILL-26, SKILL-28 et SKILL-31 écrivent tous dans ce
// skill — chacun contredira le plafond et devra le RE-MESURER dans son propre
// commit. C'est le comportement voulu (D8), pas un accident.
//
// ⛔ Ce que ce fichier n'est PAS : une cible de taille. D9 — le plafond est un
// constat, pas un objectif. Aucun pourcentage de réduction n'est promis.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const SKILL_FILE = 'commands/sdd-run-ticket.md';
const PROMPTS_DIR = 'prompts';
// SKILL-54 : destination du chargement paresseux — les sections du skill dont
// la lecture est CONDITIONNELLE (blocs cross-repo, corps de l'agrégation en
// dosage `deep`). Distinct de `prompts/` par son LECTEUR : `steps/` est lu par
// l'orchestrateur lui-même, `prompts/` par les sous-agents. C'est cette
// distinction qui fait que ce ticket ne rouvre pas S3 ci-dessous.
const STEPS_DIR = 'steps';
// SKILL-91 : distinct des trois autres par son LECTEUR — SKILL_FILE, PROMPTS_DIR
// et STEPS_DIR ne sont lus que DANS un cycle /sdd-run-ticket (orchestrateur ou
// sous-agent selon le fichier). `CLAUDE.md` est chargé par le harnais à CHAQUE
// session, de CHAQUE projet, cycle ou pas — et il est en plus injecté dans le
// contexte de chaque sous-agent spawné (`prompts/reviewer.md`, Étape 1). Voir
// PLAFOND_CLAUDE_MD ci-dessous.
const CLAUDE_FILE = 'CLAUDE.md';
// SKILL-97 : destination de la méthode de maturation, sortie de `CLAUDE.md`.
// Distinct des quatre autres par son DÉCLENCHEUR — `rules/*.md` n'est chargé ni
// par une session (comme CLAUDE.md), ni par un cycle /sdd-run-ticket (comme
// SKILL_FILE/PROMPTS_DIR/STEPS_DIR), mais à la LECTURE d'un fichier qui matche
// le glob de son frontmatter `paths:`. Voir PLAFOND_RULES ci-dessous.
const RULES_DIR = 'rules';

// --- Les cinq constantes, avec leur date et leur commit de mesure -----------

// Octets (LF) de commands/sdd-run-ticket.md.
// Re-mesuré le 2026-08-25 (SKILL-66, après gate de reprise) : § Règles
// strictes gagne une exception documentée au `--only` — le seul geste
// exempté, le dé-suivi d'un fichier (`git rm --cached`), avec sa séquence
// prescrite et son assertion bloquante (`git diff --cached --name-status`
// doit rendre EXACTEMENT une ligne `D` + TABULATION + `<chemin>` — corrigé en
// gate : `--name-status` sépare par une tabulation, PAS deux espaces, format
// de `git status --short`). Le bullet précédent ("checkout live") gagne aussi
// le rappel littéral `(--only)` de l'Étape 5.5, pour que la référence
// "la règle générale ci-dessus" désigne un texte réellement présent au-dessus
// (findings 1/7 de la gate de reprise). Franchissement voulu (D8) :
// specs/skill-66.md, § Décision, D4 place la prescription précisément là,
// dans le texte qui porte déjà le régime du checkout live.
// Avant correctifs de gate : 85325. Avant SKILL-66 : 83869 (SKILL-64,
// prescription du titre d escalade).
// Re-mesuré le 2026-08-24 (SKILL-54), À LA BAISSE — le seul motif de baisse
// admis : du contenu a RÉELLEMENT quitté le fichier. Les corps de quatre
// sections dont la lecture est CONDITIONNELLE (Étapes 4.5, 5.7, « Variante
// cross-repo » — jamais lues en mode « même repo » ; Étape 6.4.5 — jamais lue
// en dosage `light`) sont partis dans `steps/*.md`, que l'orchestrateur lit
// LUI-MÊME, une fois, une fois la condition connue. Chaque titre garde un
// pointeur d'une poignée de lignes ; les CINQ blocs `APPEL:` restent ici.
// ⛔ Hors de ce cas — du contenu qui quitte le fichier, dans le commit qui l'en
// sort — ce plafond ne se baisse JAMAIS : il n'est pas une cible (D9), et le
// gain ci-dessous est un constat, pas un objectif (specs/skill-54.md, D4).
// Le chiffre a REMONTÉ de 82036 à 83035 pendant la gate de revue de ce même
// ticket, et c'est légitime : chaque pointeur a gagné la commande de résolution
// `homedir()` (convention du dépôt — un `$HOME/…` littéral n'est pas un chemin
// que l'outil `Read` accepte, donc chaque cycle cross-repo s'arrêtait), et le
// pointeur de 6.4.5 a récupéré la prescription complète du chemin `light`, que
// le premier jet avait laissée partir dans le fichier que ce chemin-là n'ouvre
// jamais. Correction d'un défaut introduit par ce ticket, pas contenu neuf.
// Avant SKILL-54 : 87135 (SKILL-56), que le fichier atteignait EXACTEMENT —
// marge nulle.
// Re-mesuré le 2026-08-23 (SKILL-56) : § Étape 6.8 gagne un paragraphe disant
// que le `ref` d'un finding est relevé AVANT le rebase de `/send` (donc peut
// ne plus désigner le commit livré), et nommant le champ qui le constate
// (`shaReachableFromBranch`, aux côtés de `refVerified`) ; § « Note sur les
// agents parallèles » / Doctrine de frontière de session — le prérequis de
// mesure ne dit plus que ce champ manque : il existe désormais, la condition
// de retrait attend une population de cycles, pas un instrument, et la
// limite du champ (ne couvre pas `<sha_final>` lui-même) est écrite pour ne
// pas laisser croire que ce défaut-là est fermé. Franchissement voulu (D8) :
// clôture de trois escalades E1 (SKILL-46 findings 8/9, SKILL-53 finding 1).
// Avant SKILL-56 : 86319 (SKILL-53, après correctifs de gate de reprise).
// Sans marge : un plafond avec du mou n'attrape pas le premier paragraphe qui
// revient.
// Re-mesuré le 2026-08-25 (SKILL-64, reprise sur findings de revue) : § Étape
// 6.6.5 gagne la prescription D1 (le titre du `###` d une escalade commence
// par son tag `E1`/`E3`/`E1/E3`, éventuellement suffixé) avec son exemple, ET
// une phrase fixant la PROFONDEUR de ce titre (niveau 3, jamais `##` ni
// `####` — finding 6 de la revue) : la moitié « producteur » qui fixe ce que
// `backlog escalations` (BLG-08) infère aujourd hui sans garantie, sur les
// deux axes (position du tag, profondeur du titre). Franchissement voulu
// (D8) : ce ticket AJOUTE une consigne, ce n est pas de la prose recopiée.
// Avant SKILL-64 : 83035 (SKILL-54).
// Re-mesuré le 2026-08-25 (SKILL-70, corrige une escalade E1 de SKILL-66) :
// le bullet "Exception au `--only`" gagne une PRÉ-assertion (ligne 0,
// `git diff --cached --name-status` DOIT rendre VIDE, jouée AVANT le
// `rm --cached`) et une issue de secours nommée et bornée (`git -C "$MAIN"
// reset -- <chemin>`, seule forme autorisée si l'assertion post-`rm` échoue
// malgré la ligne 0), plus la raison — désormais écrite ici — pour laquelle
// le geste reste dans le checkout live (specs/skill-70.md, § Cause racine :
// sorti vers un worktree, un `merge --ff-only` sur un live propre supprime le
// fichier). Franchissement voulu (D8) : ce ticket AJOUTE une prescription,
// ce n'est pas de la prose recopiée. Avant SKILL-70 : 85499 (SKILL-64).
// Re-mesuré le 2026-08-25 (SKILL-70, correctifs de la gate de reprise) : les
// quatre lignes de la séquence sont désormais numérotées (`# 0.` / `# 1.` /
// `# 2.` / `# 3.`, finding 3) — la prose renvoie à « la ligne 2 » au lieu de
// l'ambiguë « la ligne du milieu » une fois le bloc passé à quatre lignes —
// et le bullet "checkout live" pointe désormais vers l'exception bornée de
// `reset` (finding 4), pour que son interdit absolu n'induise plus en erreur
// l'opérateur qui a précisément besoin de l'issue de secours. Avant ce
// correctif : 86649 (SKILL-70, premier jet).
// Re-mesuré le 2026-08-25 (SKILL-74, arbitrage de l'escalade E1 finding 4 de
// SKILL-66) : le bullet "Exception au `--only`" perd l'issue de secours
// `git reset -- <chemin>` que SKILL-70 avait ajoutée (écartée à l'arbitrage —
// specs/skill-66.md, § D3) et gagne, à la place, la justification de l'ordre
// de la pré-assertion et l'écriture explicite de la fenêtre résiduelle
// désormais assumée sans geste de réparation ; le bullet "checkout live" perd
// symétriquement son renvoi vers cette exception, `reset` y redevenant
// interdit sans réserve. Franchissement voulu (D8) : la prose qui justifie et
// documente n'est pas de la prose recopiée. Avant SKILL-74 : 86779 (SKILL-70).
// Re-mesuré le 2026-08-25 (SKILL-74, correctifs de la gate de reprise —
// findings 1 et 6) : la fenêtre résiduelle unique gagne une SECONDE fenêtre
// distincte (entre la ligne 2 et le commit de la ligne 3, héritée de
// SKILL-70 § C5 et réintroduite après avoir été retirée par erreur en
// premier jet), avec un rendu honnête du cas résiduel de la fenêtre 0→1 (il
// reproduit le symptôme d'origine, sans « moyens ordinaires » inventés).
// Avant ce correctif : 87592 (SKILL-74, premier jet).
// Re-mesuré le 2026-08-27 (SKILL-76) : la puce "Vérifie les `corrigé (<sha>)`"
// de l'Étape 6.6 retire la note fausse (« la commande sort en erreur » après
// un `--amend` — mesuré faux, specs/skill-76.md § Symptôme) et gagne le
// prédicat `git merge-base --is-ancestor "<SHA_IMPL>" HEAD`, joué AVANT toute
// exploitation de la plage, puis les deux régimes qu'il distingue (« ancêtre »
// : la plage garde son rôle ; « amendé/réécrit » : la plage n'est PAS lue, le
// SHA annoncé doit être `HEAD`, vérifié sur `show --stat HEAD`). Franchissement
// voulu (D8) : ce ticket AJOUTE une prescription (le prédicat et ses deux
// régimes), ce n'est pas de la prose recopiée. Avant SKILL-76 : 88442
// (SKILL-74, correctifs de la gate de reprise).
// Re-mesuré le 2026-08-27 (SKILL-76, correctifs de la gate de reprise —
// finding 1) : le prédicat gagne un avertissement sur l'exit 128
// (`<SHA_IMPL>` inconnu du dépôt interrogé, ex. mauvais `<WORKTREE_IMPL>`
// substitué) — un 128 lu comme « pas 0 » certifierait le `HEAD` d'un arbre
// étranger, mesuré au banc le jour même. Ce n'est pas un troisième régime :
// une issue d'arrêt avant les deux régimes existants. Franchissement voulu
// (D8) : prescription ajoutée contre une confusion réelle, pas de la prose
// recopiée. Avant ce correctif : 89298 (SKILL-76, premier jet).
// Re-mesuré le 2026-08-27 (SKILL-77, premier jet) : le § « Doctrine de
// frontière de session » retire la promesse fausse « attend une population
// de cycles, pas un instrument » et gagne, à la place, le constat que la
// condition de retrait N'EST PAS applicable. Avant ce correctif : 90031
// (SKILL-76, correctif de la gate de reprise).
// Re-mesuré le 2026-08-27 (SKILL-77, correctifs de la gate de reprise —
// findings 1, 2, 5, 6, 7, 8) : la justification n'est plus dupliquée mot pour
// mot dans le paragraphe (elle payait deux fois le même argument, findings 7
// et 8) et devient correcte pour la quantité que le déclencheur nomme
// réellement — non plus seulement « ancêtre de `main` », mais « une branche
// de ticket se coupe depuis `main`, donc en hérite » (finding 5) ; la phrase
// qui présentait le sha_final non couvert comme « un manque ouvert à
// ticketer » est retirée (finding 2, elle rouvrait l'issue que ce ticket
// ferme) ; et une clause désigne désormais le déclencheur qui suit comme
// **non exécutable en l'état**, sans toucher à son texte (finding 1 — sans
// elle, un lecteur qui vient de lire « shaReachableFromBranch existe
// désormais » applique le déclencheur comme une procédure, le symptôme même
// du ticket). Franchissement voulu (D8) : ces clauses sont neuves, la
// duplication qui gonflait le premier jet en a été retirée. Avant ce
// correctif : 90364 (SKILL-77, premier jet).
//
// Re-mesuré le 2026-08-28 (SKILL-90) : l'Étape 6.6.5 gagne sa seconde source
// de déclenchement (une escalade de spec déclarée en première passe, D3), et
// l'Étape 6.6 gagne l'avertissement qui interdit d'ajouter cette escalade à
// l'équation `U uniques = U disposés` — une ligne distincte, hors équation.
// Avant SKILL-90 : 90513.
//
// Re-mesuré le 2026-08-28 (SKILL-90, gate de revue, findings 1/2/4) : le
// gabarit du registre (Étape 6.6) et son exemple gagnent la ligne littérale
// `Escalade de spec (première passe)` que la prose leur prescrivait sans la
// leur donner ; le § « Contenu requis » de l'Étape 6.6.5 se bifurque en deux
// listes (source « registre » vs source « première passe », qui n'a ni
// numéro de finding ni gate) ; et l'Étape 6.2 gagne l'exception qui laisse
// l'Étape 6.6.5 s'exécuter en dosage `none` quand la seconde source est
// seule à déclencher. Avant cette reprise : 91069.
//
// Re-mesuré le 2026-08-28 (SKILL-80) : la puce « Vérifie les `corrigé (<sha>)` »
// de l'Étape 6.6 change d'ANCRE — l'ensemble des SHA légitimes devient
// `main..HEAD` (les commits propres à la branche du ticket), et le contenu se
// vérifie sur le SHA ANNONCÉ, plus sur la pointe. La construction à deux régimes
// posée par SKILL-76 disparaît (le prédicat reste, réduit au détecteur d'exit
// 128), ce qui RETIRE du texte ; ce qui en ajoute, et fait le solde net (+138),
// c'est la justification neuve du nouveau critère d'appartenance : pourquoi un
// SHA hors plage n'est pas une correction (trop ancien, ou emprunté à un
// voisin), et pourquoi la pointe n'est pas le bon commit (un `chore(backlog):
// new <id>` licite, commité après un amend au titre d'un finding E2, l'occupe —
// c'est le cas où l'ancien contrôle accusait un travail correct,
// specs/skill-80.md § Symptôme). Franchissement voulu (D8) : prescription
// remplacée et justifiée, pas de la prose recopiée. Avant SKILL-80 : 93048,
// que le fichier atteignait EXACTEMENT — marge nulle.
//
// Re-mesuré le 2026-08-28 (SKILL-80, gate de revue, finding 1) : la puce gagne la
// SECONDE borne que l'appartenance à `main..HEAD` ne donnait pas. `<SHA_IMPL>`
// est MEMBRE de cette plage tant que le commit relu reste atteignable — le cas
// ordinaire, celui où l'implémenteur AJOUTE son commit de correction — alors
// qu'il ne peut porter aucune correction, étant le commit dont les findings sont
// sortis. L'ancienne plage `<SHA_IMPL>..HEAD` l'excluait gratuitement (sortie
// vide) ; le premier jet de ce ticket avait donc rouvert, sur le régime le PLUS
// FRÉQUENT, le trou que le ticket ferme sur les autres. Le ⛔ ajouté nomme
// l'exclusion et dit POURQUOI elle existe — une borne sans raison se fait retirer
// au ticket suivant. Franchissement voulu (D8) : prescription qui manquait, dont
// l'absence était un trou de contrôle mesuré au banc (`main..HEAD` contient
// 9afaf3b ; `<SHA_IMPL>..HEAD` rend une sortie vide). Avant cette reprise :
// 93186 (SKILL-80, premier jet).
//
// Rehaussé le 2026-08-31 (SKILL-94, D3) : la puce « Source « registre » » de
// l'Étape 6.6.5 passe de quatre à CINQ éléments requis — le cinquième étant le
// diagnostic de méthode qu'une escalade E1 doit porter pour être refermée
// (quel contrôle de la maturation aurait dû l'attraper : un numéro 1 à 7, ou
// `aucun`). Franchissement voulu (D8) : prescription qui manquait, pas de la
// prose recopiée — sans elle, une escalade se referme sans que rien ne remonte
// vers la méthode qui l'a laissée passer. Avant SKILL-94 : 93805, que le
// fichier atteignait EXACTEMENT.
//
// Re-mesuré le 2026-08-31 (SKILL-94, gate de revue, finding 1) : le premier jet
// demandait à l'orchestrateur l'id d'un `SKILL-NN` qu'AUCUNE étape n'ouvre — le
// `CLAUDE.md` global attache cette ouverture à la FERMETURE de l'escalade, hors
// gate, et en cross-repo elle viserait le backlog d'un AUTRE dépôt. La puce dit
// désormais qu'il écrit la réponse, pas le ticket, et lui interdit d'inventer
// un id. Franchissement voulu (D8) : un interdit qui manquait, dont l'absence
// forçait soit un placeholder littéral lu comme une référence réelle, soit une
// escalade non conforme aux cinq éléments. Avant cette reprise : 94209
// (SKILL-94, premier jet).
//
// Re-mesuré le 2026-09-02 (SKILL-98, D10) : la cellule `maturing` de l'Étape 1.5
// nomme désormais `/mature TICKET-ID` en tête, la commande CLI restant derrière
// en équivalent — UNE ligne, +38 octets. Franchissement voulu (D8) : le verbe qui
// débloque l'utilisateur existe enfin, et ce message d'arrêt est le seul endroit
// du cycle où quelqu'un de bloqué l'apprend. Avant SKILL-98 : 94775, que le
// fichier atteignait EXACTEMENT (marge nulle, doctrine SKILL-91/93).
//
// Re-mesuré le 2026-09-03 (SKILL-103, D4, puis gate de reprise finding nº 4 et
// nº 7) : la phrase du § Prérequis de mesure qui disait « `shaVerified`
// constate seulement que le SHA existe dans le dépôt » induisait la lecture
// fausse du § Symptôme de specs/skill-103.md — réécrite deux fois (D4, puis à
// la reprise pour ne plus contredire la phrase voisine « déjà au vert sur la
// quasi-totalité ») pour nommer les deux modes disjoints d'un `false` (« SHA
// mal formé » / « SHA absent du dépôt ») et le champ `shaVerifiedReason` qui
// les distingue, sans jamais nier que `shaVerified` vaut `true` sur la
// majorité des cycles. Franchissement voulu (D8) : corriger une phrase qui
// induit une lecture fausse sur la surface que l'orchestrateur lit.
//
// ⚠️ Ce fichier N'EST PAS exempté ici, malgré le ⛔ de D4 (« exempté […] jamais
// `tools/` ni `__tests__/`. Ne rien y ajouter ») : cette exemption couvre le
// fait de ne pas ÉTENDRE ce plafonnement à `tools/`/`__tests__/`, elle ne
// dispense pas de RÉAGIR quand un ticket touche légitimement une surface déjà
// plafonnée ici (`commands/`) — exactement le cas de D4 lui-même. § Vérification
// de specs/skill-103.md n'annonçait qu'un seul rouge attendu
// (`sdd-telemetry-coherence.test.js`) ; ce second rouge, sur ce fichier-ci,
// était donc **prévisible mais non nommé** — corrigé par ce commentaire, geste
// que le message d'échec du test prescrit lui-même (« re-mesure et rehausse
// PLAFOND_SKILL dans TON commit »).
// Avant cette reprise : 95066. Avant SKILL-103 (D4) : 94813, que le fichier
// atteignait EXACTEMENT (marge nulle, doctrine SKILL-91/93).
//
// Rehaussé le 2026-09-04 (SKILL-105, D1 + D2b) : l'Étape 6.6.5 gagne sa
// TROISIÈME source de déclenchement — le constat que l'orchestrateur forme
// lui-même à l'Étape 6.6 — avec le paragraphe ⛔ de ses TROIS conditions
// cumulatives (ancrage, défaut d'autorité, péremption) et sa puce de contenu à
// cinq éléments ; l'Étape 6.6 gagne la ligne `Constat d'orchestrateur` au
// gabarit du registre (plus son exemple au § Cas d'usage typique), l'extension
// de la puce « hors équation » aux DEUX lignes hors registre, et la CELLULE du
// geste de portée conventionnelle (`escaladé — E1`, avec son motif et le
// caractère voulu du déclenchement de 6.6.5) ; l'Étape 6.2 gagne la borne qui
// dit pourquoi la troisième source n'a aucun objet en dosage `none`.
// Franchissement voulu (D8) : trois prescriptions qui manquaient, dont deux
// fermaient un trou EXERCÉ (trois escalades écrites hors contrat, un finding
// sans cellule) — pas de la prose recopiée. Le geste est écrit ICI, dans
// `commands/`, et c'est ce que `SKILL-104 · E1 (finding 1)` avait écarté au
// motif que « D3 gèle ce plafond » : l'objection tombe avec ce rehaussement.
// Re-mesuré avec l'instrument du dépôt (`npx vitest run skill-size-ceiling`)
// APRÈS rédaction définitive, jamais estimé par delta. Avant SKILL-105 : 95291,
// que le fichier atteignait EXACTEMENT (marge nulle, doctrine SKILL-91/93).
//
// Re-mesuré une SECONDE fois le 2026-09-04, à la reprise sur findings du même
// ticket (99923 → 100203) : la puce « hors équation » retrouve le DÉCLENCHEUR
// que son extension avait fait disparaître — une ligne par ligne du gabarit,
// sans quoi rien ne dit sur laquelle porter le résumé (finding 2) — et le
// désaveu de gabarit du § 6.6.5 compte désormais TROIS listes de contenu au
// lieu de deux (finding 1). Même instrument, même règle : la valeur est celle
// que le message d'échec a rendue, jamais un delta estimé.
//
// Rehaussé le 2026-09-05 (SKILL-111) : l'Étape 6.5 troque le message de reprise
// `SendMessage` — un verbe qui N'EXISTE PAS sur la seule surface de travail
// réelle, en refus annoncé comme en absence muette — contre le bloc d'appel
// `<!-- APPEL:impl-fix -->` d'un correcteur NEUF, avec ses paramètres `Agent`
// (sans `isolation`, dans les deux modes) et sa liste fermée de six
// substitutions ; l'Étape 6 perd le paragraphe qui verrouillait ce verbe et
// gagne ce qu'il faut garder à sa place (nom du mode d'emploi envoyé,
// `<WORKTREE_IMPL>`) ; l'Étape 6.6 gagne la ligne `Régime de correction` au
// gabarit du registre, sa puce de prescription et son exemple au § Cas d'usage
// typique. Franchissement voulu (D8) : c'est un point unique de défaillance qui
// disparaît, pas de la prose ajoutée — l'étape était la SEULE du skill dont le
// mécanisme n'avait qu'un verbe, et l'arrêt y laissait des findings constatés
// et non disposés. Re-mesuré avec l'instrument du dépôt (`npx vitest run
// skill-size-ceiling`) APRÈS rédaction définitive, jamais estimé par delta.
// Avant SKILL-111 : 100203, que le fichier atteignait EXACTEMENT (marge nulle,
// doctrine SKILL-91/93). Le total inclut l'avertissement sur la `description`
// du second lancement, écrit APRÈS un premier passage de la suite (102537 →
// 102954) : `description` est le seul champ d'où `baseline.mjs` tire
// l'identifiant de ticket d'un lancement, et l'Étape 6.5 en crée désormais un
// SECOND — une description « parlante » l'aurait rendu non attribué, donc
// aurait fait compter à l'Étape 6.8 un cycle sans ticket. Correction de
// comportement, pas de la prose ajoutée sans raison.
// Re-mesuré le 2026-09-05 (SKILL-111, gate de revue — findings 7, 8, 9, 10) :
// le GESTE « reprendre l'implémenteur » quitte le skill, pas seulement le verbe
// `SendMessage` que le premier jet avait seul cherché. Le titre de l'Étape 6.5
// (« Reprise de l'implémenteur ») contredisait son propre corps et l'Étape 6 ;
// le récapitulatif « Procéder ? » — le seul texte que l'utilisateur lit avant
// de valider — annonçait encore « Le reprendre » ; l'arrêt de l'Étape 6.4
// disait « ne reprends pas l'implémenteur » et gagne à la place la valeur de
// registre qui lui manquait ; la puce des dispositions manquantes ordonnait
// « une reprise de plus » que plus aucun verbe n'accomplissait, et nomme
// désormais le bloc `<!-- APPEL:impl-fix -->` qu'elle rejoue. La ligne
// `Régime de correction` passe de deux valeurs à TROIS — le registre d'un
// arrêt à l'Étape 6.4 (`U > 0`, aucun correcteur lancé) n'était descriptible
// par aucune des deux. Franchissement voulu (D8) : chaque ajout ferme un
// renvoi périmé PAR ce ticket, pas de la prose recopiée. Avant ce correctif :
// 102954 (SKILL-111, premier jet).
//
// ⚠️ Les blocs `APPEL:` du skill sont SIX depuis ce ticket, pas cinq : les
// entrées datées ci-dessus (SKILL-54, 2026-08-24) en comptent cinq — état de
// LEUR date, jamais réécrit. D3 de `specs/skill-54.md` dit où ils vivent (dans
// le skill), il n'en plafonne pas le nombre.
//
// Rehaussé le 2026-09-05 (SKILL-112) : la `description` du lancement de
// l'Étape 6.5 gagne le suffixe littéral `(correction)`, et la clause qui
// l'entourait est RÉÉCRITE — elle ordonnait « `description` reste
// `SDD <TICKET-ID>`, mot pour mot celle de l'Étape 6 », soit l'ordre CONTRAIRE
// de ce que ce ticket prescrit ; la laisser à côté de la nouvelle aurait mis
// dans le même fichier un ordre et son contraire à dix lignes d'écart. La
// clause dit désormais les deux choses qu'un lecteur ultérieur doit avoir pour
// ne pas la supprimer : le suffixe MARQUE le lancement pour la mesure de
// l'Étape 6.8 (sans lui, `spawnIndex`/`prompt`/`tokensAtSpawn` désignent le
// correcteur au lieu du cycle), et il ne casse pas l'attribution du ticket
// (`TICKET_ID_FROM_DESCRIPTION_RE` s'arrête au premier blanc). Franchissement
// voulu (D8) : c'est un enregistrement plausible et faux qui cesse d'être
// écrit, pas de la prose ajoutée — et la clause est gardée par un test
// (`review-log-wiring-coherence.test.js`, SKILL-112), donc sa disparition
// rougirait. Re-mesuré avec l'instrument du dépôt APRÈS rédaction définitive,
// jamais estimé par delta. Avant SKILL-112 : 103801.
const PLAFOND_SKILL = 104320;

// Somme des octets (LF) de TOUS les prompts/*.md, listés par lecture du dossier.
// Re-mesuré le 2026-08-22 (SKILL-45) : `prompts/reviewer.md` § Dépôt du
// rapport gagne l'outil (`Write`, déjà présent), sa RAISON (un rapport cite du
// code que le shell substituerait) et la forme shell sûre (heredoc quoté),
// contre l'interdiction explicite de la forme dangereuse. Avant SKILL-45 :
// 44114 (SKILL-26, seconde passe).
//
// Re-mesuré le 2026-08-25 (SKILL-72, finding 1 de la gate) : `prompts/impl-same.md`
// et `prompts/impl-cross.md`, § Discipline SDD point 1, gagnent chacun le même
// paragraphe — la politique « chemin cité par une AUTRE spec livrée, renommé
// depuis » (§ Vérification « zéro occurrence » ne s'applique pas aux citations
// d'une spec livrée). Posée là, plutôt que dans `commands/mature-epic.md` (son
// premier emplacement, insuffisant : aucun chemin de lecture ne mène de
// « j'implémente un ticket de renommage » à ce fichier — les tickets nés hors
// `/mature-epic`, la majorité du dépôt, ne l'auraient jamais rencontrée) — ces
// deux fichiers sont lus par TOUT implémenteur, quelle que soit l'origine de
// son ticket. Avant SKILL-72 : 44505.
//
// Re-mesuré le 2026-08-28 (SKILL-89) : même paragraphe, § Discipline SDD
// point 1, durci — le renvoi n'exempte plus qu'à condition qu'un bandeau
// nommant le chemin existe RÉELLEMENT ailleurs dans le même fichier (SKILL-79
// ouvrait un trou que la seule présence du mot « bandeau » laissait ouvert,
// mesuré specs/skill-89.md § Symptôme). Avant SKILL-89 : 45827.
//
// Re-mesuré le 2026-08-28 (SKILL-89, gate de revue, findings 2/3) : la
// formulation ci-dessus est reprise pour ne plus laisser croire que le
// renvoi doit DÉSIGNER correctement la section-cible (variante (b), écartée
// par la mesure — cf. `__tests__/helpers/legacy-path-policy.js`). Avant
// cette reprise : 46071.
//
// Re-mesuré le 2026-08-28 (SKILL-90) : `prompts/impl-same.md` et
// `prompts/impl-cross.md`, § « Si tu te trouves bloqué », gagnent chacun la
// case manquante « spec contradictoire » (distincte de « ambiguë ») ; et
// § « Rapport final attendu », la section optionnelle de déclaration
// « Escalade de spec (première passe) » (D1). Avant SKILL-90 : 46155.
//
// Re-mesuré le 2026-08-28 (SKILL-84) : les QUATRE `prompts/*.md` gagnent
// chacun, mot pour mot, le même bullet « appel d'outil refusé par le
// harnais → arrête-toi, jamais de rejeu par un autre outil » (D1/D2) —
// `prompts/impl-same.md` et `prompts/impl-cross.md` sous « Si tu te trouves
// bloqué », `prompts/reviewer.md` et `prompts/aggregator.md` sous
// « ⛔ Interdictions absolues ». Franchissement voulu (D8) : quatre blocs
// neufs, pas de la prose recopiée. Avant SKILL-84 : 47871.
//
// Re-mesuré le 2026-08-28 (SKILL-84, gate de revue — findings 1/2/3/4/5) : le
// bullet gagne (a) la moitié « renoncer à cet effet et poursuivre » que D2
// autorisait mais que le premier jet laissait implicite, (b) l'override de
// format de sortie pour les rôles dont le format est FERMÉ (relecteur,
// agrégateur), et (c) une exception nommée pour un chemin qui pointe hors du
// périmètre autorisé (déjà classé « erreur » ailleurs dans `impl-same.md`) et
// pour « fichier non lu », le cinquième exemple d'erreur de D2 que le premier
// jet avait laissé tomber ; `prompts/reviewer.md` gagne en plus, au
// § Dépôt du rapport, la clause qui borne son repli shell existant aux
// ÉCHECS techniques, jamais à un `Write` REFUSÉ par le harnais (finding 2 —
// ce repli-là contredisait sans elle le nouveau bullet, 95 lignes plus haut,
// pour le seul cas où l'écriture elle-même est refusée). Avant cette
// reprise : 50187.
//
// Re-mesuré le 2026-09-04 (SKILL-104, D3) : les TROIS modes d'emploi de
// sous-agent — `prompts/impl-same.md`, `prompts/impl-cross.md`,
// `prompts/reviewer.md` — gagnent chacun la même PROJECTION de la règle de
// portée conventionnelle (le bloc entre `<!-- PROJECTION:portee-conventionnelle
// -->` et son marqueur de fermeture), plus la prose propre à chaque porteur qui
// l'attribue à son domicile canonique et la borne (désambiguïsation des deux
// « bandeaux » côté implémenteur, rattachement à l'axe 1 côté relecteur).
// ⚠️ Ce plafond couvre les trois d'un seul tenant : c'est UNE somme, donc UN
// rehaussement, pas trois. Franchissement voulu (D8) : la projection n'est PAS
// de la prose recopiée par confort — c'est le dispositif retenu par D1 contre
// le renvoi, parce que les listes de lecture des trois audiences sont FERMÉES
// et n'incluent pas `rules/maturation.md` ; son identité au texte canonique est
// tenue par `__tests__/portee-conventionnelle-coherence.test.js` (cas 5).
// Avant SKILL-104 : 51984, que le dossier atteignait EXACTEMENT.
//
// Re-mesuré le 2026-09-04 (SKILL-104, gate de revue — findings 3, 5 et 10) : le
// bloc projeté gagne, dans les trois porteurs à la fois, (a) les DEUX exclusions
// de condition 1 du tableau de D2 que le premier jet avait laissées de côté, et
// (b) la clause qui rattache la convention au **dépôt où le ticket est livré** —
// sans elle, un agent cross-repo lisait « `commands/mature.md` § Étape 5 » comme
// un absolu, alors que ce fichier n'existe pas dans son worktree. La prose propre
// à chaque porteur gagne en plus la qualification du dépôt de
// `rules/maturation.md` (`claude-config`, pas le worktree) — le relecteur ne
// l'avait pas, alors qu'il est spawné en cross-repo au même titre.
// Avant cette reprise : 57367.
//
// Rehaussé le 2026-09-04 (SKILL-105, D2a + D2c) : les TROIS porteurs de la
// projection gagnent, mot pour mot, la précision « ne s'escalade pas **au titre
// de la portée** » (D2a) — trois mots, l'identité au canonique restant tenue par
// `portee-conventionnelle-coherence.test.js` (cas 5) ; et les DEUX
// `prompts/impl-*.md` gagnent en plus, HORS du bloc, la conduite en reprise
// (un finding levé malgré tout sur un tel geste a une case : la ligne E1 de
// leur table de tri) et le passage de « Deux « bandeaux » cohabitent » à
// **trois** — le bandeau d'amendement étant, avec D3, une troisième famille de
// régime de portée différent. ⛔ `prompts/reviewer.md` ne reçoit que la
// substitution du bloc : la conduite en reprise ne s'adresse pas à lui.
// Franchissement voulu (D8) : sans la conduite en reprise, l'implémenteur
// applique sa table « trois exceptions fermées » et retombe sur « TOUT finding
// est corrigé » — le défaut que D2b ferme côté orchestrateur ; et sans le
// passage à trois, ce ticket livrerait le défaut exact de
// `SKILL-104 · E1 (finding 8)`. Re-mesuré avec l'instrument du dépôt APRÈS
// rédaction. Avant SKILL-105 : 58920, que le dossier atteignait EXACTEMENT.
//
// Rehaussé le 2026-09-05 (SKILL-111) : les DEUX `prompts/impl-*.md` gagnent, au
// § « Si tu es repris avec des findings », le préambule à deux régimes (« repris
// en contexte » / « relancé à neuf ») et ses quatre faits qu'un correcteur neuf
// n'a AUCUN moyen de déduire — implémentation déjà commitée, worktree déjà
// monté, pas de rebase, motifs des choix conservatifs à relire par `git log` —
// plus, chacun, l'adaptation de SON Étape 0 (la sonde `.agent_worktree_probe_`
// neutralisée côté « même repo », l'absence de ligne **Branche** côté
// cross-repo) et la rubrique **Arbitrages délibérés** du § Rapport final.
// ⛔ Aucun TROISIÈME fichier n'est créé (specs/skill-111.md § Hors-scope) : un
// `prompts/impl-fix.md` aurait ajouté un accusé de lecture, une entrée de
// registre de test et de la masse à un dossier déjà à marge nulle, pour une
// conduite à 90 % commune aux deux existants. Franchissement voulu (D8) : sans
// ces faits, un correcteur neuf REFAIT l'implémentation ou monte un second
// worktree — le régime devient nominal dans ce ticket, il ne peut plus rester
// non écrit. Re-mesuré avec l'instrument du dépôt APRÈS rédaction définitive,
// jamais estimé par delta. Avant SKILL-111 : 60435, que le dossier atteignait
// EXACTEMENT.
// Re-mesuré le 2026-09-05 (SKILL-111, gate de revue — findings 1, 4, 5, 6) :
// le préambule passe de quatre faits à CINQ et est désormais DÉLIMITÉ par
// `<!-- COMMUN:regimes-de-reprise -->`, parce que ses deux copies étaient
// byte-identiques sans qu'aucun test ne le vérifie (seule leur PRÉSENCE
// l'était, fichier par fichier — une reformulation dans un seul des deux
// restait verte). Le fait 3 ferme désormais l'**amend** en plus du rebase : le
// point 2 du tri, quinze lignes plus bas, prescrivait « amende ton commit »,
// qui périme exactement le SHA que le fait 3 dit de préserver. Le fait 5
// énumère les lignes du prompt de REPRISE — le § « Substitutions » de chaque
// fichier décrit l'appel initial, et ne déclarait donc ni **Worktree** (côté
// « même repo ») ni **Arbitrages délibérés de la première passe** (des deux
// côtés). Et `impl-same.md` seul gagne le régime de chemins ABSOLUS : sans
// `isolation`, son § « Outils de fichiers » (« travaille en chemins RELATIFS »,
// « si un outil refuse un chemin absolu → repasse en relatif ») faisait écrire
// le correcteur dans le répertoire de la session orchestratrice — le checkout
// LIVE. Franchissement voulu (D8) : quatre défauts introduits par le premier
// jet de ce ticket, pas de la prose recopiée. Avant ce correctif : 64955
// (SKILL-111, premier jet).
const PLAFOND_PROMPTS = 67863;

// Somme des octets (LF) de TOUS les steps/*.md, listés par lecture du dossier —
// même forme que PLAFOND_PROMPTS ci-dessus, et pour la même raison : un
// quatrième fichier déposé demain entrerait sinon hors plafond, en silence.
// Mesuré le 2026-08-24 (SKILL-54), au commit qui crée le dossier ; re-mesuré le
// même jour, à la gate de revue du même ticket, de 7356 à 8968 : chaque fichier
// a gagné le paragraphe « Substitutions » qui déclare les placeholders qu'il
// UTILISE (`<racine_cible>` ; `<CHEMIN_RAPPORT>` et `<FINDINGS_BRUTS>`) et dont
// la seule déclaration était restée dans le skill, plus l'avertissement qui
// sépare « lire l'Étape 5.7 » de « l'exécuter ». C'est le prix de l'autonomie
// qu'exige le § Tests de la spec — un fichier chargé à la demande est lu SEUL.
//
// ⛔ Ce plafond naît AVEC le dossier, délibérément : sans lui, `steps/` devient
// le déversoir que `prompts/` a failli être, et la compression du skill se
// retourne en déménagement au commit suivant (specs/skill-54.md, D2). Le lecteur
// de `steps/` est l'orchestrateur — écrire ici de la prose qu'il lira de toute
// façon à chaque cycle ne fait que déplacer le coût d'un fichier à l'autre.
//
// Rehaussé le 2026-09-04 (SKILL-106) : `cross-repo.md` gagne, en Étape 4.5, la
// troisième puce de garde-fou (`guards.branchFree`, message + oracle
// `for-each-ref` + remède `branch -D` nommé sans être joué) et, en Étape 5.7,
// la généralisation d'un mot (« chemin occupé » → « chemin ou branche déjà
// pris »). Re-mesuré avec `mesure()` APRÈS rédaction définitive, jamais estimé
// par delta : avant SKILL-106 : 8964 ; après : 9907.
//
// Re-mesuré le 2026-09-04 (SKILL-106, gate de reprise — finding 1) : l'oracle
// de l'Étape 4.5 est passé de `branch --list 'claude/*'` (muet sur le conflit
// D/F — une branche NUE ne matche pas ce glob) à `for-each-ref`, qui montre
// les deux causes ; le remède cible désormais la référence EXACTE listée par
// l'oracle, pas `<branche_cible>` en dur (faux sur le conflit D/F, mesuré :
// `branch -D claude/foo-01` sort en 1 quand la référence en conflit est
// `claude`). 9907 → 10525, correction de comportement, pas de la prose
// ajoutée sans raison.
//
// Re-mesuré le 2026-09-05 (SKILL-113, escalade E1 findings 8/9 de
// specs/skill-111.md) : `review-deep.md` ne nomme plus le geste « reprendre
// l'implémenteur », périmé par SKILL-111 côté skill mais resté intact ici —
// SKILL-111 s'était interdit d'écrire dans `steps/`. 10525 → 10535, quelques
// octets pour nommer le correcteur au lieu de l'implémenteur repris, pas un
// changement de fond.
const PLAFOND_STEPS = 10535;

// Octets (LF) de CLAUDE.md — le seul fichier chargé à CHAQUE session de
// CHAQUE projet, backlog-as-data ou non (contrairement à SKILL_FILE/
// PROMPTS_DIR/STEPS_DIR, qui ne sont lus que par un cycle /sdd-run-ticket).
// C'est délibérément la surface la plus chère du dépôt, donc le plafond le
// plus tôt posé — ce ticket (SKILL-91) est le premier qui y verse de la
// méthode plutôt que de la règle ; SANS ce plafond, `CLAUDE.md` deviendrait le
// déversoir que `prompts/` a failli être (même raison que PLAFOND_STEPS
// ci-dessus, D3 de specs/skill-91.md).
//
// Mesuré le 2026-08-28 (SKILL-91) : la méthode de maturation (quatre
// contrôles) ajoutée sous « ## Workflow obligatoire (SDD) ». Avant SKILL-91 :
// 16076 ; après ajout : 17642, EXACTEMENT — marge nulle, même doctrine que
// PLAFOND_SKILL/PLAFOND_PROMPTS ci-dessus (D3 de specs/skill-91.md : « mesurée
// APRÈS l'ajout »).
//
// Rehaussé le 2026-08-29 (SKILL-93) : cinquième contrôle ajouté (« Ouvrir le
// dépôt que la spec vise »). Avant SKILL-93 : 17642 ; après ajout : 18160,
// EXACTEMENT — même doctrine, marge nulle (D3 de specs/skill-93.md).
//
// Rehaussé le 2026-08-31 (SKILL-94) : la méthode passe à SEPT contrôles — le 6
// (ne jamais figer une valeur allouée en premier-arrivé) et le 7 (une clause
// qui énonce un état du dépôt cite la commande qui l'établit) — et gagne le
// rituel de fermeture d'escalade E1 (D3), la boucle de retour qui manquait :
// sans elle, une maturation fausse ne coûte rien à la méthode qui l'a laissée
// passer. Avant SKILL-94 : 18160 ; après ajout : 20537, EXACTEMENT — même
// doctrine, marge nulle. C'est le plus gros franchissement consenti sur ce
// plafond ; le suivant devra montrer ce qu'il retire, pas seulement ce qu'il
// ajoute.
//
// Réécrit le 2026-09-02 (SKILL-96), à budget CONSTANT — pas un rehaussement :
// le libellé du contrôle 7 ci-dessus est PÉRIMÉ depuis ce ticket, qui
// l'élargit à tout fait constatable — état du dépôt OU comportement d'une
// dépendance tierce — sans toucher au nombre de contrôles (toujours SEPT).
// Avant SKILL-96 : 20537 ; après réécriture : 20534, TROIS octets rendus.
// `PLAFOND_CLAUDE_MD` ne bouge PAS : la marge, nulle depuis SKILL-91, est
// désormais de 3 octets. C'est SKILL-97 (§ Hors-scope de specs/skill-96.md)
// qui devra montrer ce qu'il retire pour justifier un rehaussement.
//
// Re-mesuré le 2026-09-02 (SKILL-97), À LA BAISSE — 20534 → 11578, le seul
// motif de baisse admis par ce fichier : du contenu a RÉELLEMENT quitté
// `CLAUDE.md`, dans le commit qui l'en sort (même geste que SKILL-54 sur
// `commands/sdd-run-ticket.md` → `steps/*.md`, cf. PLAFOND_SKILL ci-dessus).
// Sont partis : la méthode de maturation, le rituel de fermeture d'escalade E1
// et l'échelle de choix du modèle → `rules/maturation.md` (PLAFOND_RULES
// ci-dessous), qui ne se charge qu'à l'ouverture d'un fichier de spec ; les
// listes de chemins mono-projet citées en anti-pattern sous « ## Règles de
// test » ; le détail du cas divergent de « ## Migrations Drizzle » (gardé chez
// le seul projet concerné, qui surcharge déjà la règle) ; et le mode d'emploi
// opératoire de « ### Environnement de test », dont la section désignait
// elle-même `prompts/impl-*.md` comme domicile depuis SKILL-25. Sans marge,
// même doctrine que ci-dessus : mesuré APRÈS la sortie, jamais estimé avant.
// ⛔ Ce que cette baisse n'autorise pas : rapatrier ici la méthode « juste le
// temps de ». Il n'y a plus la place — c'est exactement l'effet voulu.
//
// Re-mesuré le 2026-09-02 (SKILL-97, gate de revue — findings 1, 5, 8, 10) :
// 11578 → 12552, un REHAUSSEMENT à l'intérieur de la baisse ci-dessus, et la
// baisse nette du ticket reste de 7982 octets. Ce qui rentre, et pourquoi :
//   - le pointeur de maturation cesse d'affirmer que la règle s'auto-charge
//     TOUJOURS. Elle ne s'injecte qu'à la lecture d'un chemin qui matche son
//     glob RELATIVEMENT au répertoire de lancement de la session : jamais pour
//     la spec d'un autre dépôt (chemin en `..`, rejeté — or c'est le cas
//     nominal de la maturation cross-repo), ni pour un projet qui range ses
//     specs ailleurs (`spec/`, `docs/spec/`). Le pointeur énonce donc ses trois
//     trous et prescrit l'ouverture manuelle, avec la commande de résolution
//     `homedir()` que ce dépôt exige pour tout fichier à passer à `Read` (un
//     `~/…` littéral n'est pas développé). Sans ces lignes, la méthode
//     disparaissait du contexte EN SILENCE, et le pointeur certifiait le
//     contraire — le pire des deux mondes.
//   - « ### Environnement de test » retrouve la phrase qui nomme CE dépôt comme
//     relevant de la règle générique. `prompts/impl-same.md` § Étape 0.5 exige
//     cette confirmation NOMMÉE avant d'installer, et prescrit « sinon arrête
//     et signale » : la version réduite l'avait supprimée, ce qui bloquait tout
//     cycle same-repo sur `claude-config` au lieu de le laisser installer.
// Franchissement voulu (D8) : ces clauses sont neuves et corrigent deux défauts
// INTRODUITS par le premier jet de ce ticket, pas de la prose recopiée. Sans
// marge, comme toujours ici. Avant cette reprise : 11578.
//
// Rehaussé le 2026-09-02 (SKILL-100) : SKILL-97 avait écrit « ce pointeur ne
// résume rien — la méthode n'a qu'un domicile », et la gate de revue qui a
// suivi a constaté que la règle path-scopée ne se charge pas dans le cas
// nominal (cross-repo, projets aux specs ailleurs, session lancée au-dessus
// du projet) — trois cas où la méthode disparaît du contexte sans qu'aucun
// signal ne le dise. Ce ticket fait remonter les SEPT TITRES de contrôle
// (une ligne chacun, sans justification ni exemple) sous « ### Maturation —
// la méthode vit dans une règle, pas ici » ; le texte complet reste
// l'unique domicile de `rules/maturation.md`, inchangé. Avant SKILL-100 :
// 12552 ; après ajout : 13122, EXACTEMENT — même doctrine, marge nulle.
//
// Re-mesuré le 2026-09-02 (SKILL-100, gate de revue — finding 2) : le titre
// du contrôle 7 est ré-enroulé sur deux lignes (contenu identique, wrap
// purement éditorial) pour rejoindre la convention ~78 colonnes du reste du
// fichier, une fois l'extraction du noyau rendue robuste à ce cas. Avant
// cette reprise : 13122 ; après : 13125, EXACTEMENT — même doctrine, marge
// nulle.
//
// Réécrit le 2026-09-04 (SKILL-109), à budget CONSTANT — pas un
// rehaussement : le préambule du noyau (« ### Maturation — la méthode vit
// dans une règle, pas ici ») énumérait ce que porte `rules/maturation.md`
// (« les contrôles à passer avant d'écrire une clause, le rituel de
// fermeture d'une escalade E1, l'échelle de choix du modèle ») — un inventaire
// à TROIS membres, périmé depuis SKILL-104, qui a ajouté une quatrième
// SECTION (« Portée conventionnelle ») sans qu'il en tienne compte — la
// règle elle-même porte toujours SEPT contrôles, invariant vérifié ailleurs.
// L'énumération est remplacée par une formule non close (« elle porte tout
// ce qu'exige ce geste, et rien d'autre — les contrôles ci-dessous n'en sont
// qu'une part »), que la cinquième section à venir ne périmera pas. Avant
// SKILL-109 : 13125 ; après réécriture : 13109, SEIZE octets rendus.
// `PLAFOND_CLAUDE_MD` ne bouge PAS : la marge, nulle depuis SKILL-100, est
// désormais de 16 octets.
const PLAFOND_CLAUDE_MD = 13125;

// Somme des octets (LF) de TOUS les rules/*.md, listés par lecture du dossier —
// même forme que PLAFOND_PROMPTS et PLAFOND_STEPS, et pour la même raison : un
// second fichier de règle déposé demain entrerait sinon hors plafond, en
// silence.
//
// Mesuré le 2026-09-02 (SKILL-97), au commit qui crée le dossier : 6607 octets,
// EXACTEMENT — marge nulle.
//
// Re-mesuré le 2026-09-02 (SKILL-97, gate de revue — finding 1) : 6607 → 6925.
// L'en-tête de `rules/maturation.md` affirmait, comme le pointeur de
// `CLAUDE.md`, être « chargée à l'ouverture d'un fichier de spec » — sans
// réserve. Elle énonce désormais la condition réelle (glob évalué RELATIVEMENT
// au répertoire de lancement de la session, donc muet sur un autre dépôt) et
// dit au lecteur pourquoi il peut légitimement la lire sans injection. Un
// fichier qui se décrit faux est pire que muet : il fait conclure au lecteur
// qu'il n'a rien à vérifier. Franchissement voulu (D8), sans marge.
//
// ⛔ Ce plafond naît AVEC le dossier, délibérément (même doctrine que
// PLAFOND_STEPS) : sans lui, `rules/` devient le déversoir que `prompts/` a
// failli être, et le bénéfice de SKILL-97 s'annule au troisième contenu qu'on y
// pousse. Il ne mesure PAS la même chose que PLAFOND_CLAUDE_MD : une règle
// path-scopée ne se paie qu'à la lecture d'un fichier qui matche son glob, pas
// à chaque session — mais « moins cher » n'est pas « gratuit », et la tentation
// de déplacer ici ce qu'on n'ose plus écrire dans `CLAUDE.md` est exactement le
// motif que ce fichier existe pour constater.
//
// Rehaussé le 2026-09-02 (SKILL-99, D4) : le renvoi « review a une échelle
// écrite (dosage à 3 cas dans /mature-epic) » de « Choix du modèle à la
// maturation » devient DEUX renvois — le FORMAT vers le dosage de challenge de
// `/mature` (§ Étape 5.5, désormais quatre cas), le CONTENU vers
// `commands/backlog.md` § Étape 1 — pour fermer les deux lectures possibles de
// la phrase d'origine (specs/skill-99.md, D4) sans laisser un nombre devenu
// faux (« 3 cas » en pointant `/mature`, qui en a quatre). Franchissement
// voulu (D8) : deux renvois où il y en avait un, pas de la prose recopiée.
// Avant SKILL-99 : 6925, que le fichier atteignait EXACTEMENT.
//
// Rehaussé le 2026-09-04 (SKILL-104, D3) : `rules/maturation.md` gagne le
// domicile CANONIQUE de la règle de portée conventionnelle — une section `###`
// propre (jamais un huitième contrôle numéroté, cf. D5 : il ferait rougir
// L1.4c, L1.4d et la plage « 1 à N » sur ses deux porteurs, tous à marge
// nulle), portant l'énoncé, ses trois conditions cumulatives et ses deux
// exclusions nommées. Franchissement voulu (D8) : c'est ici que le texte vit,
// les trois `prompts/` n'en portent qu'une projection vérifiée identique.
// Avant SKILL-104 : 7120, que le fichier atteignait EXACTEMENT.
//
// Re-mesuré le 2026-09-04 (SKILL-104, gate de revue — findings 3, 5 et 6) : le
// bloc canonique gagne les deux exclusions de condition 1 et la clause « la
// convention se cherche dans le dépôt où le ticket est livré » (report du même
// amendement que côté `prompts/`, l'identité étant tenue par test) ; la
// condition 3 est par ailleurs réécrite pour ne plus commencer par du gras juste
// après son numéro — sous cette forme, `titresDeControle()` de
// `__tests__/mature-skill-coherence.test.js` (MAT4), qui applique son motif au
// fichier ENTIER, la comptait comme un huitième titre de contrôle de la méthode.
// Avant cette reprise : 8841.
//
// Rehaussé le 2026-09-04 (SKILL-105, D2a) : le bloc canonique de la portée
// conventionnelle gagne TROIS MOTS — « ne s'escalade pas **au titre de la
// portée** ». Sans eux, la phrase se lisait « un finding levé dessus n'a pas de
// disposition », ce qui n'a aucune cellule dans l'énuméré fermé de l'Étape 6.6
// (`SKILL-104 · E1`, finding 1). ⛔ Rien d'autre du bloc ne change : les trois
// conditions cumulatives, les quatre exclusions nommées et le cas fondateur
// restent mot pour mot ce qu'ils sont. Le canonique est amendé EN PREMIER, comme
// son propre chapô le prescrit, puis reporté à l'identique dans les trois
// projections. Re-mesuré avec l'instrument du dépôt APRÈS rédaction. Avant
// SKILL-105 : 9316, que le dossier atteignait EXACTEMENT.
//
// Rehaussé le 2026-09-04 (SKILL-95, D1/D3) : l'item 5 de « Méthode de
// maturation » gagne une seconde source de permission — les garde-fous
// génériques de `prompts/impl-same.md` et `prompts/impl-cross.md` (dépôt
// `claude-config`) — et la règle de routage (D2) : une clause qu'ils
// bloquent change de destinataire au lieu d'être retirée de la spec. Le
// plafond est le seul rehaussé (D3) ; `PLAFOND_CLAUDE_MD` ne bouge pas (D7),
// le titre de l'item 5 étant inchangé. Re-mesuré avec l'instrument du dépôt
// APRÈS rédaction (reformulée findings de revue) — avant SKILL-95 : 9343,
// que le dossier atteignait EXACTEMENT.
const PLAFOND_RULES = 9659;

// --- La mesure ---------------------------------------------------------------
//
// Quatre décisions, toutes vérifiées par S1 ci-dessous :
//
// 1. OCTETS, pas lignes — le coût réel est en tokens, dont l'octet est le proxy
//    le plus proche ; le nombre de lignes se truque en reformatant.
// 2. Contenu NORMALISÉ CRLF → LF avant mesure. `commands/sdd-run-ticket.md` est
//    `i/lf w/crlf` dans ce dépôt (`core.autocrlf=true`) : mesuré brut, il pèse
//    dans le working tree UN OCTET DE PLUS PAR LIGNE que dans l'index. Le verrou
//    `.gitattributes` posé par SKILL-25 (`prompts/*.md text eol=lf`) ne protège
//    que l'AUTRE moitié — son propre commentaire le dit.
//    ⛔ Ce delta n'est PAS une constante : il vaut le nombre de lignes du
//    fichier, donc il bouge à chaque commit qui en ajoute ou en retire (1 306
//    octets au commit de SKILL-27 ; 1 353 avant sa compression, à 1 353 lignes).
//    Pour rehausser un plafond, RE-MESURE avec `mesure()` ci-dessous — ne
//    retranche jamais de la taille affichée par le disque un chiffre lu ici.
// 3. `Buffer.byteLength` en UTF-8, pas `.length` : le skill est truffé de ⛔ et
//    de ⚠️, qui pèsent 3 à 6 octets chacun et 1 à 2 unités de code.
// 4. Le chiffre se mesure APRÈS la compression, jamais avant (D9).

/** Octets UTF-8 d'un contenu, une fois ses fins de ligne normalisées en LF. */
export function mesure(contenu) {
  return Buffer.byteLength(contenu.replace(/\r\n/g, '\n'), 'utf8');
}

/** Octets normalisés d'un fichier du dépôt, désigné par son chemin relatif. */
function mesureFichier(rel) {
  return mesure(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

/**
 * Liste RÉCURSIVE des `.md` d'un dossier du dépôt, en chemins relatifs à ce
 * dossier (séparateur `/`), triée.
 *
 * ⚠️ SKILL-97, reprise de gate : la version d'origine faisait un `readdirSync`
 * NON récursif. Le chargeur de règles du client, lui, descend dans les
 * sous-répertoires — un `rules/maturation/escalades.md` était donc injecté en
 * session tout en restant invisible de `PLAFOND_RULES`, exactement la porte que
 * ce plafond est né pour fermer. La récursion vaut pour les TROIS dossiers, pas
 * seulement `rules/` : `prompts/` et `steps/` sont plats aujourd'hui (la mesure
 * est donc inchangée à l'octet), et le jour où l'un gagne un sous-dossier, il
 * est couvert sans action — c'est la doctrine « couvert sans action » que leurs
 * propres commentaires réclament.
 */
function listeMdRecursive(dir) {
  const abs = path.join(REPO_ROOT, dir);
  const out = [];
  const walk = (absDir, prefix) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(absDir, entry.name), rel);
      else if (entry.name.endsWith('.md')) out.push(rel);
    }
  };
  walk(abs, '');
  return out.sort();
}

/**
 * Mesure de `prompts/` : la liste vient de la LECTURE DU DOSSIER, jamais d'un
 * tableau de noms. `prompts/aggregator.md` (SKILL-26) sera donc couvert sans
 * action, exactement comme le `.gitattributes` le couvre déjà.
 */
function mesureDossier(dir) {
  const fichiers = listeMdRecursive(dir);
  let octets = 0;
  for (const nom of fichiers) octets += mesureFichier(`${dir}/${nom}`);
  return { fichiers, octets };
}

/**
 * L'assertion « la liste mesurée est exactement celle du dossier », POSÉE UNE
 * FOIS pour les trois dossiers.
 *
 * ⚠️ SKILL-97, reprise de gate : elle était recopiée à l'identique trois fois,
 * chaque copie refaisant SON `readdirSync` — alors que deux fonctions plus haut
 * le fichier pose la doctrine inverse (« la fonction est PARTAGÉE plutôt que
 * recopiée — deux mesures recopiées divergent en silence, et l'assouplissement
 * de l'une … laisserait l'autre derrière »). Passer `mesureDossier` en récursif
 * était précisément cet assouplissement : les trois copies non récursives
 * seraient restées vertes en comparant deux listes tronquées de la même façon.
 */
function itListeEgaleAuDossier(dir, mesureur) {
  it('la liste mesurée est exactement celle du dossier, sous-dossiers compris', () => {
    const { fichiers } = mesureur();
    const surDisque = listeMdRecursive(dir);
    expect(
      surDisque.length,
      `${dir}/ ne contient aucun .md — ce test n'a rien vérifié.`
    ).toBeGreaterThan(0);
    expect(
      fichiers,
      `La mesure de ${dir}/ ne couvre pas tous les .md du dossier : un fichier ` +
        `peut y entrer hors plafond, en silence — y compris dans un ` +
        `sous-dossier, que le chargeur du client lit et qu'un readdirSync à ` +
        `plat ne voit pas.`
    ).toEqual(surDisque);
  });
}

const mesurePrompts = () => mesureDossier(PROMPTS_DIR);

// SKILL-54 : même lecture de dossier pour `steps/`. La fonction est PARTAGÉE
// plutôt que recopiée — deux mesures recopiées divergent en silence, et
// l'assouplissement de l'une (ex. tolérer un sous-dossier) laisserait l'autre
// derrière.
const mesureSteps = () => mesureDossier(STEPS_DIR);

// SKILL-97 : même lecture de dossier pour `rules/`, et pour la même raison que
// SKILL-54 invoquait au-dessus — la fonction est PARTAGÉE, pas recopiée.
const mesureRules = () => mesureDossier(RULES_DIR);

describe('S1 (SKILL-27) — la mesure elle-même est normalisée', () => {
  // ⚠️ Mutation : retirer la normalisation CRLF → LF de `mesure` → rouge. Sans
  // elle, le plafond bouge d'un octet PAR LIGNE selon `core.autocrlf` (1 306
  // octets sur le skill au commit de SKILL-27), sans qu'un seul mot ait changé
  // dans le fichier.
  it('rend la même valeur pour un contenu CRLF et son équivalent LF', () => {
    expect(
      mesure('a\r\nb\r\n'),
      'La mesure dépend des fins de ligne : le plafond deviendrait une propriété ' +
        'de la config git de la machine, pas du contenu du fichier.'
    ).toBe(mesure('a\nb\n'));
  });

  // ⚠️ Mutation : passer à `.length` (unités de code) → rouge.
  it('compte des OCTETS UTF-8, pas des unités de code', () => {
    expect(
      mesure('⛔'),
      'La mesure compte des unités de code : un skill truffé de ⛔ et de ⚠️ ' +
        'pèserait deux à six fois moins que ce qu’il coûte réellement.'
    ).toBe(3);
  });
});

describe('S2 (SKILL-27) — plafond de commands/sdd-run-ticket.md', () => {
  // ⚠️ Mutation : ajouter un paragraphe au skill → rouge. C'est le SEUL rouge
  // que ce plafond puisse produire, et la seule preuve qu'il mord.
  it(`${SKILL_FILE} tient sous PLAFOND_SKILL (${PLAFOND_SKILL} octets)`, () => {
    const octets = mesureFichier(SKILL_FILE);
    expect(
      octets,
      `${SKILL_FILE} pèse ${octets} octets (LF), au-dessus du plafond ` +
        `${PLAFOND_SKILL}. Si ce grossissement est LÉGITIME (un ticket qui ` +
        `ajoute une consigne), re-mesure et rehausse PLAFOND_SKILL dans TON ` +
        `commit — c'est une édition d'une ligne, faite pour être visible dans ` +
        `le diff. S'il vient d'une prose explicative ou d'un mode d'emploi ` +
        `recopié, c'est la régression que ce plafond existe pour attraper.`
    ).toBeLessThanOrEqual(PLAFOND_SKILL);
  });
});

describe('S3 (SKILL-27) — plafond de prompts/', () => {
  // ⚠️ Mutation : déposer un prompts/*.md supplémentaire, ou déplacer un
  // paragraphe du skill vers un mode d'emploi → rouge. La compression du volet
  // A ne DÉMÉNAGE jamais : ce plafond le verrouille mécaniquement.
  it(`la somme des prompts/*.md tient sous PLAFOND_PROMPTS (${PLAFOND_PROMPTS} octets)`, () => {
    const { fichiers, octets } = mesurePrompts();
    expect(
      octets,
      `prompts/ pèse ${octets} octets (LF) au total (${fichiers.join(', ')}), ` +
        `au-dessus du plafond ${PLAFOND_PROMPTS}. Comprimer le skill en ` +
        `déplaçant sa prose ici n'est pas comprimer — c'est déménager.`
    ).toBeLessThanOrEqual(PLAFOND_PROMPTS);
  });

  // ⚠️ Mutation : figer la liste mesurée à un tableau de trois noms → rouge le
  // jour où un quatrième mode d'emploi apparaît, alors qu'il entrerait
  // autrement en silence, HORS plafond.
  itListeEgaleAuDossier(PROMPTS_DIR, mesurePrompts);
});

describe('S5 (SKILL-54) — plafond de steps/', () => {
  // ⚠️ Mutation : déplacer un paragraphe de plus du skill vers un steps/*.md
  // sans re-mesurer → rouge. C'est ce plafond, et lui seul, qui empêche
  // `steps/` de devenir le déversoir où le skill se viderait sans que rien ne
  // le constate (D2).
  it(`la somme des steps/*.md tient sous PLAFOND_STEPS (${PLAFOND_STEPS} octets)`, () => {
    const { fichiers, octets } = mesureSteps();
    expect(
      octets,
      `steps/ pèse ${octets} octets (LF) au total (${fichiers.join(', ')}), ` +
        `au-dessus du plafond ${PLAFOND_STEPS}. Le lecteur de steps/ est ` +
        `l'ORCHESTRATEUR : y verser de la prose qu'il lit à chaque cycle ne ` +
        `comprime rien, ça déplace le coût.`
    ).toBeLessThanOrEqual(PLAFOND_STEPS);
  });

  // ⚠️ Mutation : figer la liste mesurée à un tableau de deux noms → rouge le
  // jour où un troisième fichier d'étape apparaît, alors qu'il entrerait
  // autrement en silence, HORS plafond. Même garde que pour prompts/.
  itListeEgaleAuDossier(STEPS_DIR, mesureSteps);

  // ⚠️ Mutation : mesurer `steps/` en réutilisant `mesurePrompts()` (ou
  // l'inverse) → rouge. Les deux dossiers ont des lecteurs DIFFÉRENTS et des
  // plafonds distincts ; les confondre rendrait un franchissement de l'un
  // absorbable par la marge de l'autre.
  it('steps/ et prompts/ sont mesurés séparément, sur des listes disjointes', () => {
    const steps = mesureSteps().fichiers;
    const prompts = mesurePrompts().fichiers;
    expect(steps.length).toBeGreaterThan(0);
    expect(prompts.length).toBeGreaterThan(0);
    expect(
      mesureSteps().octets,
      `steps/ et prompts/ rendent la même mesure — les deux dossiers sont ` +
        `probablement confondus.`
    ).not.toBe(mesurePrompts().octets);
  });
});

describe('S6 (SKILL-91) — plafond de CLAUDE.md', () => {
  // ⚠️ Mutation : ajouter ~3000 octets à CLAUDE.md → rouge. C'est le SEUL
  // rouge que ce plafond puisse produire, et la seule preuve qu'il mord — même
  // forme que S2/S5 ci-dessus.
  it(`${CLAUDE_FILE} tient sous PLAFOND_CLAUDE_MD (${PLAFOND_CLAUDE_MD} octets)`, () => {
    const octets = mesureFichier(CLAUDE_FILE);
    expect(
      octets,
      `${CLAUDE_FILE} pèse ${octets} octets (LF), au-dessus du plafond ` +
        `${PLAFOND_CLAUDE_MD}. Si ce grossissement est LÉGITIME (un ticket qui ` +
        `ajoute une règle globale), re-mesure et rehausse PLAFOND_CLAUDE_MD ` +
        `dans TON commit — c'est une édition d'une ligne, faite pour être ` +
        `visible dans le diff. ${CLAUDE_FILE} est chargé à CHAQUE session de ` +
        `CHAQUE projet : c'est la surface la plus chère du dépôt à laisser ` +
        `grossir sans contrôle.`
    ).toBeLessThanOrEqual(PLAFOND_CLAUDE_MD);
  });
});

describe('S7 (SKILL-97) — plafond de rules/', () => {
  // ⚠️ Mutation : déposer un `rules/*.md` supplémentaire, ou rapatrier ici un
  // paragraphe de plus de `CLAUDE.md` → rouge. Sortir la méthode de la surface
  // payée à chaque session n'est pas la comprimer : sans ce plafond, c'est un
  // déménagement, et `rules/` reprend en silence le rôle de déversoir.
  it(`la somme des rules/*.md tient sous PLAFOND_RULES (${PLAFOND_RULES} octets)`, () => {
    const { fichiers, octets } = mesureRules();
    expect(
      octets,
      `rules/ pèse ${octets} octets (LF) au total (${fichiers.join(', ')}), ` +
        `au-dessus du plafond ${PLAFOND_RULES}. Une règle path-scopée coûte ` +
        `moins cher que CLAUDE.md — elle ne coûte pas RIEN : elle est chargée ` +
        `en entier dès qu'un fichier matche son glob.`
    ).toBeLessThanOrEqual(PLAFOND_RULES);
  });

  // ⚠️ Mutation : figer la liste mesurée au seul `maturation.md` → rouge le
  // jour où une seconde règle apparaît, alors qu'elle entrerait autrement en
  // silence, HORS plafond. Même garde que pour prompts/ et steps/ — et c'est
  // pourquoi ce plafond couvre le DOSSIER, pas le fichier de ce ticket.
  //
  // ⚠️ Reprise de gate : le chargeur de règles du client descend dans les
  // SOUS-DOSSIERS. `rules/maturation/escalades.md` était donc chargé en session
  // tout en restant hors de cette mesure — d'où la récursion de
  // `listeMdRecursive`, et cette assertion partagée qui la contrôle.
  itListeEgaleAuDossier(RULES_DIR, mesureRules);
});

// S4 (SKILL-27) — RETIRÉ par SKILL-26 (2026-08-22), comme prévu par son propre
// commentaire : « RETIRABLE par le ticket qui fait LÉGITIMEMENT regrossir le
// skill au-delà de TAILLE_AVANT_SKILL (D8), dans SON commit, et lui seul. »
// PLAFOND_SKILL (72131) est désormais AU-DESSUS de TAILLE_AVANT_SKILL (71924,
// mesuré 2026-08-20 au commit 996606e) : l'agrégateur (Étape 6.4.5, bloc
// `<!-- APPEL:aggregator -->`) fait légitimement regrossir le skill au-delà de
// sa taille d'avant compression. Le retrait de S4 n'emporte pas celui de S2/S3,
// qui restent au-dessus et mordent toujours.
