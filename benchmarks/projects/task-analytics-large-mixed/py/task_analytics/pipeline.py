from .metrics import calculate_project_metrics
from .parser import parse_task_rows
from .reporting import build_health_report


def build_report_from_rows(rows, current_day):
    tasks = parse_task_rows(rows)
    metrics = calculate_project_metrics(tasks, current_day)
    return build_health_report(metrics)
