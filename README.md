# RoutineX

An interactive, animated routine timer with voice announcements, auto-triggered profiles, and persistent scheduling.

## Features
- Multiple routine profiles (Morning, Night, Custom) with create/rename/delete/switch
- Text-to-speech announcements (Web Speech API)
- Pre-task voice reminder 10 seconds before the current task ends
- Auto-start routines at scheduled times (05:00 Morning, 22:00 Night) with gentle alarm
- Animated circular progress indicator
- Calm animated background
- Persistent data storage in `localStorage`
- Task Button to add new tasks + drag-and-drop reordering

## Quick Start
1. **Download or clone** this repository.
2. Open `index.html` directly in your browser — no build step required.
3. (Optional) Customize routine times or defaults in `script.js`.
4. Deploy to **GitHub Pages** by pushing to a public repo and enabling Pages.

## Tech Stack
- HTML, CSS, JavaScript (Vanilla)
- Web Speech API for TTS
- Audio API (HTML `<audio>`) for alarms
- `localStorage` for persistence

## File Structure
```
RoutineX/
├─ index.html
├─ style.css
├─ script.js
├─ README.md
├─ LICENSE
└─ assets/
   └─ chime.wav
```

## Accessibility Notes
- The progress graphic has a descriptive `aria-label`.
- Live regions announce “Next up” updates.
- All actions are reachable via buttons and dialogs.

## License
MIT — see `LICENSE` for details.
