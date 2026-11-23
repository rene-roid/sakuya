import { dot } from './vectors';

export interface ClusterNode {
  id: number;
  /** Unit length. */
  vec: Float32Array;
  characterId: number | null;
}

export interface ClusterParams {
  /** CCIP difference under which two unassigned detections link (DBSCAN eps). */
  eps: number;
  /** CCIP difference under which a detection joins a character through one of its members. */
  assignThreshold: number;
  /**
   * CCIP difference allowed between the mean embeddings of two groups for them to join. Single
   * linkage alone chains: on Pepper&Carrot pages one link at a time walked from Carrot to other
   * cats, then to houses and birds. Checking the means stops a group drifting away from itself.
   */
  mergeLimit: number;
  /** Smallest group of linked unassigned detections that becomes a new character. */
  minSamples: number;
  /** CCIP difference from the cosine of two unit vectors. */
  diff: (cosine: number) => number;
}

export interface ClusterResult {
  /** Detection id to the existing character it joins. */
  assigned: Map<number, number>;
  /** Groups of detection ids that each form a new, unnamed character. */
  created: number[][];
}

/**
 * Incremental DBSCAN with min_samples 2, which is single linkage: two detections within `eps`
 * belong together, and so does everything linked to them. Only edges touching a new detection
 * are computed, since every older pair was already found too far apart on an earlier run.
 *
 * A link only joins two groups whose mean embeddings are within `mergeLimit` too.
 *
 * Existing characters never merge here: an edge that would join two different characters is
 * skipped, and because edges are taken closest first, a detection between two characters lands
 * in the nearer one. Merging characters is a person's call (mergeCharacters).
 */
export function clusterIncrementally(nodes: ClusterNode[], newIds: Set<number>, params: ClusterParams): ClusterResult {
  const parent = nodes.map((_, i) => i);
  const label: (number | null)[] = nodes.map((n) => n.characterId);
  const size = nodes.map(() => 1);
  // Per root, the sum of its members' unit vectors; a singleton's is its own vector until it grows.
  const sum: Float32Array[] = nodes.map((n) => n.vec);
  const owned = nodes.map(() => false);
  const norm = (v: Float32Array) => Math.sqrt(dot(v, v));
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (label[ra] !== null && label[rb] !== null && label[ra] !== label[rb]) return;
    if (checkMeans && params.diff(dot(sum[ra], sum[rb]) / (norm(sum[ra]) * norm(sum[rb]))) > params.mergeLimit) return;
    if (size[ra] < size[rb]) [ra, rb] = [rb, ra];
    if (!owned[ra]) {
      sum[ra] = Float32Array.from(sum[ra]);
      owned[ra] = true;
    }
    for (let k = 0; k < sum[ra].length; k++) sum[ra][k] += sum[rb][k];
    parent[rb] = ra;
    size[ra] += size[rb];
    label[ra] ??= label[rb];
  };

  let checkMeans = false;
  const firstOfCharacter = new Map<number, number>();
  nodes.forEach((n, i) => {
    if (n.characterId === null) return;
    const first = firstOfCharacter.get(n.characterId);
    if (first === undefined) firstOfCharacter.set(n.characterId, i);
    else union(first, i);
  });

  const reach = Math.max(params.eps, params.assignThreshold);
  const edges: { a: number; b: number; d: number }[] = [];
  const isNew = nodes.map((n) => newIds.has(n.id) && n.characterId === null);
  for (let i = 0; i < nodes.length; i++) {
    if (!isNew[i]) continue;
    for (let j = 0; j < nodes.length; j++) {
      // A pair of new detections is visited once, from its lower index.
      if (j === i || (isNew[j] && j < i)) continue;
      const d = params.diff(dot(nodes[i].vec, nodes[j].vec));
      if (d > reach) continue;
      const limit = nodes[j].characterId === null ? params.eps : params.assignThreshold;
      if (d <= limit) edges.push({ a: i, b: j, d });
    }
  }
  edges.sort((x, y) => x.d - y.d);
  checkMeans = params.mergeLimit < 1;
  for (const e of edges) union(e.a, e.b);

  const assigned = new Map<number, number>();
  const groups = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    if (n.characterId !== null) return;
    const root = find(i);
    const character = label[root];
    if (character !== null) assigned.set(n.id, character);
    else {
      const group = groups.get(root);
      if (group) group.push(n.id);
      else groups.set(root, [n.id]);
    }
  });
  const created = [...groups.values()].filter((g) => g.length >= params.minSamples && g.some((id) => newIds.has(id)));
  return { assigned, created };
}
