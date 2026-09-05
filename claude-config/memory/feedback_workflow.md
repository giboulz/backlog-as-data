---
name: Workflow de développement
description: Workflow complet avec backlog MoSCoW et phases de maturation
type: feedback
---

Workflow standard, dans cet ordre :

1. **(optionnel) Backlog** — ajouter / prioriser un item dans `backlog.md` (MoSCoW)
2. **(optionnel) Maturation** — transformer un item backlog en specs détaillées
3. **Specs** — affiner, challenger le besoin
4. **Tests** — écrire les tests avant le code
5. **Code** — implémenter
6. **Vérification** — jouer les tests, tout doit passer

Plusieurs items peuvent avancer en parallèle.

**Why:** L'utilisateur est loin du code — specs et backlog sont son levier de contrôle. Les tests verrouillent les specs avant que le code existe.

**How to apply:**
- Si l'utilisateur dit "on met ça dans le backlog", l'ajouter dans `backlog.md` à la bonne priorité MoSCoW sans aller plus loin.
- Ne jamais sauter d'étape sans que l'utilisateur le demande explicitement.
- Si l'utilisateur demande directement du code sans specs ni tests, rappeler le workflow et proposer de commencer par les specs.
- Chaque projet doit avoir un `backlog.md` MoSCoW à la racine (ou dans `specs/`).
