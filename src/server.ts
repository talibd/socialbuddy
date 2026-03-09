import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import crypto from 'crypto';
import axios from 'axios';
import { startScheduler } from './scheduler.js';
import { pathToFileURL } from 'url';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const app = express();

app.use(cors());
app.use(express.json());

// In a real application, you would use passport.js or direct API calls 
// with the specific social media provider's SDK (like twitter-api-v2).
// For this MVP, we will simulate the OAuth redirect flow so you can see the architecture.

app.get('/', (req, res) => {
  res.send('SocialBuddy OAuth Server is running!');
});

app.get('/privacy', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Privacy Policy - SocialBuddy</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px;">
        <h1>Privacy Policy</h1>
        <p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>
        <p>SocialBuddy ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how your personal information is collected, used, and disclosed by SocialBuddy.</p>
        
        <h2>1. Information We Collect</h2>
        <p>We collect information you provide directly to us when you use our service, such as when you connect your social media accounts (e.g., Facebook, Instagram, Telegram). This includes authentication tokens and basic profile information.</p>
        
        <h2>2. How We Use Your Information</h2>
        <p>We use the information we collect to operate, maintain, and provide the features and functionality of the service. We only request the permissions strictly necessary to post content on your behalf via our Telegram bot.</p>
        
        <h2>3. Data Deletion</h2>
        <p>If you wish to delete your data or disconnect your social accounts, you can do so through the SocialBuddy Telegram bot or by contacting support. Once disconnected, we remove your access tokens from our system.</p>
        
        <h2>4. Contact Us</h2>
        <p>If you have any questions about this Privacy Policy, please contact the developer.</p>
      </body>
    </html>
  `);
});

app.get('/terms', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Terms of Service - SocialBuddy</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px;">
        <h1>Terms of Service</h1>
        <p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>
        <p>Please read these terms of service carefully before using SocialBuddy.</p>
        
        <h2>1. Conditions of Use</h2>
        <p>By using this service, you certify that you have read and reviewed this Agreement and that you agree to comply with its terms. If you do not want to be bound by the terms of this Agreement, you are advised to stop using the service accordingly.</p>
        
        <h2>2. Service Usage</h2>
        <p>SocialBuddy provides a service to automate and manage social media posts. You agree to use this service in compliance with the rules and policies of the respective social media platforms (e.g., Meta, Telegram).</p>
      </body>
    </html>
  `);
});

// Mock "Do you want to authorize this app?" screen
app.get('/auth/mock-provider-login', (req, res) => {
  const { platform, userId, state } = req.query;
  
  const callbackUrl = `${req.protocol}://${req.get('host')}/auth/callback?platform=${platform}&userId=${userId}&state=${state}&code=mock_authorization_code_12345`;

  res.send(`
    <html>
      <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h1>Sign in to ${platform}</h1>
        <p>SocialBuddy wants to access your account.</p>
        <div style="margin-top: 20px;">
          <a href="${callbackUrl}" style="background-color: #1da1f2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            Authorize App
          </a>
          <a href="#" style="margin-left: 10px; color: gray; text-decoration: none;">Cancel</a>
        </div>
      </body>
    </html>
  `);
});

