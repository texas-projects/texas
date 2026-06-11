<script setup lang="ts">
/**
 * BotConfigPanel —— Bot 配置面板，按 owner 分组展示所有 config 类配置项。
 */
import { ref, computed, watch, onMounted } from 'vue'
import GroupAutocomplete from '@/components/GroupAutocomplete.vue'
import UserAutocomplete from '@/components/UserAutocomplete.vue'
import SettingField from '@/components/settings/SettingField.vue'
import { useSettingsSchemaStore } from '@/stores/settingsSchema'
import { useSettingsEditor } from '@/composables/useSettingsEditor'

const schemaStore = useSettingsSchemaStore()

// ── 作用域状态 ──

type ScopeType = 'group' | 'user'
const scopeType = ref<ScopeType>('group')
const selectedGroup = ref<number | null>(null)
const selectedUser = ref<number | null>(null)

/** 响应式 scope 对象，传给 useSettingsEditor。 */
const scope = computed(() => ({
  group: scopeType.value === 'group' ? selectedGroup.value : null,
  user: scopeType.value === 'user' ? selectedUser.value : null,
}))

// ── 设置编辑器 ──

const { values, loading, error, save, reset } = useSettingsEditor({
  prefix: '',
  scope,
  category: 'config',
})

// ── 左侧导航 ──

const selectedOwner = ref<string>('')

// schema 加载完成后设置默认选中第一个有 config 项的 owner
watch(
  () => schemaStore.owners,
  (owners) => {
    if (!selectedOwner.value) {
      const first = owners.find((o) =>
        (schemaStore.byOwner[o] ?? []).some((s) => s.category === 'config'),
      )
      if (first) selectedOwner.value = first
    }
  },
  { immediate: true },
)

/** 当前选中 owner 的配置项，仅展示 config 类。 */
const currentSchemas = computed(() =>
  (schemaStore.byOwner[selectedOwner.value] ?? []).filter((s) => s.category === 'config'),
)

/** 拥有 config 项的 owner 列表。 */
const configOwners = computed(() =>
  schemaStore.owners.filter((o) =>
    (schemaStore.byOwner[o] ?? []).some((s) => s.category === 'config'),
  ),
)

/** 是否已选择目标（group 或 user）。 */
const hasTarget = computed(() =>
  scopeType.value === 'group' ? selectedGroup.value !== null : selectedUser.value !== null,
)

onMounted(() => schemaStore.ensureLoaded())
</script>

<template>
  <div>
    <!-- 作用域选择器 -->
    <v-card rounded="lg" class="mb-4">
      <v-card-text class="pa-4">
        <div class="d-flex align-center gap-4 flex-wrap">
          <v-radio-group v-model="scopeType" inline hide-details density="compact" class="mr-2">
            <v-radio label="群聊" value="group" />
            <v-radio label="用户" value="user" />
          </v-radio-group>
          <div style="width: 300px">
            <GroupAutocomplete
              v-if="scopeType === 'group'"
              v-model="selectedGroup"
              label="选择群聊"
            />
            <UserAutocomplete v-else v-model="selectedUser" label="选择用户" />
          </div>
        </div>
        <v-alert v-if="error" type="error" density="compact" class="mt-3">{{ error }}</v-alert>
      </v-card-text>
    </v-card>

    <!-- 未选择目标时提示 -->
    <v-alert v-if="!hasTarget" type="info" variant="tonal" class="mb-4">
      请先选择{{ scopeType === 'group' ? '群聊' : '用户' }}，然后编辑配置
    </v-alert>

    <!-- 左右分栏 -->
    <div v-else class="d-flex gap-4">
      <!-- 左侧：owner 导航 -->
      <v-card rounded="lg" style="width: 180px; flex-shrink: 0">
        <v-list density="compact" nav>
          <v-list-item
            v-for="owner in configOwners"
            :key="owner"
            :value="owner"
            :active="selectedOwner === owner"
            active-color="primary"
            rounded="lg"
            @click="selectedOwner = owner"
          >
            <v-list-item-title>
              {{ schemaStore.ownerDisplayNames[owner] ?? owner }}
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card>

      <!-- 右侧：配置表单 -->
      <div class="flex-grow-1">
        <v-card rounded="lg">
          <v-card-title class="pa-4 pb-2 text-body-1 font-weight-bold">
            {{ schemaStore.ownerDisplayNames[selectedOwner] ?? selectedOwner }}
          </v-card-title>
          <v-divider />
          <v-card-text class="pa-4">
            <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />
            <div v-if="currentSchemas.length === 0" class="text-body-2 text-medium-emphasis">
              该模块暂无可配置项
            </div>
            <div
              v-for="schema in currentSchemas"
              :key="schema.key"
              class="d-flex align-center py-2"
              style="border-bottom: 1px solid rgba(0, 0, 0, 0.06)"
            >
              <div class="flex-grow-1 mr-4">
                <div class="text-body-2 font-weight-medium">
                  {{ schema.description || schema.key }}
                </div>
                <div class="text-caption text-medium-emphasis">{{ schema.key }}</div>
              </div>
              <SettingField
                :schema="schema"
                :value="values[schema.key]?.value ?? schema.default"
                :overridden="values[schema.key]?.overridden ?? false"
                :disabled="!hasTarget"
                @update:value="(v) => save(schema.key, v)"
                @reset="reset(schema.key)"
              />
            </div>
          </v-card-text>
        </v-card>
      </div>
    </div>
  </div>
</template>
