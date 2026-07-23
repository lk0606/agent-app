/** 两向量的余弦相似度；维度不一致或零向量时返回 0 */
export function cosineSimilarity(left: number[], right: number[]): number {
  // 防御点勿打在此 early-return：正常检索维数一致，几乎不会进这里
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  // 断点打这里：每个 chunk 会进来一次；看 left=query 向量、right=chunk 向量
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);

  if (denominator === 0) {
    return 0;
  }

  // 或断在下一行：看最终余弦分数（如 0.4132）
  const result = dot / denominator;
  
  return result;
}
