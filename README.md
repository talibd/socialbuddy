# SocialBuddy - AI Social Media Manager 🤖

SocialBuddy is an AI-powered Telegram Bot that acts as your personal social media manager. You can talk to it naturally, send it images or videos, and ask it to schedule posts to your connected social accounts (X/Twitter, LinkedIn, Facebook, Instagram).

It is built with **Node.js, TypeScript, Telegraf (Telegram Bot API), Prisma (PostgreSQL), and Google Gemini (AI Tool Calling)**.

## Features

- **Natural Language Scheduling:** "Schedule a tweet for tomorrow at 2 PM saying 'Hello World' to @my_twitter"
- **Media Support:** Drag and drop images or videos into Telegram with a caption to schedule them.
- **AI Analytics & Reporting:** Ask "How many posts are pending?" or "Give me a report on @my_twitter".
- **Multi-Account Support:** Connect multiple accounts across different platforms.
- **Robust Storage:** Direct integration with MinIO (S3 compatible) for reliable media storage.
- **Automated Background Scheduler:** A reliable `node-cron` worker checks the database every minute and publishes posts when their time arrives.

## Tech Stack

- **Bot Framework:** [Telegraf](https://telegraf.js.org/)
- **AI Engine:** [Google Gemini 1.5 Flash](https://aistudio.google.com/) (using Function/Tool Calling)
- **Database:** PostgreSQL via [Prisma ORM](https://www.prisma.io/)
- **Media Storage:** [MinIO](https://min.io/) / AWS S3
- **OAuth Server:** Express.js

---

## 🚀 Local Setup Guide

Follow these steps to get SocialBuddy running on your local machine.

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [PostgreSQL](https://www.postgresql.org/) (Running locally or via Docker/Supabase/Neon)
- A Telegram Account

### 2. Get Your API Keys

**Telegram Bot Token:**
1. Open Telegram and search for `@BotFather`.
2. Send the command `/newbot`.
3. Follow the prompts to name your bot and give it a username.
4. Copy the **HTTP API Token** provided.

**Google Gemini API Key:**
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click "Get API key" and create a new key.

### 3. Environment Configuration
Create a `.env` file in the root of the project by copying the example:

```bash
cp .env.example .env
```

Update the `.env` file with your credentials:
```env
# Telegram & AI
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
GEMINI_API_KEY="your_gemini_api_key"

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/socialbuddy?schema=public"

# Storage (MinIO)
# If testing locally without MinIO, you can comment these out and modify the storage.ts file, 
# or run a quick MinIO docker container.
MINIO_ENDPOINT="http://localhost:9000"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET_NAME="socialbuddy"

# OAuth Server (Used for generating the /connect links)
BASE_URL="http://localhost:3000"
PORT="3000"
```

### 4. Database Setup
Initialize your PostgreSQL database with the Prisma schema:

```bash
# Install dependencies
npm install

# Push the schema to your database (creates the tables)
npx prisma db push

# Generate the Prisma Client
npx prisma generate
```

### 5. Start the Application
You are ready to run the bot!

```bash
# Starts both the Telegram Bot and the Express OAuth Server
npm run dev
```

You should see the following in your terminal:
```
🌐 OAuth Server running on http://localhost:3000
🤖 SocialBuddy Bot is running with Gemini Brain!
⏰ Background Scheduler started. Checking for posts every minute...
```

---

## 🧪 How to Test It

1. **Start the Bot:** Open Telegram, find your bot, and click **Start** (or type `/start`).
2. **Connect a Mock Account:** Type `/connect`, click "X (Twitter)", and follow the mock OAuth flow in your browser.
3. **Verify Connection:** Go back to Telegram and type `/accounts`. You should see a dynamically generated handle (e.g., `@my_twitter_user_42`).
4. **Schedule a Post:** Type: *"Schedule a post for 2 minutes from now to @my_twitter_user_42 saying 'This is a test run!'"*
5. **Watch the Scheduler:** Look at your terminal. Within 2 minutes, the `[Scheduler]` will wake up, process the pending post, and ping you on Telegram saying it was successfully published!

---

## 🚢 Deployment (Coolify)

This project is optimized for deployment on [Coolify](https://coolify.io/).

1. **Push to GitHub/GitLab:** Commit this code to your repository.
2. **Create a Project in Coolify:**
   - Add a new **PostgreSQL** Database resource.
   - Add a new **MinIO** Database resource (Create a public bucket named `socialbuddy`).
   - Add a new **Application** (Nixpacks or Dockerfile).
3. **Environment Variables:** Copy all variables from your `.env` into the Coolify Environment Variables tab for your Application.
   - *Crucial:* Change `BASE_URL` to your actual public domain (e.g., `https://bot.yourdomain.com`).
4. **Deploy!** Coolify will automatically detect the `Dockerfile`, build the Node.js app, run `prisma generate`, and start the bot.

## 🛠️ Next Steps for Production
Before launching to real users, you need to implement the actual OAuth 2.0 flows in `src/server.ts`. Replace the mock login redirects and token generation with real API calls to the Twitter/LinkedIn/Facebook Developer APIs.