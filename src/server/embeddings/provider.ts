export interface EmbeddingProvider {
  /** e.g. "local-minilm-384" */
  id: string;
  /** MUST match the dims of the Elasticsearch index mapping */
  dims: number;
  /** One vector per input text, each L2-normalized (length 1). */
  embed(texts: string[]): Promise<number[][]>;
}

/** Scale a vector to length 1 so cosine similarity is just a dot product. */
export function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const x of vector) sumSquares += x * x;
  const length = Math.sqrt(sumSquares);
  if (length === 0) return vector;
  return vector.map((x) => x / length);
}

/** Dot product. For two L2-normalized vectors this is the cosine similarity. */
export function dot(a: number[], b: number[]): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) sum += a[i]! * b[i]!;
  return sum;
}
