const THEME_LIQUID_FILENAME = "layout/theme.liquid";
const THEME_LIQUID_BACKUP_FILENAME =
  "layout/theme-storesweep-backup.liquid";
const BACKUP_MARKER = "-storesweep-backup.";

/** Files Shopify stores as text; binary assets are never scanned or written. */
const TEXT_FILE_EXTENSIONS = [".liquid", ".json"];
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;

export function isTextThemeFile(filename) {
  return (
    typeof filename === "string" &&
    TEXT_FILE_EXTENSIONS.some((extension) => filename.endsWith(extension))
  );
}

export function isStoresweepBackupFile(filename) {
  return typeof filename === "string" && filename.includes(BACKUP_MARKER);
}

/** sections/header.liquid -> sections/header-storesweep-backup.liquid */
export function backupFilenameFor(filename) {
  const separatorIndex = filename.lastIndexOf("/");
  const directory = separatorIndex === -1 ? "" : filename.slice(0, separatorIndex + 1);
  const base = filename.slice(separatorIndex + 1);
  const dotIndex = base.lastIndexOf(".");
  const stem = dotIndex === -1 ? base : base.slice(0, dotIndex);
  const extension = dotIndex === -1 ? "" : base.slice(dotIndex);
  return `${directory}${stem}${BACKUP_MARKER.slice(0, -1)}${extension}`;
}

export function originalFilenameForBackup(backupFilename) {
  const separatorIndex = backupFilename.lastIndexOf("/");
  const directory = separatorIndex === -1 ? "" : backupFilename.slice(0, separatorIndex + 1);
  const base = backupFilename.slice(separatorIndex + 1);
  const markerIndex = base.indexOf(BACKUP_MARKER.slice(0, -1));
  const stem = base.slice(0, markerIndex);
  const extension = base.slice(markerIndex + BACKUP_MARKER.length - 1);
  return `${directory}${stem}${extension}`;
}

const RETRYABLE_MAX_ATTEMPTS = 4;
const RETRYABLE_BASE_DELAY_MS = 500;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function isThrottledPayload(payload, status) {
  return (
    status === 429 ||
    Boolean(
      payload?.errors?.some(
        (error) => error.extensions?.code === "THROTTLED",
      ),
    )
  );
}

/**
 * Run an Admin GraphQL call, retrying Shopify cost throttling with
 * exponential backoff. Large-theme scans issue many queries in sequence
 * and would otherwise fail midway on a busy store.
 */
export async function graphqlWithRetry(
  admin,
  query,
  options,
  { maxAttempts = RETRYABLE_MAX_ATTEMPTS, backoffMs = RETRYABLE_BASE_DELAY_MS, wait = delay } = {},
) {
  let attempt = 0;

  for (;;) {
    const response = await admin.graphql(query, options);
    const payload = await response.json();

    if (
      isThrottledPayload(payload, response.status) &&
      attempt < maxAttempts - 1
    ) {
      attempt += 1;
      await wait(backoffMs * 2 ** (attempt - 1));
      continue;
    }

    return payload;
  }
}

