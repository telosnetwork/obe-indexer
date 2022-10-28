import {IndexerConfig} from "../types/configs";
import TokenPoller from "./jobs/TokenPoller";
import {APIClient} from "@greymass/eosio";
import axios, {AxiosInstance} from "axios";
import {createPool, DatabasePool} from "slonik";
import {
    createQueryLoggingInterceptor
} from 'slonik-interceptor-query-logging';

import fetch from "node-fetch";

export default class Indexer {

    public config: IndexerConfig;
    public antelopeCore: APIClient;
    public hyperion: AxiosInstance;
    public dbPool: DatabasePool | undefined;
    private tokenPoller: TokenPoller;

    private constructor(config: IndexerConfig) {
        this.config = config;
        this.antelopeCore = new APIClient({"url": this.config.nodeosUrl, fetch});
        this.hyperion = axios.create({
            baseURL: this.config.hyperionUrl
        });

        // must happen last, jobs may use the above in constructors
        this.tokenPoller = new TokenPoller(this);
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
        const opts = {interceptors};

        try {
            const connectionString = `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;
            this.dbPool = await createPool(connectionString, opts);
        } catch (e) {
            console.error(`Failed creating db pool`, e);
        }
    }

     async run() {
        await this.tokenPoller.init();
        await this.tokenPoller.run();
    }

}