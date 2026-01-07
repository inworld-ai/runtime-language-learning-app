/**
 * Embedder Configuration
 *
 * Uses Inworld's remote embedder with BAAI/bge-large-en-v1.5 model.
 * This model produces 1024-dimensional embeddings.
 */

export const embedderConfig = {
  provider: 'inworld' as const,
  modelName: 'BAAI/bge-large-en-v1.5',
  dimensions: 1024,
};
