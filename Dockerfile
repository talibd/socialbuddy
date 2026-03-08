FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --include=dev

# Copy source code
COPY . .

# Generate Prisma Client & Build
RUN npx prisma generate
RUN npx tsc

# Make the start script executable
RUN chmod +x start.sh

# Start the bot
CMD ["./start.sh"]
