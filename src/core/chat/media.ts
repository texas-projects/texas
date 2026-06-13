/** 聊天媒体持久化服务 —— 下载远程资源并存储到 S3，SHA-256 去重。 */

import { createHash } from 'node:crypto'

import { logger } from '@logger'
import type { Client } from 'minio'

import { Startup } from '../lifecycle/registry.js'
import type { OssBuckets } from '../oss/client.js'
import { uploadBuffer, objectExists } from '../oss/utils.js'

const log = logger.child({ module: 'media-storage' })

/** Content-Type 到文件扩展名映射。 */
const MIME_EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
}

/** 从 URL 路径推断扩展名。 */
function inferExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = pathname.split('.').pop()?.toLowerCase()
    if (ext && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext
    }
  } catch {
    // URL 解析失败，忽略
  }
  return 'png' // 默认 PNG
}

export class MediaStorageService {
  constructor(
    private readonly client: Client,
    private readonly bucket: string,
  ) {}

  /**
   * 下载远程资源并上传到 S3。相同内容自动去重。
   * @returns S3 key
   */
  async persist(url: string): Promise<string> {
    // 1. 下载
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`下载失败: ${url} (${String(response.status)})`)
    }
    const buf = Buffer.from(await response.arrayBuffer())

    // 2. 计算 SHA-256
    const hash = createHash('sha256').update(buf).digest('hex')

    // 3. 推断扩展名
    const contentType = response.headers.get('content-type') ?? ''
    const mimeType = contentType.split(';')[0]?.trim() ?? ''
    const ext = MIME_EXT_MAP[mimeType] ?? inferExtFromUrl(url)

    // 4. 构建 key
    const key = `${hash.slice(0, 2)}/${hash}.${ext}`

    // 5. 去重检查
    const exists = await objectExists(this.client, this.bucket, key)
    if (exists) {
      log.debug({ key }, '媒体已存在，跳过上传')
      return key
    }

    // 6. 上传
    await uploadBuffer(this.client, this.bucket, key, buf, {
      'Content-Type': contentType || `image/${ext}`,
    })
    log.debug({ key, size: buf.byteLength }, '媒体上传完成')

    return key
  }

  /**
   * 批量持久化，并发下载上传。
   * @returns url → s3Key 映射（下载失败的 url 不包含在结果中）
   */
  async persistMany(urls: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>()
    const tasks = urls.map(async (url) => {
      try {
        const key = await this.persist(url)
        results.set(url, key)
      } catch (err) {
        log.warn({ url, err }, '媒体持久化失败')
      }
    })
    await Promise.all(tasks)
    return results
  }

  /** 生成预签名读取 URL。 */
  async getPresignedUrl(key: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expirySeconds)
  }
}

// ─── 生命周期注册 ──────────────────────────────────────────

Startup({
  name: 'media_storage',
  provides: ['media_storage'],
  requires: ['oss'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const { client, buckets } = deps.oss as { client: Client; buckets: OssBuckets }
  const service = new MediaStorageService(client, buckets.media)
  log.info({ bucket: buckets.media }, 'MediaStorageService 就绪')
  return { media_storage: service }
})
