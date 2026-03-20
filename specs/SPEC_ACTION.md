# SPEC_ACTION — packages/action

## Overview

A composite GitHub Action that installs drill-cli, runs analysis on a provided log input, and optionally posts the result as a PR comment. Zero config beyond the API key.

---

## Repository: github.com/drill-dev/action

```
packages/action/
  action.yml          # Action definition
  README.md           # Full usage docs with examples
```

---

## action.yml — complete definition

```yaml
name: 'Drill — AI log diagnosis'
description: 'Analyze build, test, or deploy logs and post the root cause as a PR comment'
author: 'drill-dev'

branding:
  icon: 'search'
  color: 'purple'

inputs:
  api-key:
    description: 'Your Drill API key (from drill.dev/dashboard). Store as a repository secret.'
    required: true
  log-input:
    description: 'Log content to analyze. Use multi-line string or step output reference.'
    required: true
  post-comment:
    description: 'Post the result as a PR comment (true/false)'
    default: 'true'
  comment-title:
    description: 'Title prefix for the PR comment'
    default: 'Drill analysis'
  fail-on-critical:
    description: 'Fail the action step if Drill finds a critical-severity cause'
    default: 'false'
  lines:
    description: 'Limit analysis to last N lines of the log'
    default: ''
  output-file:
    description: 'Write JSON result to this file path'
    default: ''

outputs:
  cause:
    description: 'The identified root cause'
    value: ${{ steps.analyze.outputs.cause }}
  confidence:
    description: 'Confidence percentage (0-100)'
    value: ${{ steps.analyze.outputs.confidence }}
  severity:
    description: 'Severity level: critical, high, medium, low'
    value: ${{ steps.analyze.outputs.severity }}
  fix:
    description: 'Suggested fix'
    value: ${{ steps.analyze.outputs.fix }}

runs:
  using: 'composite'
  steps:
    - name: Install drill-cli
      shell: bash
      run: npm install -g drill-cli@latest

    - name: Run analysis
      id: analyze
      shell: bash
      env:
        DRILL_API_KEY: ${{ inputs.api-key }}
      run: |
        # Write log to temp file to handle multi-line input
        TMPFILE=$(mktemp)
        cat << 'DRILL_EOF' > "$TMPFILE"
        ${{ inputs.log-input }}
        DRILL_EOF

        # Build flags
        FLAGS="--json"
        if [ -n "${{ inputs.lines }}" ]; then
          FLAGS="$FLAGS --lines ${{ inputs.lines }}"
        fi

        # Run drill
        RESULT=$(drill $FLAGS < "$TMPFILE" 2>/dev/null) || true
        rm -f "$TMPFILE"

        if [ -z "$RESULT" ]; then
          echo "cause=Analysis failed - check API key" >> $GITHUB_OUTPUT
          echo "confidence=0" >> $GITHUB_OUTPUT
          echo "severity=low" >> $GITHUB_OUTPUT
          echo "fix=Check your DRILL_API_KEY secret" >> $GITHUB_OUTPUT
          exit 0
        fi

        # Parse outputs
        CAUSE=$(echo "$RESULT" | jq -r '.cause // "Unknown"')
        CONFIDENCE=$(echo "$RESULT" | jq -r '.confidence // "0"')
        SEVERITY=$(echo "$RESULT" | jq -r '.severity // "low"')
        FIX=$(echo "$RESULT" | jq -r '.fix // ""')

        # Set outputs
        echo "cause=$CAUSE" >> $GITHUB_OUTPUT
        echo "confidence=$CONFIDENCE" >> $GITHUB_OUTPUT
        echo "severity=$SEVERITY" >> $GITHUB_OUTPUT
        echo "fix=$FIX" >> $GITHUB_OUTPUT

        # Write output file if requested
        if [ -n "${{ inputs.output-file }}" ]; then
          echo "$RESULT" > "${{ inputs.output-file }}"
        fi

        # Fail if critical and fail-on-critical is true
        if [ "${{ inputs.fail-on-critical }}" = "true" ] && [ "$SEVERITY" = "critical" ]; then
          echo "Drill found a CRITICAL severity issue: $CAUSE"
          exit 1
        fi

    - name: Post PR comment
      if: inputs.post-comment == 'true' && github.event_name == 'pull_request'
      uses: actions/github-script@v7
      with:
        script: |
          const cause = '${{ steps.analyze.outputs.cause }}';
          const confidence = '${{ steps.analyze.outputs.confidence }}';
          const severity = '${{ steps.analyze.outputs.severity }}';
          const fix = '${{ steps.analyze.outputs.fix }}';
          const title = '${{ inputs.comment-title }}';

          const severityEmoji = {
            critical: '🔴',
            high: '🟠',
            medium: '🟡',
            low: '🟢'
          }[severity] || '⚪';

          const body = [
            `### ${severityEmoji} ${title}`,
            '',
            `**Probable cause:** ${cause}`,
            '',
            `**Suggested fix:** ${fix}`,
            '',
            `*Confidence: ${confidence}% · Severity: ${severity} · Powered by [Drill](https://drill.dev)*`,
          ].join('\n');

          await github.rest.issues.createComment({
            ...context.repo,
            issue_number: context.issue.number,
            body,
          });
```

---

## README.md — complete usage docs

### Quick start

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        id: tests
        run: npm test 2>&1 | tee test.log
        continue-on-error: true

      - name: Drill analysis
        if: steps.tests.outcome == 'failure'
        uses: drill-dev/action@v1
        with:
          api-key: ${{ secrets.DRILL_API_KEY }}
          log-input: ${{ steps.tests.outputs.log }}
```

### Using step output capture

```yaml
- name: Build
  id: build
  run: |
    {
      echo 'log<<DRILL_DELIMITER'
      npm run build 2>&1
      echo DRILL_DELIMITER
    } >> $GITHUB_OUTPUT
  continue-on-error: true

- name: Analyze build failure
  if: steps.build.outcome == 'failure'
  uses: drill-dev/action@v1
  with:
    api-key: ${{ secrets.DRILL_API_KEY }}
    log-input: ${{ steps.build.outputs.log }}
    fail-on-critical: 'true'
```

### Using outputs in subsequent steps

```yaml
- name: Drill analysis
  id: drill
  uses: drill-dev/action@v1
  with:
    api-key: ${{ secrets.DRILL_API_KEY }}
    log-input: ${{ steps.deploy.outputs.log }}

- name: Notify Slack
  if: always()
  run: |
    curl -X POST $SLACK_WEBHOOK -d "{
      \"text\": \"Deploy issue: ${{ steps.drill.outputs.cause }}\nFix: ${{ steps.drill.outputs.fix }}\"
    }"
```