// Step 2: The social platform redirects the user back here with a secure 'code'
app.get('/auth/callback', async (req, res) => {
  const { code, error, state } = req.query;

  console.log('[OAuth Callback] Hit! query:', req.query);

  if (error) {
    console.error('[OAuth Callback] Authentication cancelled or failed:', error);
    return res.status(400).send('Authentication was cancelled or failed.');
  }

  if (!code) {
    console.error('[OAuth Callback] Missing authorization code.');
    return res.status(400).send('Missing authorization code.');
  }

  try {
    let platform = "unknown";
    let telegramUserId = "unknown";
    
    // Parse our state parameter to get userId and platform.
    if (typeof state === 'string') {
       const parts = state.split('_');
       if (parts.length >= 3) {
         telegramUserId = parts[1];
         platform = parts[2];
       }
    }

    if (platform === 'instagram' || platform === 'facebook') {
      const facebookAppId = process.env.FACEBOOK_APP_ID;
      const facebookAppSecret = process.env.FACEBOOK_APP_SECRET;
      const redirectUri = `${process.env.BASE_URL}/auth/callback`;

      if (!facebookAppId || !facebookAppSecret) {
         throw new Error("Missing Facebook developer keys in environment.");
      }

      // 1. Exchange 'code' for a short-lived access token
      const tokenResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
        params: {
          client_id: facebookAppId,
          redirect_uri: redirectUri,
          client_secret: facebookAppSecret,
          code: code
        }
      });
      
      const shortLivedToken = tokenResponse.data.access_token;

      // 2. Exchange short-lived token for long-lived token
      const longLivedTokenResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: facebookAppId,
          client_secret: facebookAppSecret,
          fb_exchange_token: shortLivedToken
        }
      });

      const longLivedToken = longLivedTokenResponse.data.access_token;

      // 3. Find the connected Facebook Pages
      const pagesResponse = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
        params: { access_token: longLivedToken }
      });

      const pages = pagesResponse.data.data;
      console.log(`[OAuth Callback] Found ${pages?.length || 0} pages`);
      
      if (!pages || pages.length === 0) {
        console.error('[OAuth Callback] No Facebook Pages found.');
        return res.status(400).send("No Facebook Pages found for this account. You need a Facebook Page.");
      }

      // 4. Save everything to Database
      const user = await prisma.user.findUnique({
        where: { telegramId: telegramUserId }
      });

      if (!user) {
        return res.status(404).send('User not found. Please send /start in Telegram first.');
      }

      if (platform === 'instagram') {
        // 4a. Find the Instagram Business Account linked to those pages
        let instagramAccountId = null;
        let instagramUsername = null;

        for (const page of pages) {
          try {
             const igResponse = await axios.get(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account`, {
               params: { access_token: longLivedToken }
             });
             
             if (igResponse.data.instagram_business_account) {
               instagramAccountId = igResponse.data.instagram_business_account.id;
               console.log(`[OAuth Callback] Found IG Account ID: ${instagramAccountId} on page ${page.id}`);
               
               // Get the exact handle
               const igUserResponse = await axios.get(`https://graph.facebook.com/v19.0/${instagramAccountId}?fields=username`, {
                  params: { access_token: longLivedToken }
               });
               instagramUsername = igUserResponse.data.username;
               console.log(`[OAuth Callback] Found IG Username: ${instagramUsername}`);
               break;
             }
          } catch (e: any) {
             console.error(`Error checking page ${page.id} for IG account:`, e?.response?.data || e.message);
          }
        }

        if (!instagramAccountId) {
           console.error('[OAuth Callback] Could not find an Instagram Professional/Business account linked to the pages.');
           return res.status(400).send("We couldn't find an Instagram Professional/Business account linked to your Facebook pages. Please ensure your IG account is changed to a Professional account and linked to a Facebook Page you admin.");
        }

        const exactHandle = `@${instagramUsername}`;

        await prisma.socialAccount.upsert({
          where: {
            userId_platform_handle: {
              userId: user.id,
              platform: 'instagram',
              handle: exactHandle
            }
          },
          update: {
            token: longLivedToken // Ideally encrypted!
          },
          create: {
            userId: user.id,
            platform: 'instagram',
            handle: exactHandle,
            token: longLivedToken
          }
        });

        return res.send(`
          <html>
            <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
              <h1 style="color: green;">✅ Success!</h1>
              <p>Your <b>Instagram</b> account (<b>${exactHandle}</b>) has been connected to SocialBuddy.</p>
              <p>You can close this window and return to Telegram.</p>
            </body>
          </html>
        `);
      } else if (platform === 'facebook') {
        // 4b. Save all Facebook Pages
        const savedPages = [];
        for (const page of pages) {
          const pageHandle = page.name;
          const pageToken = page.access_token; // Use the Page Access Token for posting
          
          await prisma.socialAccount.upsert({
            where: {
              userId_platform_handle: {
                userId: user.id,
                platform: 'facebook',
                handle: pageHandle
              }
            },
            update: {
              token: pageToken
            },
            create: {
              userId: user.id,
              platform: 'facebook',
              handle: pageHandle,
              token: pageToken
            }
          });
          savedPages.push(pageHandle);
        }

        return res.send(`
          <html>
            <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
              <h1 style="color: green;">✅ Success!</h1>
              <p>Your <b>Facebook Pages</b> (${savedPages.join(', ')}) have been connected to SocialBuddy.</p>
              <p>You can close this window and return to Telegram.</p>
            </body>
          </html>
        `);
      }
    } else {
       // --- MOCK FALLBACK for other platforms ---
       const mockPlatform = (req.query.platform as string) || "mock";
       const mockUserId = (req.query.userId as string) || telegramUserId;
       
       const mockAccessToken = `token_${crypto.randomUUID()}`;
       const mockAccountHandle = `@my_${mockPlatform}_user_${Math.floor(Math.random() * 100)}`;
       
       const user = await prisma.user.findUnique({
         where: { telegramId: mockUserId }
       });

       if (!user) return res.status(404).send('User not found.');

       await prisma.socialAccount.upsert({
         where: {
           userId_platform_handle: {
             userId: user.id,
             platform: mockPlatform,
             handle: mockAccountHandle
           }
         },
         update: { token: mockAccessToken },
         create: {
           userId: user.id,
           platform: mockPlatform,
           handle: mockAccountHandle,
           token: mockAccessToken
         }
       });

       return res.send(`
         <html>
           <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
             <h1 style="color: green;">✅ Mock Success!</h1>
             <p>Your <b>${mockPlatform}</b> account (<b>${mockAccountHandle}</b>) has been connected to SocialBuddy.</p>
             <p>You can close this window and return to Telegram.</p>
           </body>
         </html>
       `);
    }

  } catch (err: any) {
    console.error('OAuth Callback Error:', err?.response?.data || err.message || err);
    res.status(500).send('An internal error occurred while saving your connection. Please ensure your Facebook App Keys are set correctly.');
  }
});

