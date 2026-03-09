import { Telegraf, Markup } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';
import axios from 'axios';
import { uploadBufferToMinio } from './storage.js';
import { startScheduler } from './scheduler.js';
import { startServer } from './server.js';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Define the tool that the AI can call to schedule posts
const schedulePostDeclaration: FunctionDeclaration = {
  name: "schedule_post",
  description: "Schedules a social media post to specific connected accounts.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      content: {
        type: SchemaType.STRING,
        description: "The exact text content of the social media post.",
      },
      handles: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: "An array of handles to post to, starting with '@' (e.g., ['@my_twitter', '@company_linkedin']).",
      },
      scheduledAt: {
        type: SchemaType.STRING,
        description: "The ISO 8601 string representing the exact date and time to publish the post. Use 'now' if they want to post immediately.",
      },
      mediaUrls: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: "An array of media URLs attached to the post, if any. Look for [Attached Media: URL] in the prompt.",
      },
    },
    required: ["content", "handles", "scheduledAt"],
  },
};

const getPostingStatsDeclaration: FunctionDeclaration = {
  name: "get_posting_stats",
  description: "Gets statistics on how many posts have been scheduled, published, or failed.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      handle: {
        type: SchemaType.STRING,
        description: "Optional. An exact account handle starting with '@' to filter by.",
      },
    },
  },
};

const getRecentPostsDeclaration: FunctionDeclaration = {
  name: "get_recent_posts",
  description: "Gets the user's recent posts (including content, status, and time) so you can tell them specifically what is pending or published.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      status: {
        type: SchemaType.STRING,
        description: "Optional. Filter by status: 'pending', 'published', or 'failed'.",
      },
      limit: {
        type: SchemaType.NUMBER,
        description: "Optional. Number of posts to retrieve (default 5).",
      }
    },
  },
};

const getPostAnalyticsDeclaration: FunctionDeclaration = {
  name: "get_post_analytics",
  description: "Fetches engagement metrics (likes, comments, etc.) for a specific account.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      handle: {
        type: SchemaType.STRING,
        description: "An exact account handle starting with '@' to get analytics for.",
      },
    },
    required: ["handle"],
  },
};

bot.start(async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  
  if (telegramId) {
    await prisma.user.upsert({
      where: { telegramId },
      update: {},
      create: { telegramId },
    });
  }

  await ctx.reply(
    "👋 Welcome to SocialBuddy! I'm your AI Social Media Manager.\n\n" +
    "You can talk to me naturally. For example:\n" +
    "💬 \"Schedule a tweet for tomorrow at 2 PM saying 'Hello World' to @my_twitter\"\n" +
    "🖼️ You can also send me an image or video with a caption!\n\n" +
    "To connect your accounts, type /connect."
  );
});

bot.command('connect', (ctx) => {
  ctx.reply(
    "Which platform would you like to connect?",
    Markup.inlineKeyboard([
      [Markup.button.callback('X (Twitter)', 'connect_twitter')],
      [Markup.button.callback('LinkedIn', 'connect_linkedin')],
      [Markup.button.callback('Facebook', 'connect_facebook')],
      [Markup.button.callback('Instagram', 'connect_instagram')]
    ])
  );
});

bot.action(/connect_(.+)/, async (ctx) => {
  const platform = ctx.match[1];
  
  // Real implementation will need an Express server to handle the OAuth redirect callback
  // Use environment variable for the domain, fallback to localhost for testing
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const authUrl = `${baseUrl}/auth/${platform}?userId=${ctx.from?.id}`;
  
  await ctx.answerCbQuery();
  await ctx.reply(
    `To connect your <b>${platform}</b> account, please click the link below to authorize SocialBuddy:\n\n🔗 <a href="${authUrl}">Connect ${platform}</a>\n\nIf the link above doesn't work, copy and paste this URL into your browser:\n${authUrl}`, 
    { parse_mode: 'HTML' }
  );
});

bot.command('accounts', async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: { accounts: true }
  });

  if (!user || user.accounts.length === 0) {
    return ctx.reply("You haven't connected any accounts yet. Use /connect to start.");
  }

  const accountsList = user.accounts.map(acc => `${acc.platform}: ${acc.handle}`).join('\n');
  ctx.reply(`Your connected accounts:\n\n${accountsList}`);
});

// Store chat histories per user so the bot remembers context across messages
const userHistories = new Map<string, any[]>();

