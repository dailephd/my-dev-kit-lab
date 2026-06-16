def determine_quality_label(metric):
    if metric.total_tasks == 0:
        return "empty"
    if metric.completion_rate >= 80 and metric.stale_tasks == 0:
        return "healthy"
    if metric.completion_rate >= 50 and metric.stale_tasks <= 1:
        return "watch"
    return "risk"
