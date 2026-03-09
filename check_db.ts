import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const accounts = await prisma.socialAccount.findMany();
  console.log("--- CONNECTED ACCOUNTS IN DB ---");
  accounts.forEach(a => console.log(`[${a.platform}] ${a.handle}`));

  const posts = await prisma.post.findMany({ 
    orderBy: { createdAt: 'desc' }, 
    take: 5
  });
  console.log("\n--- RECENT POSTS ---");
  posts.forEach(p => console.log(`[${p.status}] Handles: ${p.platforms.join(', ')}`));
}

run().finally(() => prisma.$disconnect());