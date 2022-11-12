import {IndexerConfig} from "../types/configs";
import {APIClient} from "@greymass/eosio";
import axios, {AxiosInstance} from "axios";

import {createPool, DatabasePool} from "slonik";
import {
    createQueryLoggingInterceptor
} from 'slonik-interceptor-query-logging';

import {makeRetryFetch, sleep} from "../util/utils";
import {createLogger} from "../util/logger";
import TokenPoller from "./jobs/token/TokenPoller";
import VotePoller from "./jobs/voting/VoterPoller";

const RUN_LOOP_SLEEP = 1000;
const logger = createLogger('Indexer')

export default class Indexer {

    public config: IndexerConfig;
    public antelopeCore: APIClient;
    public hyperion: AxiosInstance;
    public dbPool: DatabasePool | undefined;
    //private tokenPoller: TokenPoller;
    private voterPoller: VotePoller;

    private constructor(config: IndexerConfig) {
        this.config = config;
        const fetch = makeRetryFetch({delay: 1000, attempts: 100, silent: false})
        this.antelopeCore = new APIClient({"url": this.config.nodeosUrl, fetch});
        this.hyperion = axios.create({
            baseURL: this.config.hyperionUrl
        });

        // must happen last, jobs may use the above in constructors
        //this.tokenPoller = new TokenPoller(this);
        this.voterPoller = new VotePoller(this);
    }

    static async create(config: IndexerConfig) {
        const indexer: Indexer = new Indexer(config);
        await indexer.createDbPool();
        return indexer;
    }


    private async createDbPool() {
        const {dbHost, dbName, dbUser, dbPass, dbPort} = this.config;
        const interceptors = [
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            createQueryLoggingInterceptor()
        ];

        // TODO: configure this or just disable in production code
        //const opts = {interceptors};
        const opts = {};

        try {
            const connectionString = `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;
            this.dbPool = await createPool(connectionString, opts);
        } catch (e) {
            logger.error(`Failed creating db pool`, e);
        }
    }

    async run() {
        await this.initAll()
        while (true) {
            try {
                await this.runAll()
            } catch (e) {
                logger.error(`Error in run loop`, e)
            }
            await sleep(RUN_LOOP_SLEEP)
        }
    }

    private async initAll() {
        //await this.tokenPoller.init();
    }

    private async runAll() {
        //await this.tokenPoller.run();
        await this.voterPoller.run();
    }

}
