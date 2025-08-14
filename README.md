# Inworld Runtime App Template - Language Learning

This is a Node.js app where you can learn both Spanish (through conversation and flashcard studying) as well as a demonstration of the Inworld Runtime Node.js SDK. We call it "Aprendemo" as "Aprender" is Spanish for "to learn" and it's a demo of Inworld Runtime. Use it as a template to start your own project or submit a PR!

![App](screenshot.jpg)

<p align="center">
  <a href="https://www.youtube.com/watch?v=D58lVf55duI&list=PLs_RyYO6XhFvYZO7Y-_0f3_uAhNLpvIBK&index=1"><strong>Tutorial Videos</strong></a> ·
  <a href="https://docs.inworld.ai/docs/node/installation"><strong>Read Docs</strong></a> ·
  <a href="https://inworld.ai/runtime"><strong>Get Runtime</strong></a> ·
  <a href="https://docs.inworld.ai/docs/models#llm"><strong>Model Providers</strong></a>
</p>

## Requirements

- Inworld Runtime
- Node.js v22.14.0

## Setup

1. Copy your Base64 API key from the Inworld Portal
2. Put it in the `.env` file in the root of the package
3. Add the following line to the `.env` file:
   ```
   INWORLD_API_KEY=<your_api_key>
   ```
4. Run `npm install`
5. Run the app with `npm run dev` (for development) or `npm start` (for production)
