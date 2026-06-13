/** OSS 高频工具函数 —— 简化 MinIO SDK 的 Buffer/Stream 转换。 */

import type { Client } from 'minio'

/**
 * 上传 Buffer 到指定 bucket/key。
 * @param client MinIO 客户端实例
 * @param bucket bucket 名称
 * @param key 对象键
 * @param buf 要上传的 Buffer
 * @param metadata 可选的自定义元数据
 */
export async function uploadBuffer(
  client: Client,
  bucket: string,
  key: string,
  buf: Buffer,
  metadata?: Record<string, string>,
): Promise<void> {
  await client.putObject(bucket, key, buf, buf.byteLength, metadata)
}

/**
 * 下载对象内容为 Buffer。
 * @param client MinIO 客户端实例
 * @param bucket bucket 名称
 * @param key 对象键
 */
export async function downloadBuffer(client: Client, bucket: string, key: string): Promise<Buffer> {
  const stream = await client.getObject(bucket, key)
  const chunks: Buffer[] = []
  for await (const rawChunk of stream) {
    const chunk = rawChunk as Buffer | Uint8Array
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * 检查对象是否存在。
 * @param client MinIO 客户端实例
 * @param bucket bucket 名称
 * @param key 对象键
 */
export async function objectExists(client: Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.statObject(bucket, key)
    return true
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'NotFound' || code === 'NoSuchKey') return false
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404) return false
    throw err
  }
}

/**
 * 删除对象。
 * @param client MinIO 客户端实例
 * @param bucket bucket 名称
 * @param key 对象键
 */
export async function deleteObject(client: Client, bucket: string, key: string): Promise<void> {
  await client.removeObject(bucket, key)
}
