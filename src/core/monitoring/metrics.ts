/**
 * Prometheus 指标定义 —— 通过 MetricRegistry 自注册模式统一管理。
 *
 * 指标按领域拆分：
 *  - 通用基础设施指标（WS、事件、API、HTTP）定义于本文件
 *  - 人员管理指标已迁移至 @/core/personnel/metrics.js
 */

import { metricRegistry } from './registry.js'

/**
 * 兼容 prom-client Registry 接口的薄包装，供 main.ts 的 /metrics 端点使用。
 * 委托给 MetricRegistry 内部的 Registry 实例。
 */
export const metricsRegistry = {
  metrics: () => metricRegistry.collect(),
  get contentType(): string {
    return metricRegistry.registry.contentType
  },
}

// ── WebSocket 指标 ──

export const wsConnected = metricRegistry.gauge(
  'aemeath_ws_connected',
  'Number of active NapCat WS connections',
)

export const wsMessagesReceived = metricRegistry.counter(
  'aemeath_ws_messages_received_total',
  'WS messages received from NapCat',
  ['post_type'],
)

export const wsMessagesSent = metricRegistry.counter(
  'aemeath_ws_messages_sent_total',
  'WS messages sent to NapCat',
)

// ── 事件处理指标 ──

export const eventProcessed = metricRegistry.counter(
  'aemeath_event_processed_total',
  'Events processed',
  ['event_type', 'handler'],
)

export const eventProcessingSeconds = metricRegistry.histogram(
  'aemeath_event_processing_seconds',
  'Event processing duration in seconds',
)

export const eventErrors = metricRegistry.counter(
  'aemeath_event_errors_total',
  'Event processing errors',
)

// ── API 调用指标 ──

export const apiCalls = metricRegistry.counter('aemeath_api_calls_total', 'OneBot API calls', [
  'action',
])

export const apiCallDuration = metricRegistry.histogram(
  'aemeath_api_call_duration_seconds',
  'OneBot API call duration',
)

export const apiCallErrors = metricRegistry.counter(
  'aemeath_api_call_errors_total',
  'OneBot API call failures',
)

// ── 处理器指标 ──

export const handlersRegistered = metricRegistry.gauge(
  'aemeath_handlers_registered',
  'Number of registered handler methods',
)

// ── 系统指标 ──

export const uptimeSeconds = metricRegistry.gauge(
  'aemeath_uptime_seconds',
  'Process uptime in seconds',
)

// ── HTTP 请求指标 ──

export const httpRequestsTotal = metricRegistry.counter(
  'aemeath_http_requests_total',
  'Total HTTP requests',
  ['method', 'route', 'status_code'],
)

export const httpRequestDuration = metricRegistry.histogram(
  'aemeath_http_request_duration_seconds',
  'HTTP request duration',
  {
    labelNames: ['method', 'route'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  },
)
