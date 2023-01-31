import {IndexerConfig} from "../types/configs";
import {APIClient} from "@greymass/eosio";
import axios, {AxiosInstance} from "axios";
import axiosRetry from 'axios-retry';

import {createPool, DatabasePool} from "slonik";
import {
    createQueryLoggingInterceptor
} from 'slonik-interceptor-query-logging';

import { makeRetryFetch, sleep } from "../util/utils";
import { createLogger } from "../util/logger";
import TokenPoller from "./jobs/token/TokenPoller";
import VotePoller from "./jobs/voting/VoterPoller";
import * as https from "https"

const RUN_LOOP_SLEEP = 1000;
const logger = createLogger('Indexer', 'indexer');

export default class Indexer {

    public config: IndexerConfig;
    public antelopeCore: APIClient;
    public hyperion: AxiosInstance;
    public dbPool: DatabasePool | undefined;
    private tokenPoller: TokenPoller;
    private voterPoller: VotePoller;

    private constructor(config: IndexerConfig) {

        const fetch = makeRetryFetch({delay: config.fetchRetryDelay, attempts: config.fetchRetryCount, silent: false});
        axiosRetry(axios, { retries: config.fetchRetryCount,  retryDelay: (retryCount: number) => { return (retryCount - 1) * config.fetchRetryDelay; }});

        this.antelopeCore = new APIClient({"url": config.nodeosUrl, fetch});
        this.hyperion = axios.create({
            baseURL: config.hyperionUrl,
            httpsAgent: new https.Agent({ keepAlive: true }),
        });
        this.config = config;

        // must happen last, jobs may use the above in constructors
        this.tokenPoller = new TokenPoller(this);
        this.voterPoller = new VotePoller(this);
    }

    static async create(config: IndexerConfig) {
        const indexer: Indexer = new Indexer(config);
        const created = await indexer.createDbPool();
        if(!created) throw 'Could not create database pool, aborting...';
        return indexer;
    }


    private async createDbPool() {
        const {dbHost, dbName, dbUser, dbPass, dbPort} = this.config;
        const interceptors = [
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            createQueryLoggingInterceptor()
        ];

        // TODO: configure this or just disable in production code
        // const opts = {interceptors};
        logger.debug(`Creating db pool with max size: ${this.config.dbMaximumPoolSize} & retries limit: ${this.config.dbConnectionRetries}`);
        const opts = {
            maximumPoolSize: this.config.dbMaximumPoolSize,
            minimumPoolSize: 1,
            connectionRetryLimit: this.config.dbConnectionRetries,
            connectionTimeout: this.config.dbConnectionTimeout,
            idleTimeout: 100,
        };

        try {
            const connectionString = `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;
            this.dbPool = await createPool(connectionString, opts);
            return true;
        } catch (e) {
            logger.error(`Failed creating db pool: ${e}`);
        }
        return false;
    }

    async run() {
        await this.initAll();
        while (true) {
            try {
                await this.runAll();
            } catch (e) {
                logger.error(`Error in run loop : ${e}`);
            }
            await sleep(RUN_LOOP_SLEEP);
        }
    }

    private async initAll() {
        await this.tokenPoller.init();
    }

    private async runAll() {
        await this.tokenPoller.run();
        await this.voterPoller.run();
    }

}
