import {IndexerConfig} from "../types/configs";
import {createQueryLoggingInterceptor} from "slonik-interceptor-query-logging";
import {createPool} from "slonik";
import {createLogger} from "../util/logger";
const logger = createLogger('Database utils');

export const createDbPool = async(config: IndexerConfig) => {
    const {dbHost, dbName, dbUser, dbPass, dbPort} = config;
    let opts;
    if(config.mode === 'dev'){
        logger.debug(`Creating db pool with query logging interceptors...`);
        const interceptors = [
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            createQueryLoggingInterceptor(),
        ];
        opts = {interceptors};
    } else {
        logger.debug(`Creating db pool with max pool size: ${config.dbMaximumPoolSize} & retries limit: ${config.dbConnectionRetries}...`);
        opts = {
            maximumPoolSize: config.dbMaximumPoolSize,
            connectionRetryLimit: config.dbConnectionRetries,
            connectionTimeout: config.dbConnectionTimeout,
            transactionRetryLimit: config.dbConnectionRetries,
            idleTimeout: 30000,
        };
    }

    try {
        const connectionString = `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;
        const dbPool = await createPool(connectionString, opts);
        return dbPool;
    } catch (e) {
        logger.error(`Failed creating db pool`, e);
    }
}