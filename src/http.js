// -----------------------------------------------------------------------------
// The one HTTP helper of the integration: GET a JSON document from
// NOAA CO-OPS, with a timeout and an identifying User-Agent. The service is
// keyless: no header ever carries a secret. CO-OPS answers "no data for this
// station" with an HTTP 400 and a JSON `{ error: { message } }`: the message is
// kept on the error (`apiMessage`) so the caller can tell it from an outage.
// -----------------------------------------------------------------------------

export const USER_AGENT =
  'gladys-noaa-tides (Gladys Assistant integration; +https://github.com/guim31/gladys-noaa-tides)';

export class HttpError extends Error {
  /**
   * @param {string} message
   * @param {number|null} status HTTP status, null for a network error or a bad body
   */
  constructor(message, status = null, apiMessage = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

/**
 * GET `url` and parse its JSON body.
 * @param {Function} fetchImpl fetch
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<unknown>}
 */
export async function getJson(fetchImpl, url, { timeoutMs = 30000 } = {}) {
  const host = new URL(url).host;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason =
      err?.name === 'TimeoutError' ? `no answer in ${timeoutMs / 1000} s` : err.message;
    throw new HttpError(`${host}: ${reason}`);
  }
  const text = await response.text();
  if (response.status !== 200) {
    let apiMessage = null;
    try {
      apiMessage = JSON.parse(text)?.error?.message ?? null;
    } catch {
      // An HTML error page: no message of the API.
    }
    throw new HttpError(`${host}: HTTP ${response.status}`, response.status, apiMessage);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`${host}: the answer is not JSON`, response.status);
  }
}
