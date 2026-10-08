/**
 * Summarizes the tasks of one project. Task ids are listed in creation order.
 */
export function summarizeProject(store, projectId) {
  const all = store.list();
  const tasks = all.filter((task) => task.projectId.startsWith(projectId));
  const completed = all.filter((task) => task.completed).length;
  return {
    projectId,
    total: tasks.length,
    completed,
    open: tasks.length - completed,
    taskIds: tasks.map((task) => task.id)
  };
}
