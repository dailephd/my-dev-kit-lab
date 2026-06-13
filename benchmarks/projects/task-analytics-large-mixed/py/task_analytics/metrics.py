from .models import ProjectMetrics


STALE_DAY_THRESHOLD = 10


def calculate_project_metrics(tasks, current_day):
    grouped = {}
    for task in tasks:
        grouped.setdefault(task.project_id, []).append(task)

    metrics = []
    for project_id in sorted(grouped):
        project_tasks = grouped[project_id]
        completed = sum(1 for task in project_tasks if task.completed)
        stale = sum(1 for task in project_tasks if not task.completed and current_day - task.updated_day >= STALE_DAY_THRESHOLD)
        total = len(project_tasks)
        metrics.append(
            ProjectMetrics(
                project_id=project_id,
                total_tasks=total,
                completed_tasks=completed,
                open_tasks=total - completed,
                stale_tasks=stale,
                completion_rate=round((completed / total) * 100, 2) if total else 0.0,
                average_story_points=round(sum(task.story_points for task in project_tasks) / total, 2) if total else 0.0,
            )
        )
    return metrics
