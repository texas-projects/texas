/** Redis cache key 注册表。 */

export interface CacheKeyDefinition {
  readonly namespace: string
  readonly name: string
  readonly build: (...args: string[]) => string
  readonly ttl?: number
  readonly description?: string
}

export class CacheKeyRegistry {
  private readonly _entries = new Map<string, CacheKeyDefinition>()

  private _key(namespace: string, name: string): string {
    return `${namespace}:${name}`
  }

  register(definition: CacheKeyDefinition): void {
    const key = this._key(definition.namespace, definition.name)
    if (this._entries.has(key)) {
      throw new Error(`CacheKey "${key}" 已注册`)
    }
    this._entries.set(key, definition)
  }

  get(namespace: string, name: string): CacheKeyDefinition | undefined {
    return this._entries.get(this._key(namespace, name))
  }

  buildKey(namespace: string, name: string, ...args: string[]): string {
    const def = this.get(namespace, name)
    if (!def) throw new Error(`CacheKey "${namespace}:${name}" 未注册`)
    return def.build(...args)
  }

  getAll(): readonly CacheKeyDefinition[] {
    return [...this._entries.values()]
  }
}

export const cacheKeyRegistry = new CacheKeyRegistry()

// 框架级 key 注册（原 core-cache-keys.ts）
cacheKeyRegistry.register({
  namespace: 'perm',
  name: 'group',
  build: (groupId, featureName) => `aemeath:perm:group:${groupId}:${featureName}`,
})

cacheKeyRegistry.register({
  namespace: 'perm',
  name: 'private',
  build: (featureName, userId) => `aemeath:perm:private:${featureName}:${userId}`,
})

cacheKeyRegistry.register({
  namespace: 'perm',
  name: 'group_enabled',
  build: (groupId) => `aemeath:perm:group_enabled:${groupId}`,
})

cacheKeyRegistry.register({
  namespace: 'session',
  name: 'meta',
  build: (sessionKey) => `aemeath:session:${sessionKey}`,
})

cacheKeyRegistry.register({
  namespace: 'session',
  name: 'data',
  build: (sessionKey) => `aemeath:session:${sessionKey}:data`,
})
