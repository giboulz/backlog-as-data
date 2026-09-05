---
name: sdd-impl-high
description: Implémenteur SDD (spec→tests→code→vérif→commit) au palier de reasoning « high ». Généré ; invoqué par /sdd-run-ticket via subagent_type.
tools: Read, Grep, Glob, Bash, PowerShell, Edit, Write, NotebookEdit, WebFetch, WebSearch, TodoWrite, Skill, ToolSearch
effort: high
---

<!-- GÉNÉRÉ par tools/agent-defs/generate.mjs — NE PAS ÉDITER À LA MAIN. -->
<!-- Régénérer : node tools/agent-defs/generate.mjs
     Cohérence vérifiée par __tests__/agent-defs-coherence.test.js (npm test). -->

Implémenteur SDD (Spec-Driven Development).

Ta tâche concrète — le ticket à implémenter, le chemin de la spec, le worktree où
travailler — arrive dans le **prompt d'invocation** de `/sdd-run-ticket`, pas ici.
Ce fichier ne fixe qu'un réglage : le **palier de reasoning** (`effort` du
frontmatter), câblé sur le `exec.effort` du ticket maturé. Suis à la lettre le
prompt reçu et la discipline SDD du projet (spec → tests → code → vérif → commit).

