# SocialBuddy Deployment Guide for Coolify

This guide explains how to deploy the SocialBuddy bot and its required services (PostgreSQL and MinIO) using [Coolify](https://coolify.io/).

## Prerequisites
- A running Coolify instance.
- A connected GitHub/GitLab repository or access to upload your code.
- A Telegram Bot Token (from BotFather).
- A Gemini API Key (from Google AI Studio).
- Facebook App ID & Secret (if using Instagram integration).

---

## Step 1: Set Up the Database (PostgreSQL)

SocialBuddy uses PostgreSQL to store user accounts, connections, and scheduled posts.

1. Go to your Coolify Dashboard.
2. Navigate to your **Project** and **Environment**.
3. Click **+ New Resource**.
4. Select **Database** -> **PostgreSQL**.
5. Give it a name (e.g., `socialbuddy-db`).
6. Click **Save** and then **Start**.
7. Once started, find the internal **Connection String** (Database URL). It will look something like: `postgresql://user:password@<internal-ip>:5432/<db_name>?schema=public`. Keep this handy.

---

## Step 2: Set Up Object Storage (MinIO)

SocialBuddy uses MinIO (S3-compatible storage) to store media attachments from Telegram before posting them.

1. In your Coolify Project/Environment, click **+ New Resource**.
2. Select **Service** (or App -> Docker Compose if you want to use the included `docker-compose.yml` just for MinIO).
   - *Alternatively, Coolify might have a 1-click template for MinIO.*
3. If using a 1-click template, fill in the details. 
4. Once MinIO is running, you need the following:
   - **Internal or External URL** (e.g., `http://<minio-ip>:9000`)
   - **Root User / Access Key** (default: `minioadmin`)
   - **Root Password / Secret Key** (default: `minioadmin`)
5. **Important:** Log into the MinIO Console (usually port `9001`) and create a bucket named `socialbuddy`. 

---

## Step 3: Deploy the SocialBuddy Application

Now we will deploy the Node.js application. 

> **CRITICAL:** Your deployment might fail if Coolify uses its default build system (Nixpacks) because it may choose an incompatible Node.js version. You **must** ensure the Build Pack is set to **Dockerfile**.

1. In your Coolify Project/Environment, click **+ New Resource**.
2. Select **Application**.
3. Choose your source (e.g., **GitHub** or **GitLab**).
4. Select your `socialbuddy` repository and the branch you want to deploy (e.g., `main`).
5. **CRITICAL:** Under **Configuration -> General**, find **Build Pack** and change it from `Nixpacks` to `Dockerfile`.
6. Set the **Port** to `3000`.
7. Go to the **Environment Variables** tab.

---

## Step 4: Configure Environment Variables

Add the following environment variables to your Application in Coolify. *Do not wrap values in quotes in Coolify unless required.*

| Variable | Description |
| :--- | :--- |
| `DATABASE_URL` | The Connection String from Step 1 (e.g., `postgresql://...`). **IMPORTANT:** Append `&sslmode=disable` (or `?sslmode=disable` if there is no existing `?` in the URL) to the end of your connection string. |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token from BotFather. |
| `GEMINI_API_KEY` | Your Google Gemini API key. |
| `MINIO_ENDPOINT` | The URL for your MinIO instance (e.g., `http://<minio-internal-ip>:9000`). |
| `MINIO_ACCESS_KEY` | MinIO access key (e.g., `minioadmin`). |
| `MINIO_SECRET_KEY` | MinIO secret key (e.g., `minioadmin`). |
| `MINIO_BUCKET_NAME` | `socialbuddy` |
| `PORT` | `3000` |
| `BASE_URL` | The public URL Coolify generates for your app (e.g., `https://socialbuddy.yourdomain.com`). Used for OAuth redirects. |
| `FACEBOOK_APP_ID` | (Optional) Your Facebook App ID for Instagram integration. |
| `FACEBOOK_APP_SECRET`| (Optional) Your Facebook App Secret. |

---

## Step 5: Start the Deployment

1. Once all Environment Variables are set, click the **Deploy** button.
2. Coolify will build the Docker image. 
   - It will install dev dependencies to compile TypeScript.
   - It will run `npx prisma generate` to build the database client.
3. When the container starts, it will automatically run `npx prisma db push` to create your database tables before starting the bot.
4. Check the **Logs** tab in Coolify to ensure you see:
   - `🤖 SocialBuddy Bot is running with Gemini Brain!`
   - `🌐 OAuth Server running on http://0.0.0.0:3000`

## Step 6: Verify the Setup

1. Open Telegram and send `/start` to your bot.
2. Try sending a message or a photo.
3. Test the OAuth connection by typing `/connect` and clicking the provided link (ensure it routes through your `BASE_URL`).

## Troubleshooting

- **Database Errors:** Check if the `DATABASE_URL` is correct and reachable from the app container. Ensure `npx prisma db push` ran successfully in the deployment logs.
- **Media Upload Fails:** Double-check the MinIO credentials and ensure the `socialbuddy` bucket exists. If using an internal IP for `MINIO_ENDPOINT`, ensure both containers are on the same Coolify network.
- **OAuth Redirects Fail:** Ensure your `BASE_URL` exactly matches the domain Coolify assigned to your application (without a trailing slash), and that this URL is registered in your Facebook/Twitter Developer Portals.
