from .models import TaskRecord


def parse_task_rows(rows):
    records = []
    for row in rows:
        records.append(
            TaskRecord(
                task_id=str(row["task_id"]),
                project_id=str(row["project_id"]),
                completed=bool(row["completed"]),
                story_points=int(row["story_points"]),
                updated_day=int(row["updated_day"]),
            )
        )
    return records