bot.on('message', async (ctx) => {
  let userMessage = "";
  let mediaUrl = "";

  const msg = ctx.message as any;

  // Extract text or caption
  if (msg.text) {
    userMessage = msg.text;
  } else if (msg.caption) {
    userMessage = msg.caption;
  }

  let tempMediaUrl = "";

  // Extract photo link if present
  if (msg.photo && msg.photo.length > 0) {
    const fileId = msg.photo[msg.photo.length - 1].file_id; // Get the highest resolution photo
    try {
      const link = await ctx.telegram.getFileLink(fileId);
      tempMediaUrl = link.toString();
    } catch (e) {
      console.error("Failed to get photo link", e);
    }
  }

  // Extract video link if present
  if (msg.video) {
    try {
      const link = await ctx.telegram.getFileLink(msg.video.file_id);
      tempMediaUrl = link.toString();
    } catch (e) {
      console.error("Failed to get video link", e);
    }
  }

  if (tempMediaUrl) {
    try {
      const response = await axios.get(tempMediaUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'application/octet-stream';
      
      let ext = '.bin';
      const urlLower = tempMediaUrl.toLowerCase();
      
      if (contentType.includes('jpeg') || contentType.includes('jpg') || urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) ext = '.jpg';
      else if (contentType.includes('png') || urlLower.endsWith('.png')) ext = '.png';
      else if (contentType.includes('mp4') || urlLower.endsWith('.mp4')) ext = '.mp4';
      else if (contentType.includes('gif') || urlLower.endsWith('.gif')) ext = '.gif';
      else if (msg.photo) ext = '.jpg'; // Telegram photos are always jpegs
      else if (msg.video) ext = '.mp4'; // Telegram videos are typically mp4
      
      mediaUrl = await uploadBufferToMinio(buffer, contentType === 'application/octet-stream' ? (ext === '.jpg' ? 'image/jpeg' : (ext === '.mp4' ? 'video/mp4' : contentType)) : contentType, ext);
    } catch (e) {
      console.error("Failed to upload to Minio", e);
      await ctx.reply("Sorry, I failed to store your media file.");
      return;
    }
  }

  // If there is no text or caption, and no media, ignore.
  if (!userMessage && !mediaUrl) return;

  const telegramId = ctx.from.id.toString();

  try {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: { accounts: true }
    });

    if (!user) {
      return ctx.reply("Please use /start to register first.");
    }

    const accountsList = user.accounts.length > 0 
      ? user.accounts.map(acc => `${acc.platform}: ${acc.handle}`).join(', ') 
      : 'No connected accounts yet. They must use /connect first.';

    // Initialize Gemini model with the Tool
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      tools: [{ functionDeclarations: [schedulePostDeclaration, getPostingStatsDeclaration, getRecentPostsDeclaration, getPostAnalyticsDeclaration] }],
      systemInstruction: `You are a social media manager bot. The user currently has these connected accounts: ${accountsList}.
If the user wants to post something, map their requested '@' mentions to the connected accounts. Use the 'schedule_post' tool when they are ready to post. 
CRITICAL TIMEZONE INSTRUCTION: The user is in Indian Standard Time (IST, UTC+5:30). Your current server time is ${new Date().toISOString()} (UTC). When the user asks to schedule a post at a specific time (e.g., "1:52 PM"), assume they mean IST. You MUST convert their requested IST time to the correct UTC ISO 8601 timestamp for the 'scheduledAt' parameter (e.g if they ask for 2 PM IST today, calculate the equivalent UTC time and output it).
If the user asks for reports or stats (like "how many posts"), use the 'get_posting_stats' tool.
If the user asks about specific posts (like "what is pending?" or "did it post?"), use the 'get_recent_posts' tool to find out, then summarize the results for them naturally.
If the user asks for likes or analytics, use the 'get_post_analytics' tool.
If the user attached an image or video, they will pass it as [Attached Media: URL]. Always include this exact URL in the mediaUrls parameter.`
    });

    const history = userHistories.get(telegramId) || [];
    const chat = model.startChat({ history });
    
    // Construct the prompt with the media link if available
    let prompt = userMessage || "Here is a media file I want to post.";
    if (mediaUrl) {
      prompt += `\n\n[Attached Media: ${mediaUrl}]`;
    }

    const result = await chat.sendMessage(prompt);
    let response = result.response;
    
    let functionCalls = response.functionCalls();
    
    // We need to keep feeding function responses back to the model 
    // until it actually produces text.
    while (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      let functionResponseData: any = null;
      
      if (call && call.name === 'schedule_post') {
        const { content, handles, scheduledAt, mediaUrls } = call.args as any;
        
        let scheduleDate: Date;
        if (scheduledAt === 'now') {
          scheduleDate = new Date();
        } else {
          // Force the model's output to be interpreted as IST if it isn't already explicit.
          // Important: ISO dates like 2026-03-09 contain '-' in the date itself, so we must
          // detect timezone only at the end of the string (Z or ±HH:MM), not by checking for '-'.
          let dateStr = String(scheduledAt).trim();
          const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateStr);
          if (dateStr && !hasExplicitTimezone) {
             dateStr += '+05:30';
          }
          scheduleDate = new Date(dateStr);
        }

        const now = new Date();

        // Validation: Check if the scheduled time is in the past (by more than 5 minutes to account for AI processing delays)
        // Also check if scheduleDate is Invalid
        if (isNaN(scheduleDate.getTime())) {
           functionResponseData = { error: "You provided an invalid date format. Please use ISO 8601." };
           await ctx.reply(`❌ I couldn't schedule the post. I misunderstood the date format. Please try again.`);
        } else if (scheduledAt !== 'now' && (now.getTime() - scheduleDate.getTime() > 5 * 60 * 1000)) {
           const formattedPastTime = scheduleDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
           functionResponseData = { error: `The time requested (${formattedPastTime} IST) has already passed.` };
           await ctx.reply(`❌ I couldn't schedule the post. The time you requested (${formattedPastTime} IST) has already passed. Please specify a future time.`);
        } else {
           // Find invalid handles before saving
           const invalidHandles = [];
           for (const handle of handles) {
              const cleanTargetHandle = handle.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
              const account = user.accounts.find(acc => 
                acc.handle.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanTargetHandle
              );
              if (!account) invalidHandles.push(handle);
           }

           if (invalidHandles.length > 0) {
              functionResponseData = { error: `The following accounts are not connected: ${invalidHandles.join(', ')}` };
              await ctx.reply(`❌ Cannot schedule post. You have not connected these accounts: ${invalidHandles.join(', ')}. Please use /accounts to see your exact connected handles.`);
           } else {
             // Save the post request to the database
             await prisma.post.create({
               data: {
                 userId: user.id,
                 content: content,
                 platforms: handles,
                 mediaUrls: mediaUrls || [],
                 scheduledAt: scheduleDate,
                 status: "pending"
               }
             });

             const timeString = scheduledAt === 'now' ? 'Immediately' : scheduleDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) + ' (IST)';
             functionResponseData = { success: true, scheduledTimeIST: timeString };
             
             let replyMsg = `✅ Got it! I have scheduled your post.\n\n📝 Content: "${content}"\n📲 Accounts: ${handles.join(', ')}\n⏰ Time: ${timeString}`;
             if (mediaUrls && mediaUrls.length > 0) replyMsg += `\n🖼️ Media: 1 file attached.`;
             await ctx.reply(replyMsg);
           }
        }
      } else if (call && call.name === 'get_posting_stats') {
        const { handle } = call.args as any;
        
        let whereClause: any = { userId: user.id };
        if (handle) {
          whereClause.platforms = { has: handle };
        }

        const pending = await prisma.post.count({ where: { ...whereClause, status: "pending" } });
        const published = await prisma.post.count({ where: { ...whereClause, status: "published" } });
        const failed = await prisma.post.count({ where: { ...whereClause, status: "failed" } });

        functionResponseData = { pending, published, failed, handle: handle || 'all' };

      } else if (call && call.name === 'get_recent_posts') {
        const { status, limit } = call.args as any;
        
        let whereClause: any = { userId: user.id };
        if (status) {
          whereClause.status = status;
        }

        const posts = await prisma.post.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          take: limit || 5
        });
        
        const postsData = posts.map(p => ({
           content: p.content,
           status: p.status,
           scheduledFor: p.scheduledAt?.toISOString(),
           accounts: p.platforms
        }));

        functionResponseData = { posts: postsData };

      } else if (call && call.name === 'get_post_analytics') {
        const { handle } = call.args as any;
        functionResponseData = { likes: Math.floor(Math.random() * 500) + 12, comments: Math.floor(Math.random() * 50) + 2, shares: Math.floor(Math.random() * 100) + 5, mock: true };
      }

      // Send the function response back to the model
      const secondResult = await chat.sendMessage([{
        functionResponse: {
          name: call.name,
          response: functionResponseData || { status: "ok" }
        }
      }]);
      response = secondResult.response;
      functionCalls = response.functionCalls();
    } // End of while loop

    // Save the finalized chat history
    userHistories.set(telegramId, await chat.getHistory());

    if (!response.functionCalls() || response.functionCalls()?.length === 0) {
      // Gemini just wants to reply with normal text
      const textResponse = response.text();
      if (textResponse) {
         await ctx.reply(textResponse);
      }
    }
  } catch (error) {
    console.error("Error processing message:", error);
    await ctx.reply("Sorry, I ran into an error processing that request.");
  }
});

startServer(undefined, { startBackgroundScheduler: false });

bot.launch().then(() => {
  console.log('🤖 SocialBuddy Bot is running with Gemini Brain!');
  startScheduler(bot);
}).catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
