# Daily Smart Current Affairs

AI-powered current affairs prototype for UPSC, SSC, NDA, CDS, PCS, Banking, and similar government-exam preparation.

## What this prototype includes

- Weekly top news homepage with exam-wise filtering
- AI quick brief and AI teacher flow
- Hindi / English / Hinglish explanation support
- PYQ-inspired prediction layer
- Rolling news update pipeline
- Dedicated feed, predictor, login placeholder, and dashboard pages

## Tech

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js (`server.mjs`)
- AI: Gemini API

## Run locally

1. Copy `.env.example` to `.env`
2. Fill in your API keys
3. Start the server:

```bash
node server.mjs
```

4. Open:

```txt
http://127.0.0.1:8010/
```

## Deploy on Render

1. Sign in to [Render](https://render.com/)
2. Click **New +**
3. Choose **Blueprint**
4. Connect this GitHub repo:
   `https://github.com/keshavchauhan15482-byte/daily-current-affairs-.git`
5. Render will detect `render.yaml`
6. Add these environment variables in Render before deploy:
   - `GEMINI_API_KEY`
   - `ELEVENLABS_API_KEY` (optional)
   - `ELEVENLABS_VOICE_MALE` (optional)
   - `ELEVENLABS_VOICE_FEMALE` (optional)
7. Click **Apply**

If you skip the voice keys, the site still deploys, but external voice features will not work.

## Files intentionally excluded from the public repo

- `.env`
- local PDF / OCR cache
- generated temp audio files

## Prototype note

This repo is prepared for hackathon/demo review, so it keeps the working prototype code while excluding sensitive keys and bulky local cache files.
