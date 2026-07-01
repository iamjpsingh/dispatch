// Global test setup. A fixed encryption key so secret-encryption code paths work
// deterministically under vitest. (crypto.test.ts overrides this per-test.)
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
// Suppression-by-hash secret so hashEmail() and boot()'s fail-fast work under vitest.
// (suppressionHash.test.ts overrides this per-test.)
process.env.SUPPRESSION_HASH_SECRET ||= 'test-suppression-secret'
