// The keep-both name for a note's second version moved into the Vault's
// shared core (Vault M3, CTO H4): `harness/vault/paths.ts`, beside the one
// new-name rule it cleans with. This module stays as a re-export, since the
// desktop's main process imports it by this path from os-code/dist.
export { vaultConflictCopyPath } from '../../harness/vault/paths.js';
