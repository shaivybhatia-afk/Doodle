# Air Doodle

Draw a simple shape in the air with your finger in front of your webcam and get a charming little character built from your own line.
Plain HTML, CSS and JavaScript. No build step, no backend, no accounts.

## Run it

Open `index.html` in a browser (Chrome, Edge, Safari or Firefox). Or serve the folder:

    python3 -m http.server 8000

## Host on GitHub Pages

Push this folder to a repo, then Settings > Pages > Deploy from branch > `main` / root.
The camera needs HTTPS, which GitHub Pages provides.

## How to play

1. Press Start, then follow the 3, 2, 1 countdown.
2. Pointer mode (default): raise only your index finger to draw, add your middle finger (peace sign) to lift.
   Pinch mode: pinch thumb and index to draw, open your fingers to lift.
3. Finish with an open palm held for one second, the Done button, or the space bar.

## Files

- `app.js`: camera and mouse drawing, gestures, Start and countdown, recent drawings, sharing
- `recognizer.js`: $1 Unistroke Recognizer with generated templates, plus the "how to draw it" guides (no AI calls)
- `art.js`: smooths your stroke and dresses it up per shape (fills, outlines, faces, extras)
- Hand tracking: MediaPipe Tasks Vision HandLandmarker, loaded from jsDelivr and Google storage on demand
- Shapes: circle, heart, star, triangle, square, diamond, wave, swirl, zigzag, cloud, moon, lightning bolt, infinity, check mark

Nothing is recorded or uploaded. Recent drawings and your mode choice live in your browser's localStorage.
