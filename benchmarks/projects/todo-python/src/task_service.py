from typing import Optional

from task_store import TaskStore


class TaskService:
    def __init__(self, store: Optional[TaskStore] = None) -> None:
        self._store = store or TaskStore()

    def create_task(self, title: str) -> dict:
        normalized = title.strip()
        if not normalized:
            raise ValueError("Task title must not be empty.")
        return self._store.create(normalized)

    def complete_task(self, task_id: str) -> dict:
        return self._store.update(task_id, lambda task: {**task, "completed": True})

    def list_tasks(self) -> list:
        return self._store.list()

    def list_open_tasks(self) -> list:
        return [task for task in self._store.list() if not task["completed"]]

    def summarize_tasks(self) -> dict:
        tasks = self._store.list()
        completed = len([task for task in tasks if task["completed"]])
        return {
            "total": len(tasks),
            "open": len(tasks) - completed,
            "completed": completed,
        }
