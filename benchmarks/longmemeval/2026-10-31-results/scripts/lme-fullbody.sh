#!/bin/zsh
# Full 500-question run, one system at a time (shared CPU slows Ollama into its timeout).
# The harness resumes per question; a failed attempt is logged to failures.log and the driver relaunched.
B=/Users/Shared/raim-bench
for a in rai-ollama-fullbody rai-embedded-fullbody; do
  for attempt in 1 2 3 4 5 6; do
    echo "=== $a attempt $attempt start $(date '+%F %T')" >> $B/lme-w/fullbody.log
    if $B/lme-drive.sh $a >> $B/lme-w/$a-full.log 2>&1; then
      echo "=== $a DONE $(date '+%F %T')" >> $B/lme-w/fullbody.log; break
    fi
    echo "$(date '+%F %T') $a attempt $attempt: $(grep -E 'Error' $B/lme-w/$a-full.log | tail -1 | cut -c1-300)" >> $B/lme-w/failures.log
    [ $attempt = 6 ] && { echo "=== $a GAVE UP" >> $B/lme-w/fullbody.log; exit 1; }
  done
done
echo "=== FULLBODY ALL DONE $(date '+%F %T')" >> $B/lme-w/fullbody.log
