/** Core 任务调度器，从 TaskDefinition.schedule 动态注册定时任务。 */

import { getLogger } from '@logger'
import type { Queue } from 'bullmq'

import type { TaskDefinition, ScheduleConfig } from './types.js'

import { loadEchoConfig } from '@/core/echo/config.js'
import { Startup, Shutdown } from '@/core/lifecycle/registry.js'

const log = getLogger('task_scheduler')

let _taskDefinitions: TaskDefinition[] = []

export function setTaskDefinitions(defs: TaskDefinition[]): void {
  _taskDefinitions = defs
}

function resolveSchedule(
  schedule: ScheduleConfig | string,
  jobName: string,
  defaultTimezone: string,
): { cron: string; tz: string; schedulerId: string } {
  if (typeof schedule === 'string') {
    return { cron: schedule, tz: defaultTimezone, schedulerId: `schedule-${jobName}` }
  }
  return {
    cron: schedule.cron,
    tz: schedule.tz ?? defaultTimezone,
    schedulerId: schedule.schedulerId ?? `schedule-${jobName}`,
  }
}

async function registerScheduledJobs(queue: Queue): Promise<void> {
  const appConfig = await loadEchoConfig()
  const defaultTimezone = appConfig.app?.defaultTimezone ?? 'Asia/Shanghai'

  const scheduled = _taskDefinitions.filter((d) => d.schedule != null)
  for (const def of scheduled) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { cron, tz, schedulerId } = resolveSchedule(def.schedule!, def.jobName, defaultTimezone)
    await queue.upsertJobScheduler(schedulerId, { pattern: cron, tz }, { name: def.jobName })
    log.info({ jobName: def.jobName, cron, schedulerId }, '注册定时任务')
  }
}

Startup({
  name: 'task_scheduler',
  provides: ['task_scheduler'],
  requires: ['queue'],
})(async (deps: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const queue = deps.queue as Queue
  await registerScheduledJobs(queue)
  return { task_scheduler: true }
})

Shutdown({ name: 'task_scheduler' })(
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async (_services: Record<string, unknown>): Promise<void> => {},
)
