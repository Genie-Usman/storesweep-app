const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_DELAY_MS = 250;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Wait for an asynchronous Shopify Admin API job to finish. */
export async function waitForShopifyJob(
  admin,
  jobId,
  {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    delayMs = DEFAULT_DELAY_MS,
    wait = delay,
  } = {},
) {
  if (!jobId) return;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await admin.graphql(
      `#graphql
        query StoreSweepJobStatus($id: ID!) {
          job(id: $id) {
            done
          }
        }
      `,
      { variables: { id: jobId } },
    );
    const payload = await response.json();

    if (payload.errors?.length) {
      throw new Error(
        `Checking Shopify job failed: ${payload.errors
          .map((error) => error.message)
          .join("; ")}`,
      );
    }

    if (!payload.data?.job) {
      throw new Error("Shopify could not find the theme-file write job.");
    }

    if (payload.data.job.done) return;
    if (attempt < maxAttempts - 1) await wait(delayMs);
  }

  throw new Error("Shopify timed out while writing the theme file.");
}
