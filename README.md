# Inworld Language Tutor

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Powered by Inworld AI](https://img.shields.io/badge/Powered_by-Inworld_AI-orange)](https://inworld.ai/runtime)
[![Documentation](https://img.shields.io/badge/Documentation-Read_Docs-blue)](https://docs.inworld.ai/docs/node/overview)
[![Model Providers](https://img.shields.io/badge/Model_Providers-See_Models-purple)](https://docs.inworld.ai/docs/models#llm)

A Node.js app where you can learn languages through conversation and flashcard studying, powered by Inworld AI Runtime. This is a demonstration of the Inworld Runtime Node.js SDK.

![App](screenshot.jpg)

## Prerequisites

- Node.js (v20 or higher)
- An Inworld AI account and API key
- An Assembly AI account and API key

## Get Started

### Step 1: Clone the Repository

```bash
git clone https://github.com/inworld-ai/language-learning-node
cd language-learning-node
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

Create a `.env` file in the root directory:

```bash
INWORLD_API_KEY=your_api_key_here
ASSEMBLY_AI_API_KEY=your_api_key_here
```

Get your Inworld Base64 API key from the [Inworld Portal](https://platform.inworld.ai/).

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `INWORLD_API_KEY` | Your Inworld AI API key (Base64 encoded) from the [Inworld Portal](https://platform.inworld.ai/) |
| `ASSEMBLY_AI_API_KEY` | Your Assembly AI API key for speech-to-text |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port number |
| `LOG_LEVEL` | `info` | Logging level. Options: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `NODE_ENV` | `development` | Environment mode. Set to `production` for JSON logs (no pretty-printing) |
| `ASSEMBLY_AI_EAGERNESS` | `medium` | Turn detection sensitivity for speech-to-text. Options: `low` (conservative, allows thinking pauses), `medium` (balanced), `high` (aggressive, quick responses) |

### Step 4: Run the Application

For development:

```bash
npm run dev
```

For production:

```bash
npm run build
npm start
```

## Repo Structure

```
language-learning-node/
├── backend/
│   ├── config/               # Configuration
│   │   ├── languages.ts      # Language definitions and teacher personas
│   │   ├── llm.ts            # LLM model configuration
│   │   └── server.ts         # Server and audio settings
│   ├── graphs/               # Graph definitions
│   │   ├── nodes/            # Graph node implementations
│   │   ├── conversation-graph.ts
│   │   └── flashcard-graph.ts
│   ├── helpers/              # Helper utilities
│   │   ├── anki-exporter.ts
│   │   ├── audio-buffer.ts
│   │   ├── audio-utils.ts
│   │   ├── connection-manager.ts
│   │   ├── flashcard-processor.ts
│   │   ├── multimodal-stream-manager.ts
│   │   └── prompt-templates.ts
│   ├── types/                # TypeScript type definitions
│   ├── utils/                # Utility modules
│   │   └── logger.ts         # Structured logging (pino)
│   └── server.ts             # Backend server
├── frontend/                 # React frontend application
│   ├── public/               # Static assets
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── context/          # React context providers
│   │   ├── hooks/            # Custom React hooks
│   │   ├── services/         # Frontend services
│   │   ├── styles/           # CSS styles
│   │   └── types/            # TypeScript type definitions
│   └── index.html
├── package.json              # Dependencies
└── LICENSE                   # MIT License
```

## Troubleshooting

**Bug Reports**: [GitHub Issues](https://github.com/inworld-ai/language-learning-node/issues)

**General Questions**: For general inquiries and support, please email us at support@inworld.ai

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
