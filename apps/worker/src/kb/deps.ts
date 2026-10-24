import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { LlmProvider } from '@autoapply/llm';
import type { Prisma, PrismaClient } from '@autoapply/db';

export interface BlobStore {
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

/** Everything the knowledge-base handlers need; plain object so tests can inject fakes. */
export interface KbDeps {
  db: PrismaClient;
  storage: BlobStore;
  llm: LlmProvider;
  models: { chat: string; vision: string };
  fetch?: typeof fetch;
  now?: () => Date;
}

export class S3BlobStore implements BlobStore {
  private readonly bucket = process.env.S3_BUCKET ?? 'autoapply';
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9010',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ROOT_USER ?? 'autoapply',
      secretAccessKey: process.env.MINIO_ROOT_PASSWORD ?? 'autoapply-secret',
    },
  });

  async get(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}

/** Constitution §VI: every pipeline step emits a RunEvent. */
export async function runEvent(db: PrismaClient, level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  await db.runEvent.create({ data: { queue: 'sync-profile', level, message, data: (data ?? undefined) as Prisma.InputJsonValue | undefined } });
}
