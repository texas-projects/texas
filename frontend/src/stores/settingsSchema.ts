/**
 * Settings Schema Store —— 缓存全局配置项 Schema，应用生命周期内只请求一次。
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchSchemas } from '@/apis/settings'
import type { SettingNodeSchema } from '@/apis/settings'

export const useSettingsSchemaStore = defineStore('settingsSchema', () => {
  const schemas = ref<SettingNodeSchema[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  /** 按 owner 分组的 Schema 列表。 */
  const byOwner = computed(() => {
    const map: Record<string, SettingNodeSchema[]> = {}
    for (const s of schemas.value) {
      ;(map[s.owner] ??= []).push(s)
    }
    return map
  })

  /** 仅 category === 'permission' 的 Schema。 */
  const permissionSchemas = computed(() => schemas.value.filter((s) => s.category === 'permission'))

  /** 仅 category === 'config' 的 Schema。 */
  const configSchemas = computed(() => schemas.value.filter((s) => s.category === 'config'))

  /** owner → ownerDisplayName 映射。 */
  const ownerDisplayNames = computed(() => {
    const map: Record<string, string> = {}
    for (const s of schemas.value) {
      if (!map[s.owner]) map[s.owner] = s.ownerDisplayName
    }
    return map
  })

  /** 所有 owner 列表（有序，按出现顺序）。 */
  const owners = computed(() => Object.keys(byOwner.value))

  /** 确保 Schema 已加载，重复调用幂等。 */
  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    loading.value = true
    try {
      schemas.value = await fetchSchemas()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  return {
    schemas,
    loading,
    loaded,
    byOwner,
    permissionSchemas,
    configSchemas,
    ownerDisplayNames,
    owners,
    ensureLoaded,
  }
})
