# الملقّن العربي — Arabic Prompter for Even G2

Teleprompter for Even Realities G2 that displays Arabic. The G2 firmware font
has no Arabic glyphs, so the script is drawn on the phone (shaping + RTL done
by the WebView) and sent to the glasses as four 288x144 images.

## Run / install

    npm install
    npm run dev            # then: npx evenhub qr --url "http://<your-ip>:5173"  and scan from the Even app
    npm run pack           # builds arabic-prompter.ehpk

Install on your own glasses without store review:

    npx evenhub login
    npx evenhub create arabic-prompter.ehpk --name "Arabic Prompter" --tagline "Arabic teleprompter" --icon icon.png
    npx evenhub testers add <your Even account email>
    npx evenhub promote 1.0.0 --to beta
    # phone: Even Realities app -> Me -> Beta tester -> Install

`package_id` in app.json must be unique on Even Hub; change it if it is taken.

## Controls (glasses touchpad or R1 ring)

- Swipe down: next page. Swipe up: previous page.
- Tap: next page (manual) or pause/resume (auto run).
- Double tap: exit.

Not yet verified on real hardware or in the official simulator.
