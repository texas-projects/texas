/** 分布式锁接口预留。具体实现（SETNX / Redlock）后续补充。 */
export interface RedisLock {
  /** 获取锁，返回释放函数，获取失败返回 null。 */
  acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>
}
