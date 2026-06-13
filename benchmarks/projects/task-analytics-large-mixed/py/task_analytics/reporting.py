from .quality import determine_quality_label


def build_health_report(metrics):
    lines = []
    for metric in metrics:
        label = determine_quality_label(metric)
        lines.append(
            f"{metric.project_id}: {label} | completion={metric.completion_rate}% | open={metric.open_tasks} | stale={metric.stale_tasks}"
        )
    return "\n".join(lines)
