# Changelog

Notable changes, newest first. Dates are deploy dates.

## 2026-10-17

- **Estimation scoring in untimed sessions** — untimed sessions give 1 point per correct answer, but estimation questions still handed out the 1000/800/600 ranking table (plus 200 for an exact hit), so three estimation questions decided a whole 24-question party quiz. In untimed sessions only the closest answer now scores, 1 point, and ties all get it. Timed sessions keep the ranking table.

## 2026-10-16

- **Stale round champion fix** — the phone and big screen cleared the "Question Champion" box only when a new champion arrived, so after a question nobody got right the previous question's winner showed again and looked like a correct answer. A new question now clears it, and the round winner event sets it.
- **App icon** — gold enamel hexagon with a question mark, matching the Hex29A app family: `favicon.svg`, 192/512 PNG icons and an opaque 180 px `apple-touch-icon.png` for iOS home screens.
- **Lobby cover** — the players' lobby shows the quiz cover image and text and greets the player by name.
- **Image shrinking** — admin uploads are resized in the browser to at most 1920 px and saved as WebP (keeps transparency for logos). A 2.6 MB photo becomes about 200 kB, which matters on crowded party wifi.
- **Upload fix** — uploads from a quiz admin page send the quiz admin token, so they no longer require the admin login cookie.
- **One-tap answers** — single choice and true/false answers are sent on tap; the Submit and Change answer buttons are gone for those types. Tapping another option changes the answer while time remains (and re-times it). Multiple choice, text and multi-part keep the Submit button.
- **Configurable pacing** — per-quiz seconds for the get ready, correct answer and round winner screens (2–30 s, defaults 5/5/4) in a new Pacing box on the admin page. Stored in `quiz.get_ready_seconds`, `reveal_seconds` and `winner_seconds`; NULL falls back to the engine defaults.
- **Image preload** — `session:get_ready` (and the polled state during get ready) carries `preloadImageUrl`, so phones cache the question image before the speed-scored answer clock starts.
- **Shorter round winner** — the round winner splash shows for 4 s instead of 10.
- **Quiz cover on the display** — optional image and text per quiz on the big screen's waiting view, with the QR code in its own column so the image is never covered.
- **Scoreboard toggle** — "Show scoreboard between questions" (default on). When off, the correct answer and round winner still show, but the running standings are skipped and left out of the polled state until the quiz ends.
