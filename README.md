# Air Doodle

Draw a simple shape in the air with your finger in front of your webcam and get a cute vector version of it.
Plain HTML, CSS and JavaScript. No build step, no backend, no accounts.

## Run it

Open `index.html` in a browser (Chrome, Edge, Safari or Firefox). Or serve the folder:

    python3 -m http.server 8000

## Host on GitHub Pages

Push this folder to a repo, then Settings > Pages > Deploy from branch > `main` / root.
The camera needs HTTPS, which GitHub Pages provides.

## How it works

- `app.js`: camera and mouse drawing, pinch detection, smoothing, recent drawings, sharing
- `recognizer.js`: $1 Unistroke Recognizer with generated templates (no AI calls)
- `shapes.js`: the hand-made cute SVG art
- Hand tracking: MediaPipe Tasks Vision HandLandmarker, loaded from jsDelivr and Google storage on demand
- Shapes: circle, heart, wave, swirl, star, triangle, square, zigzag

Nothing is recorded or uploaded. Recent drawings live in your browser's localStorage.
