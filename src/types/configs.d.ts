import {APIClient} from "@greymass/eosio";

export interface IndexerConfig {
    tokenListUrl: string
    nodeosUrl: string
    hyperionUrl: string
    dbHost: string
    dbPort: number
    dbName: string
    dbUser: string
    dbPass: string
}
