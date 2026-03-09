import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
import axios from 'axios';
// This is a placeholder for the actual API integrations (Twitter/LinkedIn)
async function publishToPlatform(platform, handle, content, mediaUrls, token) {
    console.log(`\n[Publishing] Attempting to publish to ${platform} (${handle})...`);
    console.log(`[Publishing] Content: "${content}"`);
    if (mediaUrls && mediaUrls.length > 0) {
        console.log(`[Publishing] Attached Media: ${mediaUrls.join(', ')}`);
    }
    try {
        if (mediaUrls && mediaUrls.length > 0 && mediaUrls[0].includes('localhost')) {
            console.warn(`[Publishing Warning] The media URL (${mediaUrls[0]}) contains 'localhost'. Facebook/Instagram Graph API cannot download from localhost. You must configure a public MINIO_ENDPOINT in your .env file.`);
        }
        if (platform === 'instagram') {
            if (!mediaUrls || mediaUrls.length === 0) {
                console.error(`[Publishing] Instagram requires an image or video URL to post.`);
                return false;
            }
            const imageUrl = mediaUrls[0]; // IG Graph API currently supports 1 image for basic publishing without carousels
            // We need to find the Instagram User ID from the token again, or parse it from DB
            // Note: we can find the IG business account ID by querying me/accounts -> page -> instagram_business_account
            // This is slightly inefficient to do every post, but it guarantees we have the right ID.
            const pagesResponse = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
                params: { access_token: token }
            });
            const pages = pagesResponse.data.data;
            let instagramAccountId = null;
            for (const page of pages) {
                try {
                    const igResponse = await axios.get(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account`, {
                        params: { access_token: token }
                    });
                    if (igResponse.data.instagram_business_account) {
                        instagramAccountId = igResponse.data.instagram_business_account.id;
                        break;
                    }
                }
                catch (e) {
                    // Ignore pages without connected IG accounts
                }
            }
            if (!instagramAccountId) {
                console.error(`[Publishing] Could not find Instagram Business Account ID for this user.`);
                return false;
            }
            // Step 1: Create a media container
            const containerResponse = await axios.post(`https://graph.facebook.com/v19.0/${instagramAccountId}/media`, null, {
                params: {
                    image_url: imageUrl,
                    caption: content,
                    access_token: token
                }
            });
            const creationId = containerResponse.data.id;
            console.log(`[Publishing] Created Instagram media container: ${creationId}`);
            // Step 2: Publish the media container
            const publishResponse = await axios.post(`https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`, null, {
                params: {
                    creation_id: creationId,
                    access_token: token
                }
            });
            console.log(`[Publishing] Successfully published to Instagram! IG Media ID: ${publishResponse.data.id}\n`);
            return true;
        }
        else if (platform === 'facebook') {
            let endpoint = `https://graph.facebook.com/v19.0/me/feed`;
            const payload = { access_token: token };
            if (mediaUrls && mediaUrls.length > 0) {
                // If there's an image, post to /me/photos instead
                endpoint = `https://graph.facebook.com/v19.0/me/photos`;
                payload.url = mediaUrls[0];
                payload.caption = content;
            }
            else {
                payload.message = content;
            }
            const publishResponse = await axios.post(endpoint, null, { params: payload });
            console.log(`[Publishing] Successfully published to Facebook Page! Post ID: ${publishResponse.data.id}\n`);
            return true;
        }
        else {
            // MOCK FALLBACK for unknown platforms
            await new Promise(resolve => setTimeout(resolve, 1500));
            console.log(`[MOCK API] Successfully published to ${platform}!\n`);
            return true;
        }
    }
    catch (error) {
        console.error(`[Publishing Error] Failed to publish to ${platform}:`, error?.response?.data || error.message);
        return false;
    }
}
export function startScheduler(bot) {
    console.log('⏰ Background Scheduler started. Checking for posts every minute...');
    // Run this function every single minute ('* * * * *')
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            // Find all posts that are pending and their scheduled time has arrived or passed
            const postsToPublish = await prisma.post.findMany({
                where: {
                    status: 'pending',
                    scheduledAt: {
                        lte: now // "less than or equal to" current time
                    }
                },
                include: {
                    user: {
                        include: {
                            accounts: true // Bring the user's connected social accounts to get tokens
                        }
                    }
                }
            });
            if (postsToPublish.length > 0) {
                console.log(`[Scheduler] Found ${postsToPublish.length} post(s) to publish at ${now.toISOString()}`);
            }
            for (const post of postsToPublish) {
                let allPlatformsSucceeded = true;
                const failedPlatforms = [];
                const successPlatforms = [];
                for (const handle of post.platforms) {
                    // Remove "@" and lower case to match handles robustly.
                    const cleanTargetHandle = handle.replace(/^@/, '').toLowerCase();
                    // The database handles are stored as e.g. "@Socialbuddies"
                    // We must clean those similarly to match.
                    const account = post.user.accounts.find(acc => acc.handle.replace(/^@/, '').toLowerCase() === cleanTargetHandle);
                    if (!account) {
                        console.error(`[Scheduler] Account not found for Target: ${handle} (Cleaned Target: ${cleanTargetHandle})`);
                        allPlatformsSucceeded = false;
                        failedPlatforms.push(handle);
                        continue;
                    }
                    // Trigger the API call
                    const success = await publishToPlatform(account.platform, account.handle, post.content, post.mediaUrls, account.token);
                    if (success) {
                        successPlatforms.push(handle);
                    }
                    else {
                        allPlatformsSucceeded = false;
                        failedPlatforms.push(handle);
                    }
                }
                // Update the database to reflect the final status
                const finalStatus = allPlatformsSucceeded ? 'published' : 'failed';
                await prisma.post.update({
                    where: { id: post.id },
                    data: { status: finalStatus }
                });
                console.log(`[Scheduler] Post ${post.id} updated to status: ${finalStatus}`);
                // Notify the user via Telegram when a bot instance is available.
                if (bot) {
                    try {
                        let notifyMsg = `🔔 Post Update\n\n`;
                        if (finalStatus === 'published') {
                            notifyMsg += `✅ Your scheduled post has been published successfully to: ${successPlatforms.join(', ')}\n\n`;
                        }
                        else {
                            notifyMsg += `⚠️ There was an issue publishing your scheduled post.\n\n`;
                            if (successPlatforms.length > 0)
                                notifyMsg += `✅ Succeeded: ${successPlatforms.join(', ')}\n`;
                            if (failedPlatforms.length > 0)
                                notifyMsg += `❌ Failed: ${failedPlatforms.join(', ')}\n`;
                        }
                        notifyMsg += `📝 Content: "${post.content}"`;
                        // Using no parse_mode (plain text) to avoid crashes with user-provided characters like *, _, [, ]
                        await bot.telegram.sendMessage(post.user.telegramId, notifyMsg);
                    }
                    catch (botErr) {
                        console.error(`[Scheduler] Failed to notify user ${post.user.telegramId}:`, botErr);
                    }
                }
            }
        }
        catch (error) {
            console.error('[Scheduler] Critical error during execution:', error);
        }
    });
}
