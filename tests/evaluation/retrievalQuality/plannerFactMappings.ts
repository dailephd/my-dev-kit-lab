// Planner-authored fact-to-context ground truth for the bundled retrieval-precision-recall corpus (v0.8.0).
// Each fact lists every required [file, symbol] target; a fact is covered only when all of them are covered.
// This table is the frozen contract the corpus mappings are checked against; do not regenerate it from the corpus.
export const PLANNER_FACT_MAPPINGS: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<readonly [string, string]>>>>> = {
  "warm-medium-import-dedupe": {
    "warm-medium-import-validates-title-and-project": [
      [
        "src/services/importTasks.ts",
        "importTasks"
      ],
      [
        "src/validation/taskValidation.ts",
        "validateImportInput"
      ]
    ],
    "warm-medium-import-skips-duplicates-by-project-and-normalized-title": [
      [
        "src/services/importTasks.ts",
        "importTasks"
      ],
      [
        "src/store/taskStore.ts",
        "findDuplicate"
      ]
    ],
    "warm-medium-import-keeps-deterministic-task-sequences": [
      [
        "src/services/importTasks.ts",
        "importTasks"
      ],
      [
        "src/store/taskStore.ts",
        "createTask"
      ]
    ]
  },
  "warm-medium-create-project-task": {
    "warm-medium-create-validates-title": [
      [
        "src/services/createTask.ts",
        "createTask"
      ],
      [
        "src/validation/taskValidation.ts",
        "validateTaskTitle"
      ]
    ],
    "warm-medium-create-validates-project-before-storing": [
      [
        "src/services/createTask.ts",
        "createTask"
      ],
      [
        "src/validation/taskValidation.ts",
        "validateProjectId"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ],
    "warm-medium-create-normalizes-tags": [
      [
        "src/services/createTask.ts",
        "createTask"
      ],
      [
        "src/validation/taskValidation.ts",
        "normalizeTags"
      ]
    ],
    "warm-medium-create-uses-deterministic-sequence": [
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ],
      [
        "src/utils/deterministicId.ts",
        "createDeterministicId"
      ]
    ],
    "warm-medium-create-starts-incomplete": [
      [
        "src/services/createTask.ts",
        "createTask"
      ]
    ]
  },
  "warm-medium-complete-idempotent": {
    "warm-medium-complete-targets-task-by-id": [
      [
        "src/services/completeTask.ts",
        "completeTask"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ],
    "warm-medium-complete-sets-completed-at": [
      [
        "src/services/completeTask.ts",
        "completeTask"
      ]
    ],
    "warm-medium-complete-is-idempotent": [
      [
        "src/services/completeTask.ts",
        "completeTask"
      ]
    ],
    "warm-medium-complete-unknown-task-throws": [
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ]
  },
  "warm-medium-composite-filter": {
    "warm-medium-filter-combines-active-predicates": [
      [
        "src/services/filterTasks.ts",
        "filterTasks"
      ],
      [
        "src/models/task.ts",
        "TaskFilter"
      ]
    ],
    "warm-medium-filter-project": [
      [
        "src/services/filterTasks.ts",
        "filterTasks"
      ]
    ],
    "warm-medium-filter-completed-priority-tag": [
      [
        "src/services/filterTasks.ts",
        "filterTasks"
      ]
    ],
    "warm-medium-filter-text-query": [
      [
        "src/services/filterTasks.ts",
        "filterTasks"
      ]
    ],
    "warm-medium-filter-read-only-ordering": [
      [
        "src/services/filterTasks.ts",
        "filterTasks"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ]
  },
  "warm-medium-project-summary": {
    "warm-medium-summary-total-open-completed": [
      [
        "src/services/summarizeTasks.ts",
        "summarizeTasks"
      ],
      [
        "src/models/task.ts",
        "TaskSummary"
      ]
    ],
    "warm-medium-summary-by-project": [
      [
        "src/services/summarizeTasks.ts",
        "summarizeTasks"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ],
      [
        "src/models/project.ts",
        "WorkflowProject"
      ]
    ],
    "warm-medium-summary-high-priority-open": [
      [
        "src/services/summarizeTasks.ts",
        "summarizeTasks"
      ]
    ],
    "warm-medium-summary-read-only": [
      [
        "src/services/summarizeTasks.ts",
        "summarizeTasks"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ]
  },
  "warm-medium-broad-workflow-map": {
    "warm-medium-broad-shared-storage": [
      [
        "src/services/createTask.ts",
        "createTask"
      ],
      [
        "src/services/importTasks.ts",
        "importTasks"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ],
    "warm-medium-broad-import-adds-dedupe": [
      [
        "src/services/importTasks.ts",
        "importTasks"
      ],
      [
        "src/validation/taskValidation.ts",
        "validateImportInput"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ],
    "warm-medium-broad-filter-read-only": [
      [
        "src/services/filterTasks.ts",
        "filterTasks"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ],
    "warm-medium-broad-complete-targeted": [
      [
        "src/services/completeTask.ts",
        "completeTask"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ],
    "warm-medium-broad-summary-aggregates": [
      [
        "src/services/summarizeTasks.ts",
        "summarizeTasks"
      ],
      [
        "src/store/taskStore.ts",
        "TaskWorkflowStore"
      ]
    ]
  },
  "warm-large-health-label": {
    "warm-large-snapshot-computes-completion-rate": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ]
    ],
    "warm-large-snapshot-counts-stale-open-tasks": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ]
    ],
    "warm-large-python-quality-labels-healthy-watch-risk": [
      [
        "py/task_analytics/quality.py",
        "determine_quality_label"
      ]
    ],
    "warm-large-python-reporting-renders-quality-lines": [
      [
        "py/task_analytics/reporting.py",
        "build_health_report"
      ],
      [
        "py/task_analytics/quality.py",
        "determine_quality_label"
      ]
    ]
  },
  "warm-large-ts-analytics-snapshot": {
    "warm-large-snapshot-per-project-counts": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ],
      [
        "ts/src/services/listTasksByProject.ts",
        "listTasksByProject"
      ],
      [
        "ts/src/store/taskStore.ts",
        "AnalyticsTaskStore"
      ],
      [
        "ts/src/models/analyticsSnapshot.ts",
        "ProjectSnapshot"
      ]
    ],
    "warm-large-snapshot-completion-rate-formula": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ]
    ],
    "warm-large-snapshot-stale-condition": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ]
    ],
    "warm-large-snapshot-empty-project": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ],
      [
        "ts/src/models/analyticsSnapshot.ts",
        "ProjectSnapshot"
      ]
    ],
    "warm-large-snapshot-totals-aggregate": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ],
      [
        "ts/src/models/analyticsSnapshot.ts",
        "ProjectSnapshot"
      ]
    ]
  },
  "warm-large-ts-leaderboard": {
    "warm-large-leaderboard-completion-rate-descending": [
      [
        "ts/src/reporting/buildProjectLeaderboard.ts",
        "buildProjectLeaderboard"
      ]
    ],
    "warm-large-leaderboard-stale-ascending": [
      [
        "ts/src/reporting/buildProjectLeaderboard.ts",
        "buildProjectLeaderboard"
      ]
    ],
    "warm-large-leaderboard-project-id-final": [
      [
        "ts/src/reporting/buildProjectLeaderboard.ts",
        "buildProjectLeaderboard"
      ]
    ],
    "warm-large-leaderboard-one-based-ranks": [
      [
        "ts/src/reporting/buildProjectLeaderboard.ts",
        "buildProjectLeaderboard"
      ]
    ]
  },
  "warm-large-python-parser-metrics": {
    "warm-large-python-parser-task-record": [
      [
        "py/task_analytics/parser.py",
        "parse_task_rows"
      ],
      [
        "py/task_analytics/models.py",
        "TaskRecord"
      ]
    ],
    "warm-large-python-metrics-grouped-by-project": [
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ],
      [
        "py/task_analytics/models.py",
        "ProjectMetrics"
      ]
    ],
    "warm-large-python-metrics-counts": [
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ]
    ],
    "warm-large-python-metrics-completion-rate": [
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ]
    ],
    "warm-large-python-metrics-average-story-points": [
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ]
    ]
  },
  "warm-large-python-pipeline": {
    "warm-large-pipeline-parses-first": [
      [
        "py/task_analytics/pipeline.py",
        "build_report_from_rows"
      ],
      [
        "py/task_analytics/parser.py",
        "parse_task_rows"
      ]
    ],
    "warm-large-pipeline-metrics-before-report": [
      [
        "py/task_analytics/pipeline.py",
        "build_report_from_rows"
      ],
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ],
      [
        "py/task_analytics/reporting.py",
        "build_health_report"
      ]
    ],
    "warm-large-pipeline-quality-label-in-report": [
      [
        "py/task_analytics/reporting.py",
        "build_health_report"
      ],
      [
        "py/task_analytics/quality.py",
        "determine_quality_label"
      ]
    ],
    "warm-large-pipeline-deterministic-output": [
      [
        "py/task_analytics/reporting.py",
        "build_health_report"
      ]
    ],
    "warm-large-pipeline-composes-owners": [
      [
        "py/task_analytics/pipeline.py",
        "build_report_from_rows"
      ],
      [
        "py/task_analytics/parser.py",
        "parse_task_rows"
      ],
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ],
      [
        "py/task_analytics/reporting.py",
        "build_health_report"
      ]
    ]
  },
  "warm-large-broad-analytics-comparison": {
    "warm-large-broad-typescript-side": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ],
      [
        "ts/src/reporting/formatTaskHealthReport.ts",
        "formatTaskHealthReport"
      ],
      [
        "ts/src/reporting/buildProjectLeaderboard.ts",
        "buildProjectLeaderboard"
      ]
    ],
    "warm-large-broad-python-side": [
      [
        "py/task_analytics/parser.py",
        "parse_task_rows"
      ],
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ],
      [
        "py/task_analytics/quality.py",
        "determine_quality_label"
      ],
      [
        "py/task_analytics/reporting.py",
        "build_health_report"
      ],
      [
        "py/task_analytics/pipeline.py",
        "build_report_from_rows"
      ]
    ],
    "warm-large-broad-comparable-evidence": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ],
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ]
    ],
    "warm-large-broad-independent-implementations": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ],
      [
        "py/task_analytics/pipeline.py",
        "build_report_from_rows"
      ]
    ],
    "warm-large-broad-no-cross-invocation": [
      [
        "ts/src/services/buildAnalyticsSnapshot.ts",
        "buildAnalyticsSnapshot"
      ],
      [
        "ts/src/reporting/formatTaskHealthReport.ts",
        "formatTaskHealthReport"
      ],
      [
        "ts/src/reporting/buildProjectLeaderboard.ts",
        "buildProjectLeaderboard"
      ],
      [
        "py/task_analytics/parser.py",
        "parse_task_rows"
      ],
      [
        "py/task_analytics/metrics.py",
        "calculate_project_metrics"
      ],
      [
        "py/task_analytics/quality.py",
        "determine_quality_label"
      ],
      [
        "py/task_analytics/reporting.py",
        "build_health_report"
      ],
      [
        "py/task_analytics/pipeline.py",
        "build_report_from_rows"
      ]
    ]
  }
};

/** SHA-256 of JSON.stringify of the 12 original cases before expectedContextTargets was added. */
export const ORIGINAL_CORPUS_SHA256 = "a0a366e9477ad89f279521ea92c34168afb861504444f8763b5531cec0b5c66a";
