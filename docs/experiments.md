# Experiments and local analytics

OpenWorld is built in small experiments. These are the hypotheses we test and how we measure them, all from local data on your own machine.

Value hypothesis: developers who walk into a repo's building will understand recent changes faster by talking to the desk workers than by reading the PR list, and will come back to hire agents from inside the game.

Growth hypothesis: a screenshot or clip of *your own* code as a skyline gets shared, and people install it to see theirs.

Exploration hypothesis: being able to go *anywhere* (and fly there) brings people back more than a fixed city does. Measured as the share of Earth sessions that leave the home district (`explore.exploreShare` in `/api/stats`).

Local, cohort-ready events go to `~/.openworld/events.jsonl` (`session_start` with the city or real place, `explore_far`, `explore_teleport`, `building_entered`, `desk_talk`, `agent_started`, `agent_pr_opened`, `boardroom_convened`, `office_message_sent`, `office_dispatch`); `GET /api/stats` summarizes them per day and session. Automated test runs are tagged and left out.

The event log never leaves your computer: nothing is uploaded.
