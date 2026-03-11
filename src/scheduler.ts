import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Telegraf } from 'telegraf';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

import axios from 'axios';

// This is a placeholder for the actual API integrations (Twitter/LinkedIn)
async function publishToPlatform(platform: string, handle: string, content: string, mediaUrls: string[], token: string): Promise<{ success: boolean, errorMsg?: string, remoteId?: string, url?: string }> {
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
         return { success: false, errorMsg: 'Instagram requires an attached image or video to post.' };
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
        } catch (e) {
             // Ignore pages without connected IG accounts
        }
      }

      if (!instagramAccountId) {
         console.error(`[Publishing] Could not find Instagram Business Account ID for this user.`);
         return { success: false, errorMsg: 'Could not find a connected Instagram Business Account on this Facebook page.' };
      }

      const isVideo = imageUrl.toLowerCase().match(/\.(mp4|mov)$/i);
      const params: any = {
        caption: content,
        access_token: token
      };

      if (isVideo) {
        params.video_url = imageUrl;
        params.media_type = 'REELS'; // Reels is typically used for video posts now
      } else {
        params.image_url = imageUrl;
      }

      // Step 1: Create a media container
      const containerResponse = await axios.post(`https://graph.facebook.com/v19.0/${instagramAccountId}/media`, null, {
        params: params
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
      
      // Instagram Graph API doesn't easily expose the direct post URL without querying the media node again for its shortcode, 
      // but we can return the ID. Let's fetch the shortcode to build the URL.
      let postUrl = '';
      try {
         const mediaDetails = await axios.get(`https://graph.facebook.com/v19.0/${publishResponse.data.id}?fields=shortcode`, {
           params: { access_token: token }
         });
         if (mediaDetails.data.shortcode) {
            postUrl = `https://www.instagram.com/p/${mediaDetails.data.shortcode}/`;
         }
      } catch (e) {
         console.error("[Publishing] Failed to fetch Instagram shortcode for URL generation", e);
      }

      return { success: true, remoteId: publishResponse.data.id, url: postUrl };
    } else if (platform === 'facebook') {
      let endpoint = `https://graph.facebook.com/v19.0/me/feed`;
      const payload: any = { access_token: token };

      if (mediaUrls && mediaUrls.length > 0) {
         const mediaUrl = mediaUrls[0];
         const isVideo = mediaUrl.toLowerCase().match(/\.(mp4|mov)$/i);

         if (isVideo) {
            endpoint = `https://graph.facebook.com/v19.0/me/videos`;
            payload.file_url = mediaUrl;
            payload.description = content;
         } else {
            // If there's an image, post to /me/photos instead
            endpoint = `https://graph.facebook.com/v19.0/me/photos`;
            payload.url = mediaUrl;
            payload.caption = content;
         }
      } else {
         payload.message = content;
      }

      const publishResponse = await axios.post(endpoint, null, { params: payload });
      const postId = publishResponse.data.id;
      // Facebook Graph API returns IDs in format PageID_PostID
      const parts = postId.split('_');
      const actualPostId = parts.length > 1 ? parts[1] : postId;
      const postUrl = `https://www.facebook.com/${actualPostId}`;
      
      console.log(`[Publishing] Successfully published to Facebook Page! Post ID: ${postId}\n`);
      return { success: true, remoteId: postId, url: postUrl };
    } else {
      // MOCK FALLBACK for unknown platforms
      await new Promise(resolve => setTimeout(resolve, 1500));
      const mockId = `mock-${Date.now()}`;
      console.log(`[MOCK API] Successfully published to ${platform}!\n`);
      return { success: true, remoteId: mockId, url: `https://${platform}.com/post/${mockId}` }; 
    }
  } catch (error: any) {
     const errorMsg = error?.response?.data?.error?.message || error?.response?.data?.message || error.message || "Unknown error";
     console.error(`[Publishing Error] Failed to publish to ${platform}:`, error?.response?.data || error.message);
     return { success: false, errorMsg };
  }
}

