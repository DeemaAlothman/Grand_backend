import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  /** Server-to-server operations, reached via the Docker-internal hostname. */
  private readonly client: Client;
  /** Only used to sign presigned URLs, so the resulting link is reachable by an outside client. */
  private readonly presignClient: Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('storage.bucket')!;
    const useSSL = this.configService.get<boolean>('storage.useSSL');
    const accessKey = this.configService.get<string>('storage.accessKey');
    const secretKey = this.configService.get<string>('storage.secretKey');

    // region is pinned so the SDK never tries a live GetBucketLocation call before signing -
    // that call would go out on presignClient's (external-facing) host, which isn't reachable
    // from inside this container.
    this.client = new Client({
      endPoint: this.configService.get<string>('storage.endpoint')!,
      port: this.configService.get<number>('storage.port'),
      useSSL,
      accessKey,
      secretKey,
      region: 'us-east-1',
    });

    this.presignClient = new Client({
      endPoint: this.configService.get<string>('storage.publicEndpoint')!,
      port: this.configService.get<number>('storage.publicPort'),
      useSSL,
      accessKey,
      secretKey,
      region: 'us-east-1',
    });
  }

  async onModuleInit() {
    const exists = await this.client
      .bucketExists(this.bucket)
      .catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created storage bucket "${this.bucket}"`);
    }

    // Public-read so uploaded media (product images, etc.) can be served directly by URL.
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    };
    await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
  }

  presignedPutUrl(key: string, expirySeconds = 300): Promise<string> {
    return this.presignClient.presignedPutObject(
      this.bucket,
      key,
      expirySeconds,
    );
  }

  async statObject(key: string) {
    return this.client.statObject(this.bucket, key);
  }

  /** Direct server-side upload (e.g. archiving a source file) - never use this for anything an external client needs to write. */
  putObject(key: string, data: Buffer, contentType?: string): Promise<void> {
    return this.client
      .putObject(
        this.bucket,
        key,
        data,
        data.length,
        contentType ? { 'content-type': contentType } : undefined,
      )
      .then(() => undefined);
  }

  removeObject(key: string): Promise<void> {
    return this.client.removeObject(this.bucket, key);
  }

  publicUrl(key: string): string {
    const useSSL = this.configService.get<boolean>('storage.useSSL');
    const endpoint = this.configService.get<string>('storage.publicEndpoint');
    const port = this.configService.get<number>('storage.publicPort');
    const protocol = useSSL ? 'https' : 'http';
    return `${protocol}://${endpoint}:${port}/${this.bucket}/${key}`;
  }
}
