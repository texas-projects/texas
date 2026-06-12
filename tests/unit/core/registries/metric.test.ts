// tests/unit/core/registries/metric.test.ts
import { describe, it, expect, beforeEach } from 'vitest'

import { MetricRegistry } from '@/core/monitoring/registry.js'

describe('MetricRegistry', () => {
  let registry: MetricRegistry

  beforeEach(() => {
    registry = new MetricRegistry()
  })

  it('创建 counter 并注册到内部 registry', () => {
    const counter = registry.counter('test_total', '测试计数器')
    expect(counter).toBeDefined()
    counter.inc()
  })

  it('创建 gauge 并操作', () => {
    const gauge = registry.gauge('test_gauge', '测试 gauge')
    gauge.set(42)
  })

  it('创建 histogram 并观测', () => {
    const hist = registry.histogram('test_duration', '测试耗时', { buckets: [0.1, 0.5, 1] })
    hist.observe(0.3)
  })

  it('collect 返回 Prometheus 格式文本', async () => {
    registry.counter('req_total', '请求总数')
    const output = await registry.collect()
    expect(output).toContain('req_total')
  })

  it('创建带 labels 的 counter', () => {
    const counter = registry.counter('events', '事件', ['type'])
    counter.inc({ type: 'message' })
  })
})
