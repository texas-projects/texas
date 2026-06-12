/**
 * 运行时服务注册表 —— 启动后冻结为只读。
 */

/**
 * 运行时服务注册表。启动完成后冻结为只读，按名称获取服务实例。
 */
export class ServiceRegistry {
  private readonly _store = new Map<string, unknown>()
  private _frozen = false

  /** 注册服务实例。冻结后调用抛出 Error。 */
  register(name: string, instance: unknown): void {
    if (this._frozen) {
      throw new Error(`ServiceRegistry 已冻结，禁止在运行期注册服务（name=${name}）`)
    }
    this._store.set(name, instance)
  }

  /** 冻结注册表，禁止后续注册。由生命周期编排器在所有服务启动完成后调用。 */
  freeze(): void {
    this._frozen = true
  }

  /** 按名称获取服务实例，不存在时返回 undefined。 */
  get(name: string): unknown {
    return this._store.get(name)
  }

  /**
   * 按名称获取服务实例并强制转换为指定类型。
   * key 不存在时抛出 Error。
   *
   * 用法：`registry.getTyped(MyService, 'myService')`
   */
  getTyped<T>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _ctor: abstract new (...args: any[]) => T,
    name: string,
  ): T {
    const value = this._store.get(name)
    if (value === undefined) {
      throw new Error(`ServiceRegistry 中不存在服务：${name}`)
    }
    return value as T
  }

  /** 检查服务是否已注册。 */
  has(name: string): boolean {
    return this._store.has(name)
  }

  /** 已注册服务数量。 */
  get size(): number {
    return this._store.size
  }

  /** 是否已冻结。 */
  get frozen(): boolean {
    return this._frozen
  }
}
