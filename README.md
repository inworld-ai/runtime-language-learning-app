# Aprendemo

"Aprender" is Spanish for "learn". This is a simple Node.js app where you can learn both Spanish (through conversation and flashcard studying) as well as the Inworld Runtime.

## Setup

1. Grab your Base64 API key from the Inworld Portal
2. Put it in the `.env` file in the root of the package
3. Run `npm install`
4. Run the app with `npm run dev`

## TODOs

- [ ] Improve the conversation graph
    - [ ] Improve prompt templating for instructions and history
    - [ ] Add text to speech
- [ ] Create the flashcard graph
    - [ ] Based on the conversation, we will create flashcards with:
        - [ ] Word
        - [ ] Translation
        - [ ] Example sentence
        - [ ] Mnemonic
- [ ] Create an ANKI exporter
