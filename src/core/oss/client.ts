/** OSS 客户端工厂 —— 创建 MinIO/S3 兼容客户端实例。 */

import { Client } from 'minio'

/** OSS 连接配置。 */
export interface OssConfig {
  readonly endpointUrl: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly region: string
}

/** OSS bucket 名称配置。 */
export interface OssBuckets {
  readonly archive: string
  readonly media: string
  readonly render: string
}

/** OSS 客户端与 bucket 配置的聚合对象（通过 'oss' 键注入到服务注册表）。 */
export interface OssBundle {
  readonly client: Client
  readonly buckets: OssBuckets
}

/**
 * 解析 endpointUrl 并创建 MinIO Client 实例。
 * @param config OSS 连接配置
 */
export function createOssClient(config: OssConfig): Client {
  const url = new URL(config.endpointUrl || 'http://localhost:9000')
  const useSSL = url.protocol === 'https:'
  const port = url.port ? Number(url.port) : useSSL ? 443 : 9000

  return new Client({
    endPoint: url.hostname,
    port,
    useSSL,
    accessKey: config.accessKeyId,
    secretKey: config.secretAccessKey,
    region: config.region,
  })
}
