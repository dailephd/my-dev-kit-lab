import json
import sys


class TaskService:
    def __init__(self) -> None:
        self._tasks = []
        self._next_id = 1

    def create_task(self, title: str) -> dict:
        normalized = title.strip()
        if not normalized:
            raise ValueError("Task title must not be empty.")
        task = {
            "id": f"task-{self._next_id}",
            "title": normalized,
            "completed": False,
        }
        self._next_id += 1
        self._tasks.append(task)
        return dict(task)

    def complete_task(self, task_id: str) -> dict:
        for task in self._tasks:
            if task["id"] == task_id:
                task["completed"] = True
                return dict(task)
        raise ValueError(f"Task not found: {task_id}")

    def list_tasks(self) -> list:
        return [dict(task) for task in self._tasks]

    def list_open_tasks(self) -> list:
        return [dict(task) for task in self._tasks if not task["completed"]]

    def summarize_tasks(self) -> dict:
        completed = len([task for task in self._tasks if task["completed"]])
        return {
            "total": len(self._tasks),
            "open": len(self._tasks) - completed,
            "completed": completed,
        }


def run_operations(payload: dict) -> dict:
    service = TaskService()
    results = []
    for operation in payload["operations"]:
        op_type = operation["type"]
        if op_type == "createTask":
            results.append(service.create_task(operation["title"]))
        elif op_type == "completeTask":
            results.append(service.complete_task(operation["id"]))
        elif op_type == "listTasks":
            results.append(service.list_tasks())
        elif op_type == "listOpenTasks":
            results.append(service.list_open_tasks())
        elif op_type == "summarizeTasks":
            results.append(service.summarize_tasks())
        else:
            raise ValueError(f"Unsupported operation: {op_type}")
    return {"results": results}


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        sys.stdout.write(json.dumps(run_operations(payload)))
        return 0
    except Exception as error:
        sys.stderr.write(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
