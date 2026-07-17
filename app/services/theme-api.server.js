const THEME_LIQUID_FILENAME = "layout/theme.liquid";
const THEME_LIQUID_BACKUP_FILENAME =
  "layout/theme-storesweep-backup.liquid";

async function getGraphqlData(response, operationName) {
  const payload = await response.json();

  if (payload.errors?.length) {
    const message = payload.errors.map((error) => error.message).join("; ");
    throw new Error(`${operationName} failed: ${message}`);
  }

  if (!payload.data) {
    throw new Error(`${operationName} failed: Shopify returned no data.`);
  }

  return payload.data;
}

function assertNoUserErrors(userErrors, operationName) {
  if (!userErrors?.length) return;

  const message = userErrors
    .map(({ field, filename, message: errorMessage }) => {
      const location = field?.length ? field.join(".") : filename;
      return location ? `${location}: ${errorMessage}` : errorMessage;
    })
    .join("; ");

  throw new Error(`${operationName} failed: ${message}`);
}

/**
 * Find the currently published theme. Pass the `admin` client returned by
 * `await authenticate.admin(request)`.
 */
export async function getMainThemeId(admin) {
  const response = await admin.graphql(`#graphql
    query StoreSweepMainTheme {
      themes(first: 1, roles: [MAIN]) {
        nodes {
          id
        }
      }
    }
  `);

  const data = await getGraphqlData(response, "Fetching the live theme");
  const themeId = data.themes?.nodes?.[0]?.id;

  if (!themeId) {
    throw new Error("No published theme was found for this store.");
  }

  return themeId;
}

/** Fetch the raw text stored in layout/theme.liquid. */
export async function getThemeLiquid(admin, themeId) {
  const resolvedThemeId = themeId || (await getMainThemeId(admin));
  const response = await admin.graphql(
    `#graphql
      query StoreSweepThemeLiquid($themeId: ID!, $filenames: [String!]!) {
        theme(id: $themeId) {
          files(first: 1, filenames: $filenames) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
            userErrors {
              filename
              message
            }
          }
        }
      }
    `,
    {
      variables: {
        themeId: resolvedThemeId,
        filenames: [THEME_LIQUID_FILENAME],
      },
    },
  );

  const data = await getGraphqlData(response, "Fetching theme.liquid");
  if (!data.theme) throw new Error("The published theme no longer exists.");

  assertNoUserErrors(data.theme.files?.userErrors, "Fetching theme.liquid");

  const file = data.theme.files?.nodes?.find(
    ({ filename }) => filename === THEME_LIQUID_FILENAME,
  );
  const content = file?.body?.content;

  if (typeof content !== "string") {
    throw new Error(
      `${THEME_LIQUID_FILENAME} was not found or is not a text file.`,
    );
  }

  return content;
}

async function upsertThemeTextFile(admin, themeId, filename, content) {
  if (typeof content !== "string") {
    throw new TypeError("Theme file content must be a string.");
  }

  const response = await admin.graphql(
    `#graphql
      mutation StoreSweepUpsertThemeFile(
        $themeId: ID!
        $files: [OnlineStoreThemeFilesUpsertFileInput!]!
      ) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          job {
            id
          }
          upsertedThemeFiles {
            filename
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        themeId,
        files: [
          {
            filename,
            body: { type: "TEXT", value: content },
          },
        ],
      },
    },
  );

  const data = await getGraphqlData(response, `Writing ${filename}`);
  const result = data.themeFilesUpsert;
  assertNoUserErrors(result?.userErrors, `Writing ${filename}`);

  const upsertedFilename = result?.upsertedThemeFiles?.[0]?.filename;
  if (!upsertedFilename && !result?.job?.id) {
    throw new Error(`Writing ${filename} failed: Shopify accepted no file.`);
  }

  return {
    filename: upsertedFilename || filename,
    jobId: result?.job?.id || null,
  };
}

/** Save theme.liquid as layout/theme-storesweep-backup.liquid. */
export async function backupThemeLiquid(admin, themeId, content) {
  const source =
    typeof content === "string"
      ? content
      : await getThemeLiquid(admin, themeId);

  return upsertThemeTextFile(
    admin,
    themeId,
    THEME_LIQUID_BACKUP_FILENAME,
    source,
  );
}

/** Overwrite layout/theme.liquid. Call backupThemeLiquid first. */
export async function updateThemeLiquid(admin, themeId, content) {
  return upsertThemeTextFile(
    admin,
    themeId,
    THEME_LIQUID_FILENAME,
    content,
  );
}

export { THEME_LIQUID_BACKUP_FILENAME, THEME_LIQUID_FILENAME };
