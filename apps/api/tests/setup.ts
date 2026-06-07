// Global test setup. A fixed encryption key so secret-encryption code paths work
// deterministically under vitest. (crypto.test.ts overrides this per-test.)
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
