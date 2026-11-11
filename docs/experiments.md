# Experiments and local analytics

OpenWorld is built in small experiments. These are the hypotheses we test and how we measure them, all from local data on your own machine.

Value hypothesis: developers who walk into a repo's building will understand recent changes faster by talking to the desk workers than by reading the PR list, and will come back to hire agents from inside the game.

Growth hypothesis: a screenshot or clip of *your own* code as a skyline gets shared, and people install it to see theirs.

Exploration hypothesis: being able to go *anywhere* (and fly there) brings people back more than a fixed city does. Measured as the share of Earth sessions that leave the home district (`explore.exploreShare` in `/api/stats`).

Public city hypothesis: someone with no GitHub connected will stay and connect if the city is already full of projects they know. Without an account the world shows about 30 famous open-source projects (React, Linux, VS Code…) as buildings anyone can walk into and ask about. Pass marks, set before shipping: at least 40% of no-account sessions walk into a showcase building (`showcase.enterShare` in `/api/stats`), and at least 10% connect GitHub in that same session (`showcase.connectShare`). Below 20% entering, the showcase is not the way in and the landing should lead with something else. `connectShare` only sees a token pasted in the game; someone who runs `gh auth login` and comes back shows up as a new session with their own repos, so read it as a floor (`showcase.connectClickShare` counts everyone who pressed Connect GitHub from a showcase building).

Clip hypothesis (the growth loop's first step): one in five people who connect a repo export a clip of its building. Pass mark: `clips.clipShare` in `/api/stats` at 0.2 or higher, where `clipShare` is the share of sessions that walked into one of their own buildings (`building_entered`, so a repo is connected) and also saved or downloaded a clip (`clip_saved`, `clip_downloaded`). `clip_started` carries the shot (`orbit`, `flyover`, `history`) and the shape (`16:9`, `9:16`), so we can see which film people pick and how many recordings are abandoned. Below 0.1 after 30 such sessions, the one-click clip is not the loop and we look at what people share instead (photos, the landing postcard).

Local, cohort-ready events go to `~/.openworld/events.jsonl` (`session_start` with the city or real place, `explore_far`, `explore_teleport`, `building_entered`, `desk_talk`, `agent_started`, `agent_pr_opened`, `boardroom_convened`, `office_message_sent`, `office_dispatch`, `showcase_shown` once per session with the number of buildings, `showcase_entered`, `showcase_connect_clicked`, `github_connected`); `GET /api/stats` summarizes them per day and session. Automated test runs are tagged and left out.

Team hypothesis: seeing teammates in the world makes people open the game during the workday, because that is where the team is. Metric: of the game sessions connected to a team, the share where two or more people were online at once (`team.companyShare` in `/api/stats`, from `team_online` and `team_company`). Supporting events: `team_hosted`, `team_joined`, `team_message_sent`, `team_teleport`, and `team_seen_together` (the first time two players stand within 50 m of each other in a session). If people join teams but `companyShare` stays low, presence alone isn't a reason to open the game and the next test is something to do together, not more presence.

The event log never leaves your computer: nothing is uploaded.
