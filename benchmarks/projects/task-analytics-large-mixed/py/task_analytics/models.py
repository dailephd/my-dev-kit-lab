from dataclasses import dataclass


@dataclass(frozen=True)
class TaskRecord:
    task_id: str
    project_id: str
    completed: bool
    story_points: int
    updated_day: int


@dataclass(frozen=True)
class ProjectMetrics:
    project_id: str
    total_tasks: int
    completed_tasks: int
    open_tasks: int
    stale_tasks: int
    completion_rate: float
    average_story_points: float
