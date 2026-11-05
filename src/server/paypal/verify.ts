/** Strict mode requires the PayPal transmission headers. `off` is refused in production. */
export function webhookAuthorized(input: {
  verify: "strict" | "off";
  nodeEnv: string;
  webhookId?: string;
  transmissionId: string | null;
  transmissionSig: string | null;
  transmissionTime: string | null;
}): boolean {
  if (input.verify === "off") return input.nodeEnv !== "production";
  return Boolean(
    input.webhookId && input.transmissionId && input.transmissionSig && input.transmissionTime,
  );
}
