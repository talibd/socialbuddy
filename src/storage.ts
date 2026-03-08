import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
const minioAccessKey = process.env.MINIO_ACCESS_KEY || '';
const minioSecretKey = process.env.MINIO_SECRET_KEY || '';
const minioBucket = process.env.MINIO_BUCKET_NAME || 'socialbuddy';

const s3Client = new S3Client({
  endpoint: minioEndpoint,
  region: 'us-east-1', // MinIO requires a region, usually 'us-east-1' by default
  credentials: {
    accessKeyId: minioAccessKey,
    secretAccessKey: minioSecretKey,
  },
  forcePathStyle: true, // Essential for MinIO compatibility
});

export async function uploadBufferToMinio(buffer: Buffer, mimetype: string, originalExtension: string): Promise<string> {
  // Generate a random unique file name to prevent collisions
  const fileName = `${crypto.randomUUID()}${originalExtension}`;
  
  const command = new PutObjectCommand({
    Bucket: minioBucket,
    Key: fileName,
    Body: buffer,
    ContentType: mimetype,
    // Optional: Make it publicly readable if you are using public buckets
    // ACL: 'public-read',
  });

  await s3Client.send(command);

  // Construct and return the permanent public URL
  // If your MinIO bucket is private, you would return just the key and use presigned URLs later.
  // Assuming the bucket has a public policy for now, or you will proxy it.
  return `${minioEndpoint}/${minioBucket}/${fileName}`;
}
