import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import {
  StorageProvider,
  type FileMetadata,
  type UploadConfiguration,
  type StorageResult,
} from "bunsane/upload";

interface S3StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  region?: string;
}

export class S3StorageProvider extends StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(config: S3StorageConfig) {
    super("s3", config);
    this.bucket = config.bucket;
    this.publicUrl = config.publicUrl.replace(/\/$/, "");
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "us-east-1",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.client.send(
        new CreateBucketCommand({ Bucket: this.bucket }),
      );
      console.log(`[S3] Created bucket: ${this.bucket}`);
    } catch (err: any) {
      if (
        err.name === "BucketAlreadyOwnedByYou" ||
        err.name === "BucketAlreadyExists" ||
        err.Code === "BucketAlreadyOwnedByYou" ||
        err.Code === "BucketAlreadyExists"
      ) {
        console.log(`[S3] Bucket already exists: ${this.bucket}`);
      } else {
        throw err;
      }
    }
  }

  async store(
    file: File,
    metadata: FileMetadata,
    config: UploadConfiguration,
  ): Promise<StorageResult> {
    const path = this.buildPath(config.uploadPath, metadata.fileName);
    const buffer = Buffer.from(await file.arrayBuffer());

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: buffer,
        ContentType: metadata.mimeType,
        Metadata: {
          originalFileName: metadata.originalFileName,
          uploadId: metadata.uploadId,
        },
      }),
    );

    return {
      path,
      url: `${this.publicUrl}/${path}`,
    };
  }

  async delete(path: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: path }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(path: string): Promise<string> {
    return `${this.publicUrl}/${path}`;
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: path }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(path: string): Promise<FileMetadata | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: path }),
      );
      return {
        uploadId: head.Metadata?.uploadid ?? "",
        fileName: path.split("/").pop() ?? "",
        originalFileName: head.Metadata?.originalfilename ?? "",
        mimeType: head.ContentType ?? "application/octet-stream",
        size: head.ContentLength ?? 0,
        extension: (path.split(".").pop() ?? "").toLowerCase(),
        uploadedAt: head.LastModified?.toISOString() ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const result = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );
    return (result.Contents ?? []).map((obj) => obj.Key!).filter(Boolean);
  }

  async getStream(path: string): Promise<ReadableStream> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: path }),
    );
    return result.Body as unknown as ReadableStream;
  }

  async copy(
    sourcePath: string,
    destinationPath: string,
  ): Promise<boolean> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${sourcePath}`,
          Key: destinationPath,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async move(
    sourcePath: string,
    destinationPath: string,
  ): Promise<boolean> {
    const copied = await this.copy(sourcePath, destinationPath);
    if (!copied) return false;
    return this.delete(sourcePath);
  }

  async getStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    availableSpace?: number;
  }> {
    const result = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket }),
    );
    const contents = result.Contents ?? [];
    return {
      totalFiles: contents.length,
      totalSize: contents.reduce((sum, obj) => sum + (obj.Size ?? 0), 0),
    };
  }

  async cleanup(): Promise<void> {
    // No-op for S3
  }

  protected validateConfig(): boolean {
    const cfg = this.config as S3StorageConfig;
    return !!(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
  }
}
