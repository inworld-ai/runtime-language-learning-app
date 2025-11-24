# Contributing to Language Learning App

Thank you for your interest in contributing to the Language Learning App! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js (v20 or higher)
- npm (v9 or higher)
- Git
- An Inworld AI account and API key

### Development Setup

1. **Fork the repository** on GitHub

2. **Clone your fork**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/language-learning-app.git
   cd language-learning-app
   ```

3. **Install dependencies**:

   ```bash
   npm install
   ```

4. **Set up environment variables**:
   Create a `.env` file in the root directory:

   ```bash
   INWORLD_API_KEY=your_api_key_here
   ```

5. **Verify the setup**:
   ```bash
   npm run build
   npm run lint
   npm run format:check
   ```

## Development Workflow

### Making Changes

1. **Create a feature branch**:

   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes** and test them locally

3. **Run code quality checks** before committing:

   ```bash
   npm run lint          # Check for linting errors
   npm run lint:fix      # Auto-fix linting issues
   npm run format        # Format code with Prettier
   npm run format:check  # Verify formatting
   npm run type-check    # Check TypeScript types
   npm run build         # Ensure code compiles
   ```

4. **Commit your changes**:

   ```bash
   git add .
   git commit -m "Your descriptive commit message"
   ```

   Write clear, descriptive commit messages that explain what and why you changed something.

## Code Style

### TypeScript

- Use TypeScript strict mode
- Provide explicit types for function parameters and return values
- Avoid `any` types - use `unknown` or proper types instead
- Follow the existing code style and patterns
- This project uses ESM modules (`type: "module"`)

### Formatting

- Code is automatically formatted with Prettier
- Run `npm run format` before committing
- Maximum line length: 80 characters
- Use single quotes for strings
- Use semicolons

### Linting

- ESLint is configured with TypeScript support
- All linting errors must be resolved before submitting a PR
- Run `npm run lint:fix` to auto-fix issues where possible
- Frontend JavaScript files are excluded from linting

### File Structure

```
language-learning-app/
├── backend/              # Backend TypeScript code
│   ├── graphs/           # Graph definitions
│   ├── helpers/          # Helper utilities
│   ├── models/           # AI models
│   └── server.ts         # Backend server
├── frontend/             # Frontend application (JavaScript)
│   ├── js/               # Frontend JavaScript
│   ├── styles/           # CSS styles
│   └── index.html        # Main HTML file
└── dist/                 # Compiled JavaScript (generated)
```

## Pull Request Process

1. **Update your fork**:

   ```bash
   git checkout main
   git pull upstream main
   git push origin main
   ```

2. **Create your PR**:
   - Push your branch to your fork
   - Open a Pull Request on GitHub
   - Fill out the PR template (if available)
   - Link any related issues

3. **PR Requirements**:
   - All tests pass (if applicable)
   - Code follows style guidelines
   - Linting passes (`npm run lint`)
   - Type checking passes (`npm run type-check`)
   - Build succeeds (`npm run build`)
   - Documentation is updated if needed

4. **Code Review**:
   - Address any feedback from reviewers
   - Keep your PR focused on a single change
   - Keep commits clean and logical

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Environment details (Node.js version, OS, etc.)
- Relevant code snippets or error messages

### Feature Requests

For feature requests, please include:

- A clear description of the feature
- Use case and motivation
- Proposed implementation approach (if you have one)

## Questions?

- **GitHub Issues**: [Open an issue](https://github.com/inworld-ai/language-learning-app/issues)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
