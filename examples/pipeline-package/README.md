# One-time pipeline package example

Set `settings.agentWorkingDirectory`, replace the change/acceptance criteria in the prompts,
and configure `verify.sh` with real project checks. Its placeholder deliberately fails.
Use **Workflows → Import workflow** to select `pipeline.json`, or ZIP this directory and select the
archive. It opens an editable native Workflow draft; importing does not execute anything. Choose
each agent's connection, model and effort in the Workflow editor, then create and start the workflow.

The first human step waits for approval. Each correction runs a fresh shell gate before review.
PASS succeeds immediately; CONDITIONAL is accepted from the second review. Three unsuccessful
reviews halt the run. Package files use RUNHQ_PACKAGE_ROOT, code uses RUNHQ_WORKSPACE_ROOT,
and persistent execution records use PIPELINE_HOME.

See ../../docs/PIPELINE_PACKAGES.md for the complete supported contract.
