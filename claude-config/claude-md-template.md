# Template CLAUDE.md — nouveau projet
# Copier ce fichier, décommenter les sections pertinentes, supprimer le reste.

## Stack
# Décrire le framework, la DB, le déploiement.
# Aide Claude à ne pas supposer et à utiliser les bons outils.
# Exemple :
# - Framework : Next.js 14 App Router
# - DB : Supabase (RLS activé)
# - Déploiement : Vercel

## Structure
# Décrire les dossiers importants et leur rôle.
# Utile si la structure n'est pas standard.
# Exemple :
# src/app/       → routes
# src/lib/       → clients, utilitaires
# specs/         → source de vérité SDD

## Vérification
# Quelle commande valide que le code est correct ?
# Exemple :
# npm run build       (Next.js)
# pytest              (Python)
# go test ./...       (Go)
#
# INTERDIT si applicable : npm run dev, preview_start, tout serveur local.

## Variables d'environnement
# Lister les variables attendues et où les configurer.
# Ne jamais commiter .env.local

## Règles métier
# Ce que Claude ne peut pas deviner en lisant le code.
# Exemples typiques :
# - Persistance : tout passe par X, jamais localStorage
# - Auth : sessions côté serveur uniquement
# - Données multi-tenant : toujours filtrer par org_id

## Backlog
# Fichier backlog.md à la racine — priorisation MoSCoW.
# Définir ici les préfixes de tickets utilisés dans ce projet.
# Exemple :
# - AUTH-xx  → module authentification
# - RISQUE-xx → module gestion des risques
# - INFRA-xx  → infrastructure, CI/CD, migrations

## Git
# Convention de branches, merge strategy, format des commits.
# Exemple :
# - Branches : claude/scope-nn-description
# - Merge : fast-forward uniquement, pas de PR interne
# - Format : feat(SCOPE-NN): message

## Interdictions spécifiques
# Ce que Claude a tendance à faire et qui ne convient pas à ce projet.
# Exemples :
# - Ne pas utiliser fetch côté client quand un Server Component suffit
# - Ne pas mocker la DB dans les tests (risque de divergence prod)
# - Ne pas ajouter de commentaires explicatifs dans le code
