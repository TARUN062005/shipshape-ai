/** Remove known server secrets from model text and logs. Short values are ignored. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length < 8) continue;
    result = result.split(trimmed).join("[redacted]");
  }
  return result;
}
