import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
  // The server talks to MinIO over the Docker-internal hostname above, but a presigned
  // URL is used by an external client (browser), so it must be signed for a host that
  // client can actually reach - hence a separate public endpoint/port.
  publicEndpoint:
    process.env.MINIO_PUBLIC_ENDPOINT ?? process.env.MINIO_ENDPOINT,
  publicPort: parseInt(
    process.env.MINIO_PUBLIC_PORT ?? process.env.MINIO_PORT ?? '9000',
    10,
  ),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
  bucket: process.env.MINIO_BUCKET,
}));