// Step 1: The user clicks the link in Telegram and lands here
app.get('/auth/:platform', (req, res) => {
  const platform = req.params.platform;
  const userId = req.query.userId as string;

  if (!userId) {
    return res.status(400).send('Missing userId parameter.');
  }

  // Generate a random state string to prevent CSRF attacks
  const state = crypto.randomUUID();
  
  // Real apps save this state to the database or session to verify it later
  // For the mock, we will just redirect to a fake "Allow" screen
  
  const mockProviderLoginUrl = `${req.protocol}://${req.get('host')}/auth/mock-provider-login?platform=${platform}&userId=${userId}&state=${state}`;

  if (platform === 'instagram' || platform === 'facebook') {
    const facebookAppId = process.env.FACEBOOK_APP_ID;
    if (!facebookAppId) {
      return res.status(500).send('Server is missing FACEBOOK_APP_ID.');
    }
    const redirectUri = `${process.env.BASE_URL}/auth/callback`;
    
    // Different scopes depending on if we're doing IG or FB Pages
    const scopes = platform === 'instagram' 
      ? 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement'
      : 'pages_show_list,pages_read_engagement,pages_manage_posts';
    
    // Facebook OAuth Login URL
    const facebookAuthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${facebookAppId}&redirect_uri=${redirectUri}&state=${state}_${userId}_${platform}&scope=${scopes}`;
    return res.redirect(facebookAuthUrl);
  }

  // Instead, we redirect to our mock login page
  res.redirect(mockProviderLoginUrl);
});

export function startServer(
  port: number = parseInt(process.env.PORT || '3000'),
  options: { startBackgroundScheduler?: boolean } = {}
) {
  const { startBackgroundScheduler = true } = options;

  app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 OAuth Server running on http://localhost:${port}`);
    if (startBackgroundScheduler) {
      startScheduler();
      console.log('🗓️ Scheduler started in server-only mode (Telegram notifications disabled).');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
