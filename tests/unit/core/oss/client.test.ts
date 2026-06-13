import { Client } from 'minio'
import { describe, it, expect } from 'vitest'

import { createOssClient } from '@/core/oss/client.js'

/** MinIO Client 的内部属性（用于测试验证连接参数解析结果）。 */
interface ClientInternals {
  host: string
  port: number
  protocol: string
}

describe('createOssClient', () => {
  it('应从 HTTPS URL 解析连接参数', () => {
    const client = createOssClient({
      endpointUrl: 'https://s3.example.com:443',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    })
    expect(client).toBeInstanceOf(Client)
    // 验证 MinIO Client 内部解析结果
    const c = client as unknown as ClientInternals
    expect(c.host).toBe('s3.example.com')
    expect(c.port).toBe(443)
    expect(c.protocol).toBe('https:')
  })

  it('应从 HTTP URL 解析连接参数', () => {
    const client = createOssClient({
      endpointUrl: 'http://localhost:9000',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      region: 'us-east-1',
    })
    expect(client).toBeInstanceOf(Client)
    // 验证 MinIO Client 内部解析结果
    const c = client as unknown as ClientInternals
    expect(c.host).toBe('localhost')
    expect(c.port).toBe(9000)
    expect(c.protocol).toBe('http:')
  })

  it('空 endpointUrl 应回退到 localhost:9000', () => {
    const client = createOssClient({
      endpointUrl: '',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    })
    expect(client).toBeInstanceOf(Client)
    // 验证回退默认值
    const c = client as unknown as ClientInternals
    expect(c.host).toBe('localhost')
    expect(c.port).toBe(9000)
  })
})
