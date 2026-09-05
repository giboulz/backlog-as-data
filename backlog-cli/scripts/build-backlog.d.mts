// INFRA-14 — Types pour le build script .mjs (allowJs: false → import .mjs depuis
// un .ts a besoin d'une déclaration). Source : scripts/build-backlog.mjs.
export function buildBundle(opts?: { outfile?: string }): Promise<string>;
export function installHint(): string;
