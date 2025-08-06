
# Character Chat Application

This README guides you through setting up and running the Character Chat application, which demonstrates a simple chat interface with an AI agent that can respond to text and voice inputs.

## Prerequisites

- Node.js 18 or higher

## Project Structure

The application consists of two main components:

- **server**: Handles communication with Inworld's LLM, STT, and TTS services

- **client**: Provides a user interface for interacting with the AI agent

## Setup

### Environment Variables

Copy `server/.env-sample` to `server/.env` and fill all required variables. Some variables are optional and can be left empty. In this case default values will be used.

### Install Dependencies and run the application

Install dependencies for both server and client:

```bash
# Install server dependencies
cd server
yarn install

# Make sure to manually install the Inworld Runtime for the server application. It is not included by default

# Start the server
yarn start
```

The server will start on port 4000.

```bash
# Install client dependencies
cd ../client
yarn install
yarn start
```

The client will start on port 3000 and should automatically open in your default browser. It's possible that port 3000 is already in use, so the next available port will be used.

## Using the Application

1. Configure the agent on the UI:

   - Enter your name.

   - Set the agent's name.

   - Provide a description for the agent.

   - Define the agent's motivation.

2. Click "Start" to begin the conversation.

3. Interact with the agent:

   - Type text in the input field and press Enter or click the send button.

   - Click the microphone icon to use voice input. You need to click the microphone icon again to stop the recording. Then you will receive a response from the agent.

   - Click the copy icon to copy the conversation to the clipboard.

## Troubleshooting

- If you encounter connection issues, ensure both server and client are running. Server should be running on port 4000 and client can be running on port 3000 or any other port.

- Don't forget to install the Inworld Runtime from the package or using link to local package for server application. Client application doesn't need to install the framework.

- Check that your API key is valid and properly set in the .env file.

- For voice input issues, ensure your browser has microphone permissions.
