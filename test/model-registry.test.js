const assert = require('assert');
const { createMockKV, installFetchMock, makeContext, muteConsole } = require('./helpers');

const LLAMA_VISION = '@cf/meta/llama-3.2-11b-vision-instruct';
const LLAVA = '@cf/llava-hf/llava-1.5-7b-hf';

function catalogResponse(result) {
  return Response.json({ success: true, errors: [], messages: [], result });
}

describe('moderation model registry', function () {
  let restoreConsole;
  let fetchMock;

  beforeEach(function () {
    restoreConsole = muteConsole();
  });

  afterEach(function () {
    if (fetchMock) {
      fetchMock.restore();
      fetchMock = null;
    }
    restoreConsole();
  });

  it('uses the static chain when discovery credentials are not configured', async function () {
    const { resolveModerationModels, DEFAULT_MODELS } = await import('../functions/moderation/model-registry.js');
    assert.deepStrictEqual(await resolveModerationModels({}), DEFAULT_MODELS);
  });

  it('uses only the pinned model when MODERATION_AI_MODEL is set', async function () {
    const { resolveModerationModels } = await import('../functions/moderation/model-registry.js');
    const models = await resolveModerationModels({
      MODERATION_AI_MODEL: '@cf/custom/model',
      CF_ACCOUNT_ID: 'acc',
      CF_API_TOKEN: 'token',
    });
    assert.deepStrictEqual(models, ['@cf/custom/model']);
  });

  it('builds the chain from the live catalog: preferred models first, then live vision models', async function () {
    const { resolveModerationModels } = await import('../functions/moderation/model-registry.js');

    fetchMock = installFetchMock(async (input, init) => {
      assert.strictEqual(String(input), 'https://api.cloudflare.com/client/v4/accounts/acc/ai/models/search?per_page=100');
      assert.strictEqual(init.headers.Authorization, 'Bearer token');
      return catalogResponse([
        { name: LLAMA_VISION, task: { name: 'Text Generation' } },
        { name: '@cf/moondream/moondream3.1', task: { name: 'Image-to-Text' } },
        { name: '@cf/meta/llama-3.1-8b-instruct', task: { name: 'Text Generation' } },
      ]);
    });

    const models = await resolveModerationModels({ CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'token' });

    // llava is not in the live catalog, so it drops out; the text-only model is
    // never added; the live Image-to-Text model extends the chain.
    assert.deepStrictEqual(models, [LLAMA_VISION, '@cf/moondream/moondream3.1']);
  });

  it('excludes catalog entries whose deprecation date has passed', async function () {
    const { resolveModerationModels } = await import('../functions/moderation/model-registry.js');

    fetchMock = installFetchMock(async () => catalogResponse([
      { name: LLAMA_VISION, task: { name: 'Text Generation' } },
      {
        name: LLAVA,
        task: { name: 'Image-to-Text' },
        properties: [{ property_id: 'planned_deprecation_date', value: '2020-01-01' }],
      },
      {
        name: '@cf/future/vision-model',
        task: { name: 'Image-to-Text' },
        planned_deprecation_date: '2999-01-01',
      },
    ]));

    const models = await resolveModerationModels({ CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'token' });

    assert.deepStrictEqual(models, [LLAMA_VISION, '@cf/future/vision-model']);
  });

  it('caches the catalog in KV and skips refetching while the cache is warm', async function () {
    const { resolveModerationModels } = await import('../functions/moderation/model-registry.js');
    const img_url = createMockKV();

    fetchMock = installFetchMock(async () => catalogResponse([
      { name: LLAMA_VISION, task: { name: 'Text Generation' } },
    ]));

    const env = { CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'token', img_url };
    const first = await resolveModerationModels(env);
    const second = await resolveModerationModels(env);

    assert.deepStrictEqual(first, [LLAMA_VISION]);
    assert.deepStrictEqual(second, [LLAMA_VISION]);
    assert.strictEqual(fetchMock.calls.length, 1, 'the catalog API should only be hit once');
    assert.ok(img_url.snapshot('moderation:live-models'), 'catalog should be cached in KV');
  });

  it('falls back to the static chain when the catalog API fails', async function () {
    const { resolveModerationModels, DEFAULT_MODELS } = await import('../functions/moderation/model-registry.js');

    fetchMock = installFetchMock(async () => new Response('upstream error', { status: 500 }));

    const models = await resolveModerationModels({ CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'token' });
    assert.deepStrictEqual(models, DEFAULT_MODELS);
  });

  it('falls back to the static chain when the catalog has no usable models', async function () {
    const { resolveModerationModels, DEFAULT_MODELS } = await import('../functions/moderation/model-registry.js');

    fetchMock = installFetchMock(async () => catalogResponse([]));

    const models = await resolveModerationModels({ CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'token' });
    assert.deepStrictEqual(models, DEFAULT_MODELS);
  });
});
