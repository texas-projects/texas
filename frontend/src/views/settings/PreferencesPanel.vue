<template>
  <div>
    <!-- 外观设置 -->
    <v-card rounded="lg" class="mb-4">
      <v-card-title class="pa-4 pb-2 text-body-1 font-weight-bold">
        <v-icon start size="20">mdi-palette</v-icon>
        外观
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4">
        <div class="text-body-2 text-medium-emphasis mb-3">主题模式</div>
        <v-btn-toggle
          v-model="themeStore.preference"
          density="compact"
          variant="elevated"
          divided
          mandatory
          @update:model-value="onThemeChange"
        >
          <v-btn value="light" prepend-icon="mdi-white-balance-sunny" size="small">浅色</v-btn>
          <v-btn value="dark" prepend-icon="mdi-weather-night" size="small">深色</v-btn>
          <v-btn value="followOS" prepend-icon="mdi-monitor" size="small">跟随系统</v-btn>
        </v-btn-toggle>
      </v-card-text>
    </v-card>

    <!-- 队列监控设置 -->
    <v-card rounded="lg" class="mb-4">
      <v-card-title class="pa-4 pb-2 text-body-1 font-weight-bold">
        <v-icon start size="20">mdi-tray-full</v-icon>
        队列监控
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4">
        <div class="text-body-2 text-medium-emphasis mb-3">数据刷新间隔</div>
        <v-btn-toggle
          v-model="settingsStore.queueRefreshInterval"
          density="compact"
          variant="elevated"
          divided
          mandatory
        >
          <v-btn :value="5" size="small">5 秒</v-btn>
          <v-btn :value="10" size="small">10 秒</v-btn>
          <v-btn :value="30" size="small">30 秒</v-btn>
        </v-btn-toggle>
      </v-card-text>
    </v-card>

    <!-- 列表显示设置 -->
    <v-card rounded="lg" class="mb-4">
      <v-card-title class="pa-4 pb-2 text-body-1 font-weight-bold">
        <v-icon start size="20">mdi-format-list-bulleted</v-icon>
        列表显示
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4">
        <div class="text-body-2 text-medium-emphasis mb-3">每页默认条数</div>
        <v-btn-toggle
          v-model="settingsStore.defaultPageSize"
          density="compact"
          variant="elevated"
          divided
          mandatory
        >
          <v-btn :value="20" size="small">20 条</v-btn>
          <v-btn :value="50" size="small">50 条</v-btn>
          <v-btn :value="100" size="small">100 条</v-btn>
        </v-btn-toggle>
      </v-card-text>
    </v-card>

    <!-- 关于 -->
    <v-card rounded="lg">
      <v-card-title class="pa-4 pb-2 text-body-1 font-weight-bold">
        <v-icon start size="20">mdi-information-outline</v-icon>
        关于
      </v-card-title>
      <v-divider />
      <v-list density="compact" class="pa-2">
        <v-list-item>
          <v-list-item-title class="text-caption text-medium-emphasis">项目名称</v-list-item-title>
          <v-list-item-subtitle class="text-body-2 font-weight-medium mt-0.5">
            Aemeath QQ Bot Framework
          </v-list-item-subtitle>
        </v-list-item>
        <v-list-item>
          <v-list-item-title class="text-caption text-medium-emphasis">协议支持</v-list-item-title>
          <v-list-item-subtitle class="text-body-2 font-weight-medium mt-0.5">
            NapCat / OneBot 11
          </v-list-item-subtitle>
        </v-list-item>
        <v-list-item>
          <v-list-item-title class="text-caption text-medium-emphasis">技术栈</v-list-item-title>
          <v-list-item-subtitle class="text-body-2 font-weight-medium mt-0.5">
            Node.js + Fastify 5 + Vue 3 + Vuetify 4
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { useTheme } from 'vuetify'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'

const vuetifyTheme = useTheme()
const themeStore = useThemeStore()
const settingsStore = useSettingsStore()

function onThemeChange() {
  themeStore.setPreference(themeStore.preference, vuetifyTheme)
}
</script>
