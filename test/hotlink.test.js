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

describe('referer allowlist (anti-hotlinking)', function () {
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

  async function requestFile(env, referer) {
    const { onRequest } = await import('../functions/file/[id].js');
    const headers = new Headers();
    if (referer) headers.set('Referer', referer);

    return onRequest(makeContext({
      request: new Request('https://example.com/file/cat.png', { headers }),
      env,
      params: { id: 'cat.png' },
    }));
  }

  function allowingFetchMock() {
    return installFetchMock(async () => new Response('image-body', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
  }

  it('is disabled when ALLOWED_REFERERS is unset', async function () {
    fetchMock = allowingFetchMock();
    const res = await requestFile({ img_url: createMockKV({ 'cat.png': baseMetadata }) }, 'https://evil.example.net/page');
    assert.strictEqual(res.status, 200);
  });

  it('rejects referers outside the allowlist before fetching upstream', async function () {
    fetchMock = allowingFetchMock();
    const env = { img_url: createMockKV(), ALLOWED_REFERERS: 'myblog.com' };

    const res = await requestFile(env, 'https://evil.example.net/page');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(fetchMock.calls.length, 0, 'upstream must not be fetched for blocked referers');
  });

  it('allows exact hostname matches', async function () {
    fetchMock = allowingFetchMock();
    const env = { img_url: createMockKV({ 'cat.png': baseMetadata }), ALLOWED_REFERERS: 'myblog.com' };

    const res = await requestFile(env, 'https://myblog.com/post/1');
    assert.strictEqual(res.status, 200);
  });

  it('supports wildcard subdomain patterns', async function () {
    fetchMock = allowingFetchMock();
    const env = { img_url: createMockKV({ 'cat.png': baseMetadata }), ALLOWED_REFERERS: '*.myblog.com' };

    assert.strictEqual((await requestFile(env, 'https://cdn.myblog.com/')).status, 200);
    assert.strictEqual((await requestFile(env, 'https://myblog.com/')).status, 200);
    assert.strictEqual((await requestFile(env, 'https://notmyblog.com/')).status, 403);
  });

  it('always allows empty referers and the deployment origin', async function () {
    fetchMock = allowingFetchMock();
    const env = { img_url: createMockKV({ 'cat.png': baseMetadata }), ALLOWED_REFERERS: 'myblog.com' };

    assert.strictEqual((await requestFile(env, null)).status, 200);
    assert.strictEqual((await requestFile(env, 'https://example.com/gallery')).status, 200);
  });

  it('rejects malformed referer values when the allowlist is active', async function () {
    fetchMock = allowingFetchMock();
    const env = { img_url: createMockKV(), ALLOWED_REFERERS: 'myblog.com' };

    const res = await requestFile(env, 'not a url');
    assert.strictEqual(res.status, 403);
  });
});