export async function deleteFromPlatform(platform: string, remoteId: string, token: string): Promise<{ success: boolean, errorMsg?: string }> {
  console.log(`\n[Publishing] Attempting to delete from ${platform} (ID: ${remoteId})...`);
  
  try {
     if (platform === 'facebook' || platform === 'instagram') {
        // Facebook Graph API generic delete endpoint works for both FB posts and IG Media
        await axios.delete(`https://graph.facebook.com/v19.0/${remoteId}`, {
           params: { access_token: token }
        });
        console.log(`[Publishing] Successfully deleted from ${platform}! ID: ${remoteId}\n`);
        return { success: true };
     } else {
        // Mock fallback for others
        await new Promise(resolve => setTimeout(resolve, 800));
        console.log(`[MOCK API] Successfully deleted from ${platform}!\n`);
        return { success: true };
     }
  } catch (error: any) {
     const errorMsg = error?.response?.data?.error?.message || error?.response?.data?.message || error.message || "Unknown error";
     console.error(`[Publishing Error] Failed to delete from ${platform}:`, error?.response?.data || error.message);
     return { success: false, errorMsg };
  }
}

export function startScheduler(bot?: Telegraf) {
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
        const failedPlatforms: string[] = [];
        const successPlatforms: string[] = [];
        const errorMessages: string[] = [];
        const publishedData: { platform: string, handle: string, remoteId: string, url: string }[] = [];

        for (const handle of post.platforms) {
          // Remove "@" and lower case to match handles robustly.
          const cleanTargetHandle = handle.replace(/^@/, '').toLowerCase();
          
          // The database handles are stored as e.g. "@Socialbuddies"
          // We must clean those similarly to match.
          const account = post.user.accounts.find(acc => 
            acc.handle.replace(/^@/, '').toLowerCase() === cleanTargetHandle
          );
          
          if (!account) {
            console.error(`[Scheduler] Account not found for Target: ${handle} (Cleaned Target: ${cleanTargetHandle})`);
            allPlatformsSucceeded = false;
            failedPlatforms.push(handle);
            errorMessages.push(`${handle}: Account not connected`);
            continue;
          }

          // Trigger the API call
          const result = await publishToPlatform(
            account.platform, 
            account.handle, 
            post.content, 
            post.mediaUrls, 
            account.token
          );
          
          if (result.success) {
            successPlatforms.push(handle);
            if (result.remoteId) {
               publishedData.push({
                   platform: account.platform,
                   handle: handle,
                   remoteId: result.remoteId,
                   url: result.url || ''
               });
            }
          } else {
            allPlatformsSucceeded = false;
            failedPlatforms.push(handle);
            if (result.errorMsg) {
              errorMessages.push(`${handle}: ${result.errorMsg}`);
            }
          }
        }

        // Update the database to reflect the final status
        const finalStatus = allPlatformsSucceeded ? 'published' : 'failed';
        const finalErrorMsg = errorMessages.length > 0 ? errorMessages.join(' | ') : null;
        
        await prisma.post.update({
          where: { id: post.id },
          data: { 
            status: finalStatus,
            errorMsg: finalErrorMsg,
            publishedData: publishedData
          }
        });
        
        console.log(`[Scheduler] Post ${post.id} updated to status: ${finalStatus}`);

        // Notify the user via Telegram when a bot instance is available.
        if (bot) {
          try {
            let notifyMsg = `🔔 Post Update\n\n`;
            if (finalStatus === 'published') {
              notifyMsg += `✅ Your scheduled post has been published successfully!\n\n`;
              for (const pData of publishedData) {
                  notifyMsg += `🟢 ${pData.handle}: `;
                  notifyMsg += pData.url ? pData.url : 'Published';
                  notifyMsg += `\n`;
              }
              notifyMsg += `\n`;
            } else {
              notifyMsg += `⚠️ There was an issue publishing your scheduled post.\n\n`;
              if (successPlatforms.length > 0) notifyMsg += `✅ Succeeded: ${successPlatforms.join(', ')}\n`;
              if (failedPlatforms.length > 0) notifyMsg += `❌ Failed: ${failedPlatforms.join(', ')}\n`;
            }
            notifyMsg += `📝 Content: "${post.content}"`;

            // Using no parse_mode (plain text) to avoid crashes with user-provided characters like *, _, [, ]
            await bot.telegram.sendMessage(post.user.telegramId, notifyMsg);
          } catch (botErr) {
            console.error(`[Scheduler] Failed to notify user ${post.user.telegramId}:`, botErr);
          }
        }
      }
    } catch (error) {
      console.error('[Scheduler] Critical error during execution:', error);
    }
  });
}
