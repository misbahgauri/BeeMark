# Beemarks

Made by teenagers, for teenagers (✿◡‿◡)

Beemarks is a note-taking web app built for students — write, draw, and organize notes in one place, right in your browser.

## Live demo

https://misbahgauri.github.io/BeeMark/

## Features

- **Rich text editor** — headings, fonts, sizes, colors, bold/italic/underline
- **Stylus drawing** — sketch or write by hand on the same page as your text
- **Inline images** — drop pictures directly into a note
- **Attachments** — attach files and 3D models (.glb, .obj, .stl) to a note
- **Page styles** — plain, lined, grid, dot-grid, or a custom background image
- **Categories** — organize notes by subject with color-coded tags
- **Search and filter** — find notes by title, content, or category
- **Works offline** — notes are saved locally in your browser (IndexedDB), no account needed

## Built with

- HTML, CSS, and vanilla JavaScript
- [Quill](https://quilljs.com/) for the rich text editor
- [Three.js](https://threejs.org/) for previewing 3D model attachments
- IndexedDB for local storage

## Running it locally

1. Download or clone this repository.
2. Open the folder in VS Code (or any editor).
3. Open `index.html` with a local server — for example, the **Live Server** extension in VS Code.
4. That's it — no build step, no install required.

## Notes

Notes are stored in your browser's IndexedDB, which means they're private to your device and browser. Clearing your browser data will also clear your notes.
