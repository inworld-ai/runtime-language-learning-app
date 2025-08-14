# Inworld Runtime App Template - Language Learning

"Aprender" is Spanish for "learn". This is a simple Node.js app where you can learn both Spanish (through conversation and flashcard studying) as well as a demonstration of the Inworld Runtime Node.js SDK.

[Check out the tutorial videos](https://www.youtube.com/watch?v=D58lVf55duI&list=PLs_RyYO6XhFvYZO7Y-_0f3_uAhNLpvIBK&index=1) to learn the concepts and codebase. PRs are welcome!

## Requirements

- Inworld Runtime
- Node.js v22.14.0

## Setup

1. Grab your Base64 API key from the Inworld Portal
2. Create a `.env` file in the root of the package
3. Add the following line to the `.env` file:
   ```
   INWORLD_API_KEY=<your_api_key>
   ```
4. Run `npm install`
5. Run the app with `npm run dev` (for development) or `npm start` (for production)
