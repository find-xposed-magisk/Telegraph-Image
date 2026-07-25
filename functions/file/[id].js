import {
    LABEL,
    getOrCreateMetadata,
    isBlocked,
    isWhitelisted,
    putMetadata,
} from "../utils/metadata.js";
import { isShortUrlsEnabled, looksLikeShortId, resolveShortId } from "../utils/shortlink.js";
import { getServingProvider } from "../storage/index.js";
import { getModerationProvider } from "../moderation/index.js";

export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);

    // Anti-hotlinking: reject disallowed referers before spending upstream bandwidth
    if (!isRefererAllowed(env, request, url)) {
        return new Response('Hotlinking is not allowed on this deployment.', {
            status: 403,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        });
    }

    const fileId = await resolveRequestedId(env, params.id);
    const response = await getServingProvider(fileId).fetchFile(env, request, url, fileId);

    // If the response is OK, proceed with further checks
    if (!response.ok) return response;

    // Allow the admin page to directly view the image
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return withFileHeaders(response, fileId);
    }

    // Check if KV storage is available
    if (!env.img_url) {
        console.log("KV storage not available, returning image directly");
        return withFileHeaders(response, fileId);  // Directly return image response, terminate execution
    }

    const metadata = await getOrCreateMetadata(env, fileId);

    // Handle based on ListType and Label
    if (isWhitelisted(metadata)) {
        return withFileHeaders(response, fileId);
    } else if (isBlocked(metadata)) {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // Check if WhiteList_Mode is enabled
    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // If no metadata or further actions required, moderate content and add to KV if needed
    const moderationResult = await moderateFile(env, url, fileId, metadata, response);
    if (moderationResult.blocked) {
        await putMetadata(env, fileId, metadata);
        return Response.redirect(`${url.origin}/block-img.html`, 302);
    }

    // Only save metadata if content is not adult content
    // Adult content cases are already handled above and will not reach this point
    await putMetadata(env, fileId, metadata);

    // Return file content
    return withFileHeaders(response, fileId);
}

// Short ids are resolved before the file URL is built, so short links work for
// Telegraph-stored files as well as Bot API files.
async function resolveRequestedId(env, requestedId) {
    if (!env.img_url || !isShortUrlsEnabled(env) || requestedId.includes('.') || !looksLikeShortId(requestedId)) {
        return requestedId;
    }

    const target = await resolveShortId(env, requestedId);
    return target || requestedId;
}

// ALLOWED_REFERERS is a comma-separated hostname allowlist ("example.com,*.example.org").
// Empty referers (direct visits, curl, native apps) always pass, as does the
// deployment's own origin; the feature is opt-in and off when the var is unset.
function isRefererAllowed(env, request, url) {
    const allowlist = String(env.ALLOWED_REFERERS || '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);

    if (allowlist.length === 0) {
        return true;
    }

    const referer = request.headers.get('Referer');
    if (!referer) {
        return true;
    }

    let refererHost;
    try {
        refererHost = new URL(referer).hostname.toLowerCase();
    } catch {
        return false;
    }

    if (refererHost === url.hostname.toLowerCase()) {
        return true;
    }

    return allowlist.some(pattern => matchesHost(pattern.toLowerCase(), refererHost));
}

function matchesHost(pattern, host) {
    if (pattern.startsWith('*.')) {
        const base = pattern.slice(2);
        return host === base || host.endsWith('.' + base);
    }

    return host === pattern;
}

async function moderateFile(env, url, fileId, metadata, response) {
    // A stored verdict is final — re-moderating every view would burn provider
    // quota (and for Workers AI, neuron allocation) for no new information.
    if (metadata.Label && metadata.Label !== LABEL.NONE) {
        return { blocked: isBlocked(metadata) };
    }

    try {
        const provider = getModerationProvider(env);
        const label = await provider.moderate(env, {
            fileId,
            search: url.search,
            response,
        });

        if (label) {
            metadata.Label = label;
        }
    } catch (error) {
        console.error("Error during content moderation: " + error.message);
    }

    return { blocked: isBlocked(metadata) };
}

function withFileHeaders(response, filename) {
    const upstreamType = response.headers.get('Content-Type') || '';
    const correctedType = isUsableContentType(upstreamType) ? null : contentTypeFromFilename(filename);
    const effectiveType = correctedType || upstreamType;
    const inline = isPreviewableContent(effectiveType) || isPreviewableFilename(filename);

    if (!correctedType && !inline) {
        return response;
    }

    const headers = new Headers(response.headers);
    if (correctedType) {
        headers.set('Content-Type', correctedType);
    }
    if (inline) {
        headers.set('Content-Disposition', `inline; filename="${escapeFilename(filename)}"`);
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function isUsableContentType(contentType) {
    return contentType !== '' && !contentType.startsWith('application/octet-stream');
}

// svg is deliberately absent: serving user uploads as image/svg+xml would allow
// stored XSS on the deployment's own origin.
const CONTENT_TYPES_BY_EXTENSION = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    apng: 'image/apng',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    mov: 'video/quicktime',
    webm: 'video/webm',
    ogv: 'video/ogg',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    pdf: 'application/pdf',
};

function contentTypeFromFilename(filename) {
    const extension = String(filename).split('.').pop().toLowerCase();
    return CONTENT_TYPES_BY_EXTENSION[extension] || null;
}

function isPreviewableContent(contentType) {
    return contentType.startsWith('image/')
        || contentType.startsWith('video/')
        || contentType.startsWith('audio/')
        || contentType.startsWith('application/pdf');
}

function isPreviewableFilename(filename) {
    return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|apng|mp4|m4v|mov|webm|ogv|mp3|m4a|ogg|oga|wav|flac|aac|pdf)$/i.test(String(filename));
}

function escapeFilename(filename) {
    return String(filename).replace(/["\\]/g, '_');
}
