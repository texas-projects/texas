/**
 * 人员管理领域 Prometheus 指标 —— 通过 MetricRegistry 自注册。
 */

import { metricRegistry } from '@/core/registries.js'

export const personnelSyncTotal = metricRegistry.counter(
  'aemeath_personnel_sync_total',
  'Personnel sync task executions',
  ['status'],
)

export const personnelSyncDuration = metricRegistry.histogram(
  'aemeath_personnel_sync_duration_seconds',
  'Personnel sync task duration (from data collection to DB write)',
)

export const personnelUsersTotal = metricRegistry.gauge(
  'aemeath_personnel_users_total',
  'Total known users in the users table',
)

export const personnelFriendsTotal = metricRegistry.gauge(
  'aemeath_personnel_friends_total',
  'Total friends (relation=friend)',
)

export const personnelGroupsTotal = metricRegistry.gauge(
  'aemeath_personnel_groups_total',
  'Total active groups (is_active=True)',
)

export const personnelAdminsTotal = metricRegistry.gauge(
  'aemeath_personnel_admins_total',
  'Total admins (relation=admin)',
)

export const personnelMembershipsTotal = metricRegistry.gauge(
  'aemeath_personnel_memberships_total',
  'Total active group memberships',
)

export const personnelSyncLastSuccessTs = metricRegistry.gauge(
  'aemeath_personnel_sync_last_success_timestamp',
  'Unix timestamp of the last successful personnel sync',
)

export const personnelApiErrors = metricRegistry.counter(
  'aemeath_personnel_api_errors_total',
  'Personnel sync API call failures',
  ['action'],
)
