const assert = require('assert');
const { makeContext } = require('./helpers');

describe('/api/config endpoint', function () {
  it('returns defaults when nothing is configured', async function () {
    const { onRequestGet } = await import('../functions/api/config.js');
    const res = await onRequestGet(makeContext({ env: {} }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'application/json');
    assert.deepStrictEqual(JSON.parse(await res.text()), {
      siteName: 'Telegraph-Image',
      siteTitle: 'Telegraph-Image | 免费图床',
      backgroundImage: '',
      enableShortUrls: false,
      uploadRequiresAuth: false,
      showAdminEntry: true,
    });
  });

  it('reflects site customization variables', async function () {
    const { onRequestGet } = await import('../functions/api/config.js');
    const res = await onRequestGet(makeContext({
      env: {
        SITE_NAME: 'My Images',
        SITE_TITLE: 'My Images | Home',
        SITE_BACKGROUND: 'https://example.com/bg.jpg',
        ENABLE_SHORT_URLS: 'true',
        UPLOAD_BASIC_USER: 'user',
        UPLOAD_BASIC_PASS: 'pass',
        HIDE_ADMIN_ENTRY: 'true',
      },
    }));

    assert.deepStrictEqual(JSON.parse(await res.text()), {
      siteName: 'My Images',
      siteTitle: 'My Images | Home',
      backgroundImage: 'https://example.com/bg.jpg',
      enableShortUrls: true,
      uploadRequiresAuth: true,
      showAdminEntry: false,
    });
  });

  it('never leaks unrelated environment variables', async function () {
    const { onRequestGet } = await import('../functions/api/config.js');
    const res = await onRequestGet(makeContext({
      env: {
        TG_Bot_Token: 'secret-token',
        BASIC_PASS: 'secret-pass',
      },
    }));

    const body = await res.text();
    assert.ok(!body.includes('secret-token'));
    assert.ok(!body.includes('secret-pass'));
  });
});
