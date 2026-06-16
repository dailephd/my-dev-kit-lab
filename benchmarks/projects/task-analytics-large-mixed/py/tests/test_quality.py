import unittest

from task_analytics.metrics import calculate_project_metrics
from task_analytics.parser import parse_task_rows
from task_analytics.quality import determine_quality_label


class QualityTests(unittest.TestCase):
    def test_determine_quality_label(self):
        rows = [
            {"task_id": "task-1", "project_id": "alpha", "completed": True, "story_points": 5, "updated_day": 8},
            {"task_id": "task-2", "project_id": "alpha", "completed": True, "story_points": 3, "updated_day": 7},
        ]
        metrics = calculate_project_metrics(parse_task_rows(rows), 15)
        self.assertEqual(determine_quality_label(metrics[0]), "healthy")


if __name__ == "__main__":
    unittest.main()
