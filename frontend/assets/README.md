# assets/

Add your E-SHIELD app icon and splash image here, then reference them in
`app.json`:

```json
"icon": "./assets/icon.png",
"splash": {
  "image": "./assets/splash.png",
  "backgroundColor": "#0B0F14",
  "resizeMode": "contain"
}
```

Suggested icon concept (per the product spec): a minimal shield outline with
a waveform line through it, using the E-SHIELD purple (#8B5CF6) on the dark
background (#0B0F14) — avoid generic "AI brain" imagery. A simple starting
version of this mark is already drawn in code as an SVG in
`src/screens/SplashScreen.js`, which you can export as a PNG (e.g. via any
SVG-to-PNG tool) to produce `icon.png` / `splash.png` quickly.
