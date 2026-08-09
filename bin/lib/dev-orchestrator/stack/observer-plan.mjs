import { startsDevOnUp } from '../../boot-engine/launcher.mjs';

export function observerPlanFromBootPlan(plan) {
  return plan.services.map((entry) => {
    if (entry.policy !== 'task-isolated') {
      return { name: entry.id, policy: 'shared-reuse', logMode: 'docker-logs' };
    }
    if (startsDevOnUp(entry.launcher)) {
      return { name: entry.id, policy: 'task-isolated', logMode: 'docker-logs', projectName: entry.projectName, container: entry.projectName };
    }
    return { name: entry.id, policy: 'task-isolated', logMode: 'exec-file', projectName: entry.projectName };
  });
}
