from copy import deepcopy


class TaskStore:
    def __init__(self) -> None:
        self._tasks = []
        self._next_id = 1

    def create(self, title: str) -> dict:
        task = {
            "id": f"task-{self._next_id}",
            "title": title,
            "completed": False,
        }
        self._next_id += 1
        self._tasks.append(task)
        return deepcopy(task)

    def update(self, task_id: str, updater) -> dict:
        for index, task in enumerate(self._tasks):
            if task["id"] == task_id:
                updated = updater(deepcopy(task))
                self._tasks[index] = deepcopy(updated)
                return deepcopy(updated)
        raise ValueError(f"Task not found: {task_id}")

    def list(self) -> list:
        return deepcopy(self._tasks)
