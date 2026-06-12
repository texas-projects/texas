// src/core/monitoring/registry.ts
/** prom-client Registry 薄 wrapper，业务模块通过此注册表创建指标。 */
import { Registry, Counter, Gauge, Histogram } from 'prom-client'

export interface HistogramOpts {
  buckets?: number[]
  labelNames?: string[]
}

export class MetricRegistry {
  private readonly _registry = new Registry()

  counter(name: string, help: string, labelNames?: string[]): Counter {
    return new Counter({ name, help, labelNames: labelNames ?? [], registers: [this._registry] })
  }

  gauge(name: string, help: string, labelNames?: string[]): Gauge {
    return new Gauge({ name, help, labelNames: labelNames ?? [], registers: [this._registry] })
  }

  histogram(name: string, help: string, opts?: HistogramOpts): Histogram {
    return new Histogram({
      name,
      help,
      buckets: opts?.buckets,
      labelNames: opts?.labelNames ?? [],
      registers: [this._registry],
    })
  }

  async collect(): Promise<string> {
    return this._registry.metrics()
  }

  get registry(): Registry {
    return this._registry
  }
}

export const metricRegistry = new MetricRegistry()
