export interface IndexerConfig {
    apiAddress: string
    apiPort: number
    apiHost: string
    tokenListUrl: string
    nodeosUrl: string
    hyperionUrl: string
    dbHost: string
    dbPort: number
    dbName: string
    dbUser: string
    dbPass: string
}

export interface RetryFetchOpts {
    attempts: number
    delay: number
    silent: boolean
}
