# Demo script (target: 100 seconds, hard limit under 2:00)

Rules from the challenge: Rishabh must explain the project **in his own voice** (no AI voice or avatar), the video must
show the project running in a web browser, no third-party trademarks or copyrighted music, public on YouTube.
Read the lines out loud once before recording; change any word that feels unnatural. Everything said below is shown on screen.

## Setup before recording

- Serve or open the hosted site in a fresh window. Browser zoom 110 to 125 percent.
- Hosted URL: `<PUBLIC SITE URL>` (replace). Keep the tab on the **Ask** card.
- Do not paste any API key on screen. Do not open the AI model tab with a key in it.
- Clear the request box. Open the Messages tab once beforehand so it is empty.
- Record at 1080p with your microphone only, no music.

## Script and shots (about 190 words, roughly 90 to 100 seconds at a relaxed pace)

| Time | Shot | Say |
| --- | --- | --- |
| 0:00 | Site home, Ask card visible | "I'm Rishabh Bansal. This is Meeting Finder, my entry for the Open Agentic Web Challenge. It helps people in different cities find a meeting time that respects time zones and public holidays." |
| 0:12 | Click the first example chip (London, Bengaluru, Chicago). Click **Find times**. | "I describe the meeting in plain English. The agents run inside my browser, with no key and no server." |
| 0:24 | Consent card appears for Time Zone Desk. Point at the origin and the text sent. Click **Allow once**. Then Holiday Desk card, click **Allow for this session**. | "The coordinator needs two other agent sites. Before it contacts either one, it asks me, and shows what it will send. I allow them." |
| 0:40 | Results: Option 1 with the table, then scroll to the summary line about widened hours and skipped holidays. | "Here are ranked options with each person's local time. Nobody can meet inside normal hours here, so it widened the hours and says so." |
| 0:54 | Click **Agent graph** tab (boxes green), then **Messages** tab, expand one message. | "The graph shows which agents ran, including the two peer sites. Every message between agents is listed here." |
| 1:08 | **Peers and privacy** tab. Click **Call a site that is not allowed**. Show the refusal text. | "If a site is not on the allowed list, the runtime refuses and nothing is sent." |
| 1:16 | **Self-test** tab, click **Run checks**, show all PASS. | "This runs thirteen checks from the specification against the runtime." |
| 1:26 | Open **validator** link. Click **Validate this site**, then **Load a broken example**. | "I also built a conformance validator and a small library called agentify dot js, so any page can become an agent site. Here it passes this site and flags a broken file." |
| 1:44 | Back to site, footer visible. | "It is open source under MIT, built with Claude Code. Thanks for watching." |

Total spoken text is about 190 words. If you run over 1:50, drop the self-test line (1:16) first.

## Things not to say or show

- Do not say it works with any model or provider; the key panel was only tested against fake endpoints.
- Do not call the holiday data complete: it covers the US federal and England and Wales calendars only.
- Do not claim users, benchmarks or endorsements; there are none.
- Do not show your own email, tokens or other tabs. Use a clean browser window.

## Backup if a step misbehaves

- If a consent card does not appear, the box "Ask before contacting a peer, even on this same origin" in **Peers and privacy** is unticked: tick it and rerun.
- If the page shows "Could not load this site's manifest", you opened `index.html` as a file. Use the served or hosted URL.
