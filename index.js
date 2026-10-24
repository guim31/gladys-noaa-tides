// -----------------------------------------------------------------------------
// Entry point: the SDK reads GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR from the environment the supervisor gives the
// container. Every handler lives in src/app.js.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys);

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}, stopping`);
  await app.stop();
});

logger.info('Starting the NOAA Tides integration');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
