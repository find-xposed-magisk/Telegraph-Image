const assert = require('assert');

describe('internal KV key detection', function () {
  async function getModule() {
    return await import('../functions/utils/kv-keys.js');
  }

  it('treats namespaced keys as internal', async function () {
    const { isInternalKey } = await getModule();
    assert.strictEqual(isInternalKey('short:AbC123'), true);
    assert.strictEqual(isInternalKey('moderation:live-models'), true);
  });

  it('treats real file ids as regular files', async function () {
    const { isInternalKey } = await getModule();
    assert.strictEqual(isInternalKey('cat.png'), false);
    assert.strictEqual(isInternalKey('r2-9f8e7d6c5b4a.png'), false);
    assert.strictEqual(isInternalKey('AgACAgEAAxkDAAMDZt1Gzs4W8dQPWiQJxO5YSH5X-gs.png'), false);
    assert.strictEqual(isInternalKey(undefined), false);
  });
});
