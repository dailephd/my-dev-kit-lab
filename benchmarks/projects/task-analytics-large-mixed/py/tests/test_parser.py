import unittest

from task_analytics.parser import parse_task_rows


class ParserTests(unittest.TestCase):
    def test_parse_task_rows(self):
        rows = [{"task_id": "task-1", "project_id": "alpha", "completed": False, "story_points": 3, "updated_day": 2}]
        parsed = parse_task_rows(rows)
        self.assertEqual(parsed[0].task_id, "task-1")
        self.assertFalse(parsed[0].completed)


if __name__ == "__main__":
    unittest.main()