function getGraphqlData(payload, operationName) {
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

function assertNoFileReadErrors(userErrors, operationName) {
  if (!userErrors?.length) return;

  const message = userErrors
    .map(({ code, filename }) =>
      filename ? `${filename}: ${code}` : code,
    )
    .join("; ");

  throw new Error(`${operationName} failed: ${message}`);
}

/**
 * Find the currently published theme. Pass the `admin` client returned by
 * `await authenticate.admin(request)`.
 */
export async function getMainThemeId(admin) {
  return (await getMainTheme(admin)).id;
}

export async function getMainTheme(admin) {
  const data = await getGraphqlData(
    await graphqlWithRetry(admin, `#graphql
    query StoreSweepMainTheme {
      themes(first: 1, roles: [MAIN]) {
        nodes {
          id
          name
        }
      }
    }
  `),
    "Fetching the live theme",
  );
  const theme = data.themes?.nodes?.[0];

  if (!theme?.id) {
    throw new Error("No published theme was found for this store.");
  }

  return theme;
}

/**
 * Fetch one theme file's text content. Returns null when the file does not
 * exist or is not stored as text.
 */
export async function getThemeTextFile(admin, themeId, filename) {
  const data = await getGraphqlData(
    await graphqlWithRetry(
      admin,
      `#graphql
      query StoreSweepThemeFile($themeId: ID!, $filenames: [String!]!) {
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
              code
              filename
            }
          }
        }
      }
    `,
      {
        variables: {
          themeId,
          filenames: [filename],
        },
      },
    ),
    `Fetching ${filename}`,
  );
  if (!data.theme) throw new Error("The published theme no longer exists.");

  assertNoFileReadErrors(
    data.theme.files?.userErrors,
    `Fetching ${filename}`,
  );

  const file = data.theme.files?.nodes?.find(
    (candidate) => candidate.filename === filename,
  );

  return typeof file?.body?.content === "string" ? file.body.content : null;
}

/** Fetch the raw text stored in layout/theme.liquid. */
export async function getThemeLiquid(admin, themeId) {
  const resolvedThemeId = themeId || (await getMainThemeId(admin));
  const content = await getThemeTextFile(
    admin,
    resolvedThemeId,
    THEME_LIQUID_FILENAME,
  );

  if (content === null) {
    throw new Error(
      `${THEME_LIQUID_FILENAME} was not found or is not a text file.`,
    );
  }

  return content;
}

/**
 * Page through every theme file and return the scannable text files:
 * `[{ filename, content }]`. Files larger than MAX_TEXT_FILE_BYTES and
 * StoreSweep's own backups are excluded.
 */
export async function listThemeTextFiles(
  admin,
  themeId,
  { pageSize = 100, maxFiles = 2000 } = {},
) {
  const files = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    if (files.length > maxFiles) {
      throw new Error(
        "This theme has more files than StoreSweep can scan in one pass.",
      );
    }

    const data = await getGraphqlData(
      await graphqlWithRetry(
        admin,
        `#graphql
        query StoreSweepThemeFiles($themeId: ID!, $first: Int!, $after: String) {
          theme(id: $themeId) {
            files(first: $first, after: $after) {
              nodes {
                filename
                body {
                  ... on OnlineStoreThemeFileBodyText {
                    content
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
              userErrors {
                code
                filename
              }
            }
          }
        }
      `,
        {
          variables: { themeId, first: pageSize, after },
        },
      ),
      "Listing theme files",
    );
    if (!data.theme) throw new Error("The published theme no longer exists.");

    assertNoFileReadErrors(
      data.theme.files?.userErrors,
      "Listing theme files",
    );

    for (const file of data.theme.files?.nodes || []) {
      if (
        typeof file.body?.content === "string" &&
        isTextThemeFile(file.filename) &&
        !isStoresweepBackupFile(file.filename) &&
        Buffer.byteLength(file.body.content, "utf8") <= MAX_TEXT_FILE_BYTES
      ) {
        files.push({ filename: file.filename, content: file.body.content });
      }
    }

    hasNextPage = Boolean(data.theme.files?.pageInfo?.hasNextPage);
    after = data.theme.files?.pageInfo?.endCursor ?? null;
  }

  return files;
}

async function upsertThemeTextFile(admin, themeId, filename, content) {
  if (typeof content !== "string") {
    throw new TypeError("Theme file content must be a string.");
  }

  const data = await getGraphqlData(
    await graphqlWithRetry(
      admin,
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
    ),
    `Writing ${filename}`,
  );
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

/** Save an original file as <name>-storesweep-backup next to it. */
export async function backupThemeFile(admin, themeId, filename, content) {
  const source =
    typeof content === "string"
      ? content
      : await getThemeTextFile(admin, themeId, filename);

  if (source === null) {
    throw new Error(`${filename} was not found or is not a text file.`);
  }

  return upsertThemeTextFile(
    admin,
    themeId,
    backupFilenameFor(filename),
    source,
  );
}

/** Save theme.liquid as layout/theme-storesweep-backup.liquid. */
export async function backupThemeLiquid(admin, themeId, content) {
  return backupThemeFile(admin, themeId, THEME_LIQUID_FILENAME, content);
}

/** Overwrite layout/theme.liquid. Call backupThemeLiquid first. */
export async function updateThemeLiquid(admin, themeId, content) {
  return upsertThemeTextFile(admin, themeId, THEME_LIQUID_FILENAME, content);
}

export {
  upsertThemeTextFile as writeThemeFile,
  THEME_LIQUID_BACKUP_FILENAME,
  THEME_LIQUID_FILENAME,
};
