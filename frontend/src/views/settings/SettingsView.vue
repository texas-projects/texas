<script setup lang="ts">
/**
 * SettingsView —— 统一设置页面，Bot 配置 / 用户偏好 两个 Tab。
 */
import { ref } from 'vue'
import PageLayout from '@/layouts/PageLayout.vue'
import BotConfigPanel from './BotConfigPanel.vue'
import PreferencesPanel from './PreferencesPanel.vue'

const tab = ref<'bot' | 'preferences'>('bot')
</script>

<template>
  <PageLayout>
    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="bot">
        <v-icon start size="18">mdi-robot</v-icon>
        Bot 配置
      </v-tab>
      <v-tab value="preferences">
        <v-icon start size="18">mdi-tune</v-icon>
        用户偏好
      </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="bot">
        <BotConfigPanel />
      </v-tabs-window-item>
      <v-tabs-window-item value="preferences">
        <PreferencesPanel />
      </v-tabs-window-item>
    </v-tabs-window>
  </PageLayout>
</template>
