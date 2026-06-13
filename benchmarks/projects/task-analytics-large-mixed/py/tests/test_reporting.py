import unittest

from task_analytics.fixtures import sample_rows
from task_analytics.pipeline import build_report_from_rows


class ReportingTests(unittest.TestCase):
    def test_build_report_from_rows(self):
        report = build_report_from_rows(sample_rows(), 15)
        self.assertIn("alpha: watch", report)
        self.assertIn("beta: risk", report)


if __name__ == "__main__":
    unittest.main()
