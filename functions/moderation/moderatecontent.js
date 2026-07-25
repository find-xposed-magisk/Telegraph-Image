// Legacy provider, kept for deployments that still hold a working API key.
// moderatecontent.com has stopped accepting new registrations, and this
// endpoint can only score files that are publicly reachable via telegra.ph
// (legacy Telegraph uploads) — Bot API uploads are not reachable that way.
export const moderateContentProvider = {
    key: 'moderatecontent',

    async moderate(env, { fileId, search }) {
        if (!env.ModerateContentApiKey) {
            return null;
        }

        const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph/file/${fileId}${search}`;
        const moderateResponse = await fetch(moderateUrl);

        if (!moderateResponse.ok) {
            console.error('Content moderation API request failed: ' + moderateResponse.status);
            return null;
        }

        const moderateData = await moderateResponse.json();
        return moderateData?.rating_label || null;
    },
};
