import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from task_service import TaskService


class TaskServiceTests(unittest.TestCase):
    def test_creates_tasks_with_deterministic_ids(self) -> None:
        service = TaskService()
        self.assertEqual(service.create_task("First")["id"], "task-1")
        self.assertEqual(service.create_task("Second")["id"], "task-2")

    def test_completes_tasks(self) -> None:
        service = TaskService()
        created = service.create_task("Ship benchmark")
        completed = service.complete_task(created["id"])
        self.assertTrue(completed["completed"])

    def test_lists_all_tasks(self) -> None:
        service = TaskService()
        service.create_task("One")
        service.create_task("Two")
        self.assertEqual(len(service.list_tasks()), 2)

    def test_lists_open_tasks(self) -> None:
        service = TaskService()
        first = service.create_task("One")
        service.create_task("Two")
        service.complete_task(first["id"])
        self.assertEqual([task["title"] for task in service.list_open_tasks()], ["Two"])

    def test_summarizes_tasks(self) -> None:
        service = TaskService()
        first = service.create_task("One")
        service.create_task("Two")
        service.complete_task(first["id"])
        self.assertEqual(
            service.summarize_tasks(),
            {"total": 2, "open": 1, "completed": 1},
        )

    def test_rejects_empty_task_titles(self) -> None:
        service = TaskService()
        with self.assertRaisesRegex(ValueError, "Task title must not be empty."):
            service.create_task("   ")


if __name__ == "__main__":
    unittest.main()
