const assert = require('assert');
const { createMockKV, installFetchMock, makeContext, muteConsole } = require('./helpers');

const baseMetadata = {
  TimeStamp: 1710000000000,
  ListType: 'None',
  Label: 'None',
  liked: false,
  fileName: 'cat.png',
  fileSize: 123,
};

function createMockAI(answer) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return { description: answer };
    },
  };
}

describe('moderation providers', function () {
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

  describe('provider selection', function () {
    it('selects none when nothing is configured', async function () {
      const { getModerationProvider } = await import('../functions/moderation/index.js');
      assert.strictEqual(getModerationProvider({}).key, 'none');
    });

    it('auto-selects moderatecontent when an API key is present', async function () {
      const { getModerationProvider } = await import('../functions/moderation/index.js');
      assert.strictEqual(getModerationProvider({ ModerateContentApiKey: 'key' }).key, 'moderatecontent');
    });

    it('auto-selects cloudflare-ai when an AI binding is present', async function () {
      const { getModerationProvider } = await import('../functions/moderation/index.js');
      assert.strictEqual(getModerationProvider({ AI: {} }).key, 'cloudflare-ai');
    });

    it('lets MODERATION_PROVIDER override auto-detection', async function () {
      const { getModerationProvider } = await import('../functions/moderation/index.js');
      const env = { ModerateContentApiKey: 'key', AI: {}, MODERATION_PROVIDER: 'none' };
      assert.strictEqual(getModerationProvider(env).key, 'none');
    });

    it('falls back to none on an unknown MODERATION_PROVIDER', async function () {
      const { getModerationProvider } = await import('../functions/moderation/index.js');
      assert.strictEqual(getModerationProvider({ MODERATION_PROVIDER: 'acme' }).key, 'none');
    });
  });

  describe('cloudflare-ai provider via the file proxy', function () {
    it('labels clean images as everyone and serves them', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'cat.png': baseMetadata });
      const AI = createMockAI('no');

      fetchMock = installFetchMock(async () => new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));

      const res = await onRequest(makeContext({
        request: new Request('https://example.com/file/cat.png'),
        env: { img_url, AI },
        params: { id: 'cat.png' },
      }));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), 'image-body');
      assert.strictEqual(AI.calls.length, 1);
      assert.ok(Array.isArray(AI.calls[0].input.image));
      assert.strictEqual(img_url.snapshot('cat.png').metadata.Label, 'everyone');
    });

    it('labels flagged images as adult and redirects to the block page', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'cat.png': baseMetadata });
      const AI = createMockAI('Yes, this image contains explicit content.');

      fetchMock = installFetchMock(async () => new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));

      const res = await onRequest(makeContext({
        request: new Request('https://example.com/file/cat.png'),
        env: { img_url, AI },
        params: { id: 'cat.png' },
      }));

      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('Location'), 'https://example.com/block-img.html');
      assert.strictEqual(img_url.snapshot('cat.png').metadata.Label, 'adult');
    });

    it('uses the current llama vision model by default', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'cat.png': baseMetadata });
      const AI = createMockAI('no');

      fetchMock = installFetchMock(async () => new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));

      await onRequest(makeContext({
        request: new Request('https://example.com/file/cat.png'),
        env: { img_url, AI },
        params: { id: 'cat.png' },
      }));

      assert.strictEqual(AI.calls[0].model, '@cf/meta/llama-3.2-11b-vision-instruct');
    });

    it('falls back to the next model when the preferred one is unavailable', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'cat.png': baseMetadata });
      const calls = [];
      const AI = {
        calls,
        async run(model, input) {
          calls.push({ model, input });
          if (calls.length === 1) {
            throw new Error('No such model');
          }
          return { response: 'no' };
        },
      };

      fetchMock = installFetchMock(async () => new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));

      const res = await onRequest(makeContext({
        request: new Request('https://example.com/file/cat.png'),
        env: { img_url, AI },
        params: { id: 'cat.png' },
      }));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].model, '@cf/meta/llama-3.2-11b-vision-instruct');
      assert.strictEqual(calls[1].model, '@cf/llava-hf/llava-1.5-7b-hf');
      assert.strictEqual(img_url.snapshot('cat.png').metadata.Label, 'everyone');
    });

    it('honors a custom MODERATION_AI_MODEL', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'cat.png': baseMetadata });
      const AI = createMockAI('no');

      fetchMock = installFetchMock(async () => new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));

      await onRequest(makeContext({
        request: new Request('https://example.com/file/cat.png'),
        env: { img_url, AI, MODERATION_AI_MODEL: '@cf/custom/model' },
        params: { id: 'cat.png' },
      }));

      assert.strictEqual(AI.calls[0].model, '@cf/custom/model');
    });

    it('skips non-image files', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'notes.txt': { ...baseMetadata, fileName: 'notes.txt' } });
      const AI = createMockAI('no');

      fetchMock = installFetchMock(async () => new Response('text-body', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }));

      const res = await onRequest(makeContext({
        request: new Request('https://example.com/file/notes.txt'),
        env: { img_url, AI },
        params: { id: 'notes.txt' },
      }));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(AI.calls.length, 0);
      assert.strictEqual(img_url.snapshot('notes.txt').metadata.Label, 'None');
    });

    it('fails open when the AI call throws', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'cat.png': baseMetadata });
      const AI = {
        async run() {
          throw new Error('AI quota exceeded');
        },
      };

      fetchMock = installFetchMock(async () => new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));

      const res = await onRequest(makeContext({
        request: new Request('https://example.com/file/cat.png'),
        env: { img_url, AI },
        params: { id: 'cat.png' },
      }));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), 'image-body');
    });
  });

  describe('shared moderation behavior', function () {
    it('does not re-moderate files that already carry a verdict', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'cat.png': { ...baseMetadata, Label: 'everyone' } });
      const AI = createMockAI('no');

      fetchMock = installFetchMock(async () => new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));

      const res = await onRequest(makeContext({
        request: new Request('https://example.com/file/cat.png'),
        env: { img_url, AI, ModerateContentApiKey: 'moderate-key' },
        params: { id: 'cat.png' },
      }));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(AI.calls.length, 0);
      assert.strictEqual(fetchMock.calls.length, 1, 'only the file fetch should happen');
    });

    it('MODERATION_PROVIDER=none disables moderation even with a legacy key set', async function () {
      const { onRequest } = await import('../functions/file/[id].js');
      const img_url = createMockKV({ 'cat.png': baseMetadata });

      fetchMock = installFetchMock(async () => new Response('image-body', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));

      const res = await onRequest(makeContext({
        request: new Request('https://example.com/file/cat.png'),
        env: { img_url, ModerateContentApiKey: 'moderate-key', MODERATION_PROVIDER: 'none' },
        params: { id: 'cat.png' },
      }));

      assert.strictEqual(res.status, 200);
      assert.strictEqual(fetchMock.calls.length, 1, 'no moderation request should be made');
    });
  });
});
