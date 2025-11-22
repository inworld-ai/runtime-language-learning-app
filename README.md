# Language Learning - Aprendemo

A Node.js app where you can learn Spanish through conversation and flashcard studying, powered by Inworld AI Runtime. "Aprendemo" combines "Aprender" (Spanish for "to learn") with "demo" - it's both a language learning tool and a demonstration of the Inworld Runtime Node.js SDK.

![App](screenshot.jpg)

<p align="center">
  <a href="https://www.youtube.com/watch?v=D58lVf55duI&list=PLs_RyYO6XhFvYZO7Y-_0f3_uAhNLpvIBK&index=1"><strong>Tutorial Videos</strong></a> ·
  <a href="https://docs.inworld.ai/docs/node/templates/language-app"><strong>Read Docs</strong></a> ·
  <a href="https://inworld.ai/runtime"><strong>Get Runtime</strong></a> ·
  <a href="https://docs.inworld.ai/docs/models#llm"><strong>Model Providers</strong></a>
</p>

## Prerequisites

- Node.js (v22.14.0 or higher)
- An Inworld AI account and API key

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
```

Get your Base64 API key from the [Inworld Portal](https://platform.inworld.ai/).

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
│   ├── graphs/               # Graph definitions
│   │   ├── conversation-graph.ts
│   │   ├── flashcard-graph.ts
│   │   └── introduction-state-graph.ts
│   ├── helpers/              # Helper utilities
│   │   ├── anki-exporter.ts
│   │   ├── audio-buffer.ts
│   │   ├── audio-processor.ts
│   │   ├── flashcard-processor.ts
│   │   ├── introduction-state-processor.ts
│   │   ├── prompt-templates.ts
│   │   └── silero-vad.ts
│   ├── models/               # AI models
│   │   └── silero_vad.onnx
│   └── server.ts             # Backend server
├── frontend/                 # Frontend application
│   ├── js/
│   ├── styles/
│   └── index.html
├── flashcard-graph.json      # Flashcard configuration
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
