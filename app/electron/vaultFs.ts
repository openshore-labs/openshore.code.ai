// The desktop vault folder's file work, as main's osc:vault* handlers run it.
// The code lives in the engine now (os-code core/vault/folderFs.ts, Vault M5,
// CTO J7) so the daemon's vault routes share it byte for byte; this module
// re-exports it so main and the tests keep their import
// (test/providerContract.test.ts, test/deviceFolder.test.ts).
export * from 'os-code/dist/src/core/vault/folderFs.js';
