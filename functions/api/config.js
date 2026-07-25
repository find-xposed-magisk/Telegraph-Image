import { isEmptyBinding, jsonResponse } from '../utils/http.js';
import { isShortUrlsEnabled } from '../utils/shortlink.js';

// Public, non-sensitive site configuration for the frontend. Any static UI can
// read this once at startup instead of the deployment having to edit HTML.
export async function onRequestGet(context) {
    const { env } = context;

    return jsonResponse({
        siteName: env.SITE_NAME || 'Telegraph-Image',
        siteTitle: env.SITE_TITLE || env.SITE_NAME || 'Telegraph-Image | 免费图床',
        backgroundImage: env.SITE_BACKGROUND || '',
        enableShortUrls: isShortUrlsEnabled(env),
        uploadRequiresAuth: !isEmptyBinding(env.UPLOAD_BASIC_USER) && !isEmptyBinding(env.UPLOAD_BASIC_PASS),
        showAdminEntry: env.HIDE_ADMIN_ENTRY !== 'true',
    }, {
        headers: { 'Cache-Control': 'no-store' },
    });
}
