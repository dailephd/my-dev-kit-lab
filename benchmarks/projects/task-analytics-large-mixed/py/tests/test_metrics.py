import unittest

from task_analytics.fixtures import sample_rows
from task_analytics.metrics import calculate_project_metrics
from task_analytics.parser import parse_task_rows


class MetricsTests(unittest.TestCase):
    def test_calculate_project_metrics(self):
        metrics = calculate_project_metrics(parse_task_rows(sample_rows()), 15)
        self.assertEqual(metrics[0].project_id, "alpha")
        self.assertEqual(metrics[0].completion_rate, 50.0)
        self.assertEqual(metrics[0].stale_tasks, 1)
        self.assertEqual(metrics[1].project_id, "beta")
        self.assertEqual(metrics[1].completion_rate, 0.0)


if __name__ == "__main__":
    unittest.main()
