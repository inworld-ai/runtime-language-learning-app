# Aprendemo

"Aprender" is Spanish for "learn". This is a simple Node.js app where you can learn both Spanish (through conversation and flashcard studying) as well as a demonstration of the Inworld Runtime Node.js SDK.

## TODOs

- [ ] Conversation
    - [x] VAD
    - [x] STT
    - [ ] Prompt
    - [ ] LLM
    - [ ] TTS
- [ ] Flashcards
    - [ ] Prompt
    - [ ] LLM

## Requirements

- Inworld Runtime
- Node.js v22.14.0

## Setup

1. Grab your Base64 API key from the Inworld Portal
2. Put it in the `.env` file in the root of the package
3. Run `npm install`
4. Run the app with `npm run dev` (for development) or `npm start` (for production)