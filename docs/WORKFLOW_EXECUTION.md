# Workflow execution and recipe files

For a **one-time job**, use Agents → Workflows → Import workflow and select
`examples/workflows/review-pipeline/recipe.json`. A bundle with multiple entries asks which one
to open. The importer opens an editable draft without saving anything to the recipe library or
starting an agent. Choose your project/accounts, inspect the steps and use Create workflow to
persist it. Enable automatic progression if the entire pipeline should continue automatically.

For **reusable instructions**, use Agents → Library → Import. This deliberately saves recipe
entries for later reuse. The recipe editor fills the window, with separate General settings and
Workflow steps sections, a step list, optional graph and a wide prompt editor. Switching sections
or views preserves the current edits.

Both entry points accept the same version 1 JSON bundle and resolve prompt files in the same way.
The `recipes` key in the portable file is a format field, not a requirement to keep a recipe in the
library. The example expects a project-owned `verify.sh`; change it to your project's verifier.

A workflow holds up to **512 steps**, including automatically added correction/review/check steps.
Each agent prompt is limited to 128 KiB. A JSON recipe bundle (including resolved prompt files)
and each saved recipe may occupy up to 16 MiB. Version 1 recipes without execution settings
keep their previous behavior, including one automatic correction and no agent deadline.

`promptFile` resolves a UTF-8 prompt relative to the selected recipe JSON file.
`fixPromptFile` does the same for a review's correction prompt. Paths must remain inside that
folder, including after symlink resolution. Imports capture the contents; portable exports embed
them, so later changes to the source files require reimporting. Inline `prompt` and
`execution.fix_prompt` also work. YAML and the proposed `settings`/`steps` pipeline envelope are
not this recipe format. Unknown execution settings are rejected, not silently discarded.

## Per-step execution settings

These are optional properties inside each recipe step's `execution` object. The same controls
are available in the workflow editor. Recipe graph fields remain camelCase (`dependsOn`,
`reviewPolicy`); execution settings match the runtime's snake_case contract.

| Field                  | Meaning                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`              | Shell command for a `role: "shell"` step; exit code 0 succeeds.                                                                                                                                                                                                  |
| `working_directory`    | Existing relative subfolder inside that step's checkout; empty uses the checkout directory. Absolute paths and parent traversal are rejected.                                                                                                                    |
| `lock`                 | Global resource name. Steps with the same nonempty name never run simultaneously within this RunHQ instance, including across workflows.                                                                                                                         |
| `timeout_minutes`      | Total time limit, 0–10080; 0 disables it. Waiting for input counts toward this deadline.                                                                                                                                                                         |
| `idle_timeout_minutes` | No-activity time limit, 0–10080; 0 disables it. Human input/permission waits and explicitly paused agents reset the inactivity clock. For shell commands, activity means output.                                                                                 |
| `max_retries`          | 0–10 additional attempts after execution failure; default 0. Blocked/malformed results do not retry automatically.                                                                                                                                               |
| `retry_delay_seconds`  | Delay before an automatic retry, 0–86400; default 30.                                                                                                                                                                                                            |
| `max_fix_attempts`     | 0–10 correction/review rounds for `reviewPolicy: "auto_fix"`; default 1. Three means first review plus up to three corrections and three new reviews.                                                                                                            |
| `fix_prompt`           | Optional dedicated correction instruction. The review findings are appended.                                                                                                                                                                                     |
| `fix_commands`         | Optional list of up to 12 commands between each correction and its new review. If omitted/empty, directly preceding shell steps are repeated in declaration/dependency order.                                                                                    |
| `result_format`        | `none` (provider completion), `json`, `pipeline`, or `review`.                                                                                                                                                                                                   |
| `success_regex`        | Optional required match on the final nonempty response line.                                                                                                                                                                                                     |
| `failure_regex`        | Optional failure match on that same line; failure takes precedence over success.                                                                                                                                                                                 |
| `on_failure`           | `pause` (default): stop admitting new work; `cancel`: also interrupt already running siblings. Applied after automatic retries are exhausted.                                                                                                                    |
| `run_if`               | `{ "step_id": "earlier-step", "outcomes": ["findings"] }`. Must name a direct dependency. Other allowed outcomes are `pass` and `skipped`. False conditions record a skipped step, satisfying its dependencies. Final independent reviews cannot be conditional. |

Shell steps run in the shared checkout and can appear anywhere before the final independent
review. They do not invoke an AI provider. Setup/check commands at the workflow boundaries retain
their previous ten-minute limit; use a shell step for configurable long commands. Account/model
fields on shell declarations are retained for recipe compatibility but do not start an agent.
Shell commands may modify files, so the graph requires their results to be independently reviewed.

## Results and branching

Only one protocol marker, on the final nonempty assistant response line, counts. Earlier duplicate
markers, missing values and invalid values block the step. Tool logs do not decide an agent result.

- JSON: `RUNHQ_STEP_RESULT: {"outcome":"pass"}`. Other values: `findings`, `blocked`, `failed`.
- Pipeline: `PIPELINE_RESULT: SUCCESS` → pass; `PARTIAL` → findings; `BLOCKED` → blocked;
  `FAILED` → failed.
- Review: `REVIEW_VERDICT: PASS` → pass; `CONDITIONAL` or `FAIL` → findings.

A `findings` result is a successfully completed execution with issues. A review's policy decides
whether to wait, correct, or continue. `run_if` reads recorded outcomes after dependencies finish;
it does not evaluate JavaScript or arbitrary expressions. When automatic correction inserts new
steps, dependents and their conditions are redirected to the new review. The corrected result
must pass the repeated checks before a new review runs. At the correction limit, human approval,
manual correction, or a fresh review is required.

Regex syntax is Rust regex syntax (no lookaround or backreferences), bounded to 4096 bytes.
Failure patterns take precedence. A missing required success match blocks the step.

## Recovery and observation

The task board shows attempt history, bounded recorded output, exit codes and pending retry times.
Retries run in the existing working copy: partial files remain; prior successful steps do not replay.
An explicit retry is required after application restart. Open the interrupted step, inspect its
working copy/output and use Retry. RunHQ never silently replays uncertain work after restarting.
Provider quotas, authentication and network availability still apply to long agent turns.

Enable desktop notifications in agent settings to receive workflow review/failure notifications.
Project mute preferences apply. Workflow cancellation stops owned command processes and releases
resource reservations when they terminate. Final application to the original checkout remains an
explicit user action.
